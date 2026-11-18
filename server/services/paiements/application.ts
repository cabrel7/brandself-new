import { randomUUID } from 'node:crypto'
import { and, eq, ne, or } from 'drizzle-orm'
import { evenementsPaiement, paiements } from '../../../shared/db/schema'
import type { Paiement } from '../../../shared/db/schema'
import { PAIEMENT_STATUTS } from '../../../shared/paiements'
import type {
  CodeAnomalie,
  EvenementSource,
  PaiementEnvironnement,
  TraitementEvenement,
} from '../../../shared/paiements'
import { db } from '../../utils/db'
import type { DbTransaction } from '../email-outbox'
import { confirmerPaiement } from './confirmation'
import { transitionPaiement } from './transitions'
import type { DecisionTransition } from './transitions'
import type { EvenementNormalise } from './types'

// S10 (docs/specs/S10-abonnements.md §1 #111, #113, #114, #120) : application d'un événement de paiement (webhook
// signé OU interrogation du worker, même chemin). Tout se passe dans UNE transaction :
//   verrou du paiement -> décision (pure) -> journal (déduplication) -> écritures.
// Le journal est inséré AVANT les écritures : un conflit d'unicité veut dire « doublon », donc aucun effet ; un
// rollback efface le journal, donc le réessai du fournisseur fonctionne. Journaux : identifiants et codes seulement,
// jamais de numéro, de corps de requête ni de clé.

/** Forme d'un nom d'événement acceptée par la base (`evenements_paiement_evenement_check`). */
const EVENEMENT_FORMAT = /^[a-z_]{1,20}\.[a-z_]{1,20}$/
const STATUT_FOURNISSEUR_FORMAT = /^[A-Z_]{1,30}$/
/** Longueur maximale de chaque moitié d'un nom d'événement (`^[a-z_]{1,20}\.[a-z_]{1,20}$`). */
const EVENEMENT_PARTIE_MAX = 20
/** Plus grand entier d'une colonne `integer` PostgreSQL. */
const ENTIER_MAX = 2_147_483_647
/** Motifs posés par ce module (en plus de `CodeAnomalie`). */
const MOTIF_NON_TERMINAL = 'NON_TERMINAL'
const MOTIF_ENVIRONNEMENT_INCOHERENT = 'ENVIRONNEMENT_INCOHERENT'

export interface OptionsApplication {
  /** Environnement de la clé du fournisseur : un paiement d'un autre environnement est « inconnu ». */
  environnement?: PaiementEnvironnement
}

export interface ResultatApplication {
  traitement: TraitementEvenement | 'doublon'
  motif: string | null
  paiementId: string | null
}

type Decision =
  | DecisionTransition
  | { type: 'anomalie', code: CodeAnomalie }

/**
 * Nom d'événement du fournisseur assaini pour respecter le format de la base : minuscules, tout caractère hors `[a-z_]`
 * remplacé par `_`, chaque moitié (avant/après le premier point) tronquée à 20. `null` si aucun format valide n'en sort.
 */
export function assainirNomEvenement(nom: string): string | null {
  if (EVENEMENT_FORMAT.test(nom)) return nom
  const [gauche, ...reste] = nom.toLowerCase().split('.')
  if (gauche === undefined || reste.length === 0) return null
  const nettoyer = (partie: string): string => partie.replace(/[^a-z_]/g, '_').slice(0, EVENEMENT_PARTIE_MAX)
  const assaini = `${nettoyer(gauche)}.${nettoyer(reste.join('_'))}`
  return EVENEMENT_FORMAT.test(assaini) ? assaini : null
}

function entierOuNull(valeur: number | null | undefined): number | null {
  return typeof valeur === 'number' && Number.isSafeInteger(valeur) && valeur >= 0 && valeur <= ENTIER_MAX ? valeur : null
}

