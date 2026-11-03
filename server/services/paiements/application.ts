import { randomUUID } from 'node:crypto'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { abonnements, evenementsPaiement, paiements, users } from '../../../shared/db/schema'
import type { Paiement } from '../../../shared/db/schema'
import { PAIEMENT_STATUTS } from '../../../shared/paiements'
import type {
  CodeAnomalie,
  EvenementSource,
  PaiementEnvironnement,
  TraitementEvenement,
} from '../../../shared/paiements'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import { PLAN_PAYANT_ID } from '../../config/plans'
import { db } from '../../utils/db'
import { calculerNouvelleEcheance, choisirBase, fuseauEffectif } from '../abonnements-regles'
import { insertTransactionalEmailEvents } from '../email-outbox'
import type { DbTransaction } from '../email-outbox'
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
/** Plus grand entier d'une colonne `integer` PostgreSQL. */
const ENTIER_MAX = 2_147_483_647
/** Motifs posés par ce module (en plus de `CodeAnomalie`). */
const MOTIF_NON_TERMINAL = 'NON_TERMINAL'
const MOTIF_UTILISATEUR_SUPPRIME = 'UTILISATEUR_SUPPRIME'

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

// ---------------------------------------------------------------------------------------------
// Prolongation de l'abonnement
// ---------------------------------------------------------------------------------------------

export interface ResultatProlongation {
  abonnementId: string
  /** Échéance avant le paiement (`null` : première activation). */
  avant: Date | null
  apres: Date
}

/**
 * Prolonge l'abonnement d'un utilisateur de `periodeMois` mois (#120), dans la transaction de l'appelant.
 * Sérialisée par utilisateur (verrou consultatif + `FOR UPDATE`) : deux paiements confirmés en parallèle ne
 * perdent aucune mise à jour. Base = `max(now, expire_le)` : en grâce ou en gratuit on repart de `now`.
 */
export async function prolonger(
  tx: DbTransaction,
  userId: string,
  periodeMois: number,
  now: Date,
  paiementId: string | null = null,
): Promise<ResultatProlongation> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`abonnement:${userId}`}, 0))`)
  const [existant] = await tx.select().from(abonnements).where(eq(abonnements.userId, userId)).for('update')
  const [utilisateur] = await tx.select({ fuseau: users.fuseau }).from(users).where(eq(users.id, userId))
  const fuseau = fuseauEffectif(utilisateur?.fuseau ?? ABONNEMENT_FUSEAU_REPLI)
  const avant = existant?.expireLe ?? null
  const apres = calculerNouvelleEcheance(choisirBase(now, avant), periodeMois, fuseau)

  if (existant === undefined) {
    const id = randomUUID()
    await tx.insert(abonnements).values({
      id,
      userId,
      plan: PLAN_PAYANT_ID,
      expireLe: apres,
      premiereActivationLe: now,
      dernierPaiementId: paiementId,
      createdAt: now,
      updatedAt: now,
    })
    return { abonnementId: id, avant, apres }
  }
  await tx
    .update(abonnements)
    .set({ expireLe: apres, dernierPaiementId: paiementId, updatedAt: now })
    .where(eq(abonnements.id, existant.id))
  return { abonnementId: existant.id, avant, apres }
}

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

async function ecrireSucces(tx: DbTransaction, paiement: Paiement, evt: EvenementNormalise, now: Date): Promise<void> {
  let prolongation: ResultatProlongation | null = null
  // Compte supprimé entre-temps : l'argent est pris mais il n'y a plus d'abonnement à prolonger. Le paiement reste
  // une pièce comptable `reussi`, sans effet ni reçu (cas marginal, signalé dans les journaux).
  if (paiement.userId !== null) {
    prolongation = await prolonger(tx, paiement.userId, paiement.periodeMois, now, paiement.id)
  } else {
    console.error({ paiement: 'sans_utilisateur', id: paiement.id, motif: MOTIF_UTILISATEUR_SUPPRIME })
  }
  await tx
    .update(paiements)
    .set({
      ...identifiantsAConserver(paiement, evt),
      statut: 'reussi',
      codeEchec: null,
      appliqueLe: now,
      termineLe: now,
      prochaineVerification: null,
      fraisReels: entierOuNull(evt.fraisReels) ?? paiement.fraisReels,
      netReel: entierOuNull(evt.netReel) ?? paiement.netReel,
      abonnementExpireAvant: prolongation?.avant ?? null,
      abonnementExpireApres: prolongation?.apres ?? null,
      updatedAt: now,
    })
    .where(eq(paiements.id, paiement.id))
  // Reçu dans la MÊME transaction : jamais d'activation sans reçu planifié, jamais de reçu sans activation. La
  // clé d'unicité (entité, type, occurrence vide) l'empêche d'être planifié deux fois.
  if (paiement.userId !== null) {
    await insertTransactionalEmailEvents(tx, 'paiement', paiement.id, ['paiement_confirme'], now)
  }
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
  // Un nom d'événement hors format ne peut pas être journalisé (CHECK) : ignoré sans écriture, jamais une 500.
  if (!EVENEMENT_FORMAT.test(evt.evenement)) return { traitement: 'ignore', motif: 'EVENEMENT_NON_GERE', paiementId: null }

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