/**
 * Verrouille le paiement visé (`FOR UPDATE`). Clé principale : l'`externalId` (notre id) ; à défaut, l'identifiant
 * du fournisseur. Le fournisseur doit correspondre : un id d'un autre fournisseur n'est jamais le nôtre.
 */
async function verrouillerPaiement(tx: DbTransaction, fournisseur: string, evt: EvenementNormalise): Promise<Paiement | undefined> {
  const cible = evt.externalId !== null
    ? eq(paiements.id, evt.externalId)
    : eq(paiements.idFournisseur, evt.idTransaction)
  const [ligne] = await tx
    .select()
    .from(paiements)
    .where(and(eq(paiements.fournisseur, fournisseur), cible))
    .for('update')
  return ligne
}

/** Un autre paiement porte-t-il déjà cet identifiant ou cette référence du fournisseur ? (index uniques) */
async function identifiantDejaPris(tx: DbTransaction, fournisseur: string, paiement: Paiement, evt: EvenementNormalise): Promise<boolean> {
  const conditions = [and(eq(paiements.fournisseur, fournisseur), eq(paiements.idFournisseur, evt.idTransaction))]
  if (evt.referenceFournisseur !== null) {
    conditions.push(and(eq(paiements.fournisseur, fournisseur), eq(paiements.referenceFournisseur, evt.referenceFournisseur)))
  }
  const [autre] = await tx
    .select({ id: paiements.id })
    .from(paiements)
    .where(and(ne(paiements.id, paiement.id), or(...conditions)))
    .limit(1)
  return autre !== undefined
}

function controler(paiement: Paiement, evt: EvenementNormalise, identifiantPris: boolean): CodeAnomalie | null {
  if (evt.montant !== paiement.montant) return 'MONTANT_INCOHERENT'
  if ((paiement.idFournisseur !== null && paiement.idFournisseur !== evt.idTransaction) || identifiantPris) return 'ID_INCOHERENT'
  if (evt.devise !== null && evt.devise !== paiement.devise) return 'DEVISE_INCOHERENTE'
  return null
}

async function decider(
  tx: DbTransaction,
  fournisseur: string,
  paiement: Paiement | undefined,
  evt: EvenementNormalise,
  options: OptionsApplication,
): Promise<Decision> {
  // Virements, remboursements, statuts contradictoires : journalisés, jamais appliqués (même sans paiement connu).
  if (evt.statut === 'autre') return { type: 'ignorer', motif: 'EVENEMENT_NON_GERE' }
  // P1 : un événement d'un autre environnement (`livemode`) que celui de la clé n'est JAMAIS appliqué. `ignore` et non
  // `anomalie` : l'anomalie verrouillerait le paiement, or l'événement légitime (bon environnement) doit pouvoir l'activer.
  if (options.environnement !== undefined && evt.environnement !== undefined && evt.environnement !== options.environnement) {
    return { type: 'ignorer', motif: MOTIF_ENVIRONNEMENT_INCOHERENT }
  }
  if (paiement === undefined || (options.environnement !== undefined && paiement.environnement !== options.environnement)) {
    return { type: 'ignorer', motif: 'PAIEMENT_INCONNU' }
  }
  if (evt.statut === 'rembourse') return { type: 'ignorer', motif: 'REMBOURSE' }
  const statut = PAIEMENT_STATUTS.find((candidat) => candidat === paiement.statut)
  if (statut === undefined) return { type: 'ignorer', motif: 'EVENEMENT_NON_GERE' }
  const transition = transitionPaiement(statut, evt)
  if (transition.type !== 'succes' && transition.type !== 'echec') return transition
  const code = controler(paiement, evt, await identifiantDejaPris(tx, fournisseur, paiement, evt))
  if (code === null) return transition
  // Seul un SUCCÈS incohérent est une anomalie finale (aucune activation). Un échec ou une annulation incohérent
  // est journalisé `ignore` : il ne doit pas verrouiller à tort un paiement qu'un vrai `completed` peut encore activer.
  return transition.type === 'succes' ? { type: 'anomalie', code } : { type: 'ignorer', motif: code }
}

// Prolongation de l'abonnement : voir `prolongation.ts` (ré-exportée ici pour les appelants existants).
export { prolonger } from './prolongation'
export type { ResultatProlongation } from './prolongation'

// ---------------------------------------------------------------------------------------------
// Application d'un événement
// ---------------------------------------------------------------------------------------------

/** Identifiant et référence du fournisseur, renseignés une seule fois (jamais écrasés ni en conflit d'unicité). */
function identifiantsAConserver(paiement: Paiement, evt: EvenementNormalise): Pick<typeof paiements.$inferInsert, 'idFournisseur' | 'referenceFournisseur'> {
  return {
    idFournisseur: paiement.idFournisseur ?? evt.idTransaction,
    referenceFournisseur: paiement.referenceFournisseur ?? evt.referenceFournisseur,
  }
}

/**
 * A3 : l'écriture d'un succès est déléguée au service UNIQUE `confirmerPaiement` (prolongation, passage à `reussi`,
 * reçu). La décision et le journal de déduplication restent ici.
 */
async function ecrireSucces(tx: DbTransaction, paiement: Paiement, evt: EvenementNormalise, now: Date): Promise<void> {
  await confirmerPaiement(tx, paiement.id, now, {
    ...identifiantsAConserver(paiement, evt),
    fraisReels: entierOuNull(evt.fraisReels),
    netReel: entierOuNull(evt.netReel),
  })
}

async function ecrireEchec(
  tx: DbTransaction,
  paiement: Paiement,
  evt: EvenementNormalise,
  decision: Extract<DecisionTransition, { type: 'echec' }>,
  now: Date,
): Promise<void> {
  await tx
    .update(paiements)
    .set({
      ...identifiantsAConserver(paiement, evt),
      statut: decision.statut,
      codeEchec: decision.codeEchec,
      termineLe: now,
      prochaineVerification: null,
      updatedAt: now,
    })
    .where(eq(paiements.id, paiement.id))
}

async function ecrireAnomalie(tx: DbTransaction, paiement: Paiement, code: CodeAnomalie, now: Date): Promise<void> {
  await tx
    .update(paiements)
    .set({
      statut: 'anomalie',
      codeEchec: code,
      termineLe: paiement.termineLe ?? now,
      prochaineVerification: null,
      updatedAt: now,
    })
    .where(eq(paiements.id, paiement.id))
  // Alerte : codes seulement, jamais le numéro, le corps ni les montants échangés.
  console.error({ paiement: 'anomalie', id: paiement.id, fournisseur: paiement.fournisseur, code })
}

/**
 * Écrit la ligne du journal. Renvoie `false` si cet événement (fournisseur, transaction, nom) a déjà été TRAITÉ
 * (`applique` ou `anomalie`) : c'est un doublon. Une ligne existante `ignore` ne bloque jamais : un événement
 * ignoré (statut inconnu, paiement pas encore connu…) ne doit pas empêcher le même événement, devenu applicable
 * (ex. l'interrogation `COMPLETED` après un webhook au statut illisible), d'activer l'abonnement. Elle est mise à jour.
 */
async function journaliser(
  tx: DbTransaction,
  fournisseur: string,
  evt: EvenementNormalise,
  source: EvenementSource,
  paiement: Paiement | undefined,
  traitement: TraitementEvenement,
  motif: string | null,
  now: Date,
): Promise<boolean> {
  const statutBrut = evt.statutBrut !== undefined && evt.statutBrut !== null && STATUT_FOURNISSEUR_FORMAT.test(evt.statutBrut)
    ? evt.statutBrut
    : null
  const valeurs = {
    source,
    externalId: evt.externalId,
    paiementId: paiement?.id ?? null,
    statutFournisseur: statutBrut,
    montant: entierOuNull(evt.montant),
    traitement,
    motif,
    horodatageFournisseur: evt.horodatage,
    recuLe: now,
  }
  const inseres = await tx
    .insert(evenementsPaiement)
    .values({ id: randomUUID(), fournisseur, evenement: evt.evenement, idTransaction: evt.idTransaction, ...valeurs })
    .onConflictDoNothing({
      target: [evenementsPaiement.fournisseur, evenementsPaiement.idTransaction, evenementsPaiement.evenement],
    })
    .returning({ id: evenementsPaiement.id })
  if (inseres.length > 0) return true
  const [existant] = await tx
    .select({ id: evenementsPaiement.id, traitement: evenementsPaiement.traitement })
    .from(evenementsPaiement)
    .where(and(
      eq(evenementsPaiement.fournisseur, fournisseur),
      eq(evenementsPaiement.idTransaction, evt.idTransaction),
      eq(evenementsPaiement.evenement, evt.evenement),
    ))
  if (existant === undefined || existant.traitement !== 'ignore') return false
  await tx.update(evenementsPaiement).set(valeurs).where(eq(evenementsPaiement.id, existant.id))
  return true
}

/**
 * Applique un événement de paiement normalisé. Idempotent : le rejeu d'un événement (webhook réessayé, interrogation
 * puis webhook, deux appels simultanés) ne produit aucun effet supplémentaire. Ne lève jamais pour une anomalie
 * métier (montant incohérent…) : elle est consignée, le fournisseur reçoit un 2xx. Une panne de base se propage
 * (le fournisseur réessaiera).
 */
export async function appliquerEvenement(
  fournisseur: string,
  evt: EvenementNormalise,
  source: EvenementSource,
  now: Date,
  options: OptionsApplication = {},
): Promise<ResultatApplication> {
  // Résultat non terminal : ni écriture, ni journal (« seuls les événements terminaux changent l'état »).
  if (evt.statut === 'en_attente') return { traitement: 'ignore', motif: MOTIF_NON_TERMINAL, paiementId: null }
  // Un nom d'événement hors format est assaini avant l'insertion (CHECK) ; sans forme exploitable : ignoré sans écriture,
  // jamais une 500.
  const nomEvenement = assainirNomEvenement(evt.evenement)
  if (nomEvenement === null) return { traitement: 'ignore', motif: 'EVENEMENT_NON_GERE', paiementId: null }
  if (nomEvenement !== evt.evenement) evt = { ...evt, evenement: nomEvenement }

  return db.transaction(async (tx): Promise<ResultatApplication> => {
    const paiement = await verrouillerPaiement(tx, fournisseur, evt)
    const decision = await decider(tx, fournisseur, paiement, evt, options)
    if (decision.type === 'attente') return { traitement: 'ignore', motif: MOTIF_NON_TERMINAL, paiementId: paiement?.id ?? null }

    const traitement: TraitementEvenement = decision.type === 'ignorer' ? 'ignore' : decision.type === 'anomalie' ? 'anomalie' : 'applique'
    const motif = decision.type === 'ignorer' ? decision.motif : decision.type === 'anomalie' ? decision.code : null
    const nouveau = await journaliser(tx, fournisseur, evt, source, paiement, traitement, motif, now)
    if (!nouveau) return { traitement: 'doublon', motif: null, paiementId: paiement?.id ?? null }

    if (paiement !== undefined) {
      switch (decision.type) {
        case 'succes':
          await ecrireSucces(tx, paiement, evt, now)
          break
        case 'echec':
          await ecrireEchec(tx, paiement, evt, decision, now)
          break
        case 'anomalie':
          await ecrireAnomalie(tx, paiement, decision.code, now)
          break
        case 'ignorer':
          if (decision.motif === 'REMBOURSE') console.error({ paiement: 'rembourse', id: paiement.id, fournisseur })
          break
      }
    }
    return { traitement, motif, paiementId: paiement?.id ?? null }
  })
}
