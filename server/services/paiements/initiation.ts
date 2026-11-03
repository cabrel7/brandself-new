import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { paiements } from '../../../shared/db/schema'
import type { Paiement } from '../../../shared/db/schema'
import {
  PAIEMENT_INIT_LIMIT_NUMERO,
  PAIEMENT_INIT_LIMIT_UTILISATEUR,
  PAIEMENT_LIMITE_CLE_NUMERO_PREFIXE,
  PAIEMENT_LIMITE_CLE_UTILISATEUR_PREFIXE,
  PAIEMENT_SUIVI_LIMIT,
  PAIEMENT_LIMITE_CLE_SUIVI_PREFIXE,
  PAIEMENTS_OUVERTS_MAX,
} from '../../../shared/limites'
import {
  CODE_ECHEC_REQUETE_REFUSEE,
  PAIEMENT_RELANCE_APRES_S,
  PAIEMENT_STATUTS_OUVERTS,
} from '../../../shared/paiements'
import type { FournisseurPaiement } from '../../../shared/paiements'
import type { PaiementInitierInput } from '../../../shared/schemas/abonnement'
import { PAIEMENT_EXPIRATION_MINUTES, PAIEMENTS_VERIFICATION_CALENDRIER_S } from '../../../shared/jobs'
import { MOYENS_PAIEMENT, FRAIS_PAIEMENT } from '../../config/paiements'
import type { MoyenPaiementConfig, TableFrais } from '../../config/paiements'
import { PLAN_PAYANT_ID, PRIX_PLANS } from '../../config/plans'
import type { GrillePrix } from '../../config/plans'
import { ConflictError, NotFoundError, ServiceUnavailableError, UnprocessableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enforceLimit } from '../limiteur'
import { reserverAppelFournisseur } from './budget'
import { decrirePaiement, getPaiementProvider } from './fournisseurs'
import { calculerMontants } from './montants'
import { prixDeDevise } from './offre'
import { empreinte, masquer, normaliserNumero } from './telephone'
import type { InitiationResultat, PaiementProvider } from './types'

// S10 (docs/specs/S10-abonnements.md §1 #108, #110, #116, #117) : initiation SYNCHRONE d'un paiement Mobile Money.
// Ordre : (0) validation ; (1) limiteurs (fail-closed) ; (2) transaction courte qui insère la ligne `cree` puis
// COMMIT ; (3) appel au fournisseur, sans nouvel essai ; (4) mise à jour du statut. Le numéro n'est écrit nulle
// part (ni base, ni Redis, ni journal) : on garde un masque et une empreinte HMAC.
// Journal : identifiants et codes seulement, jamais le numéro, le corps ou une clé.

/** Secondes d'attente conseillées quand le fournisseur est indisponible et ne dit pas combien. */
const RETRY_APRES_DEFAUT_S = 30
const MS_PAR_SECONDE = 1_000
const MS_PAR_MINUTE = 60_000
const CODE_ECHEC_INDISPONIBLE = 'FOURNISSEUR_INDISPONIBLE'

export interface ConfigInitiation {
  moyens: readonly MoyenPaiementConfig[]
  frais: TableFrais
  prix: GrillePrix
}

/** Dépendances injectables (tests : faux fournisseur, configuration de frais alternative). */
export interface InitiationDeps {
  /** Adaptateur utilisé pour tout fournisseur (prioritaire sur `getProvider`). */
  provider?: PaiementProvider | null
  getProvider?: (nom: FournisseurPaiement) => PaiementProvider | null
  config?: Partial<ConfigInitiation>
  /** Réserve un appel dans le budget global du fournisseur (défaut : compteur Redis fail-closed). */
  reserverAppel?: (nom: FournisseurPaiement) => Promise<void>
  genererId?: () => string
}

type LecteurDb = Pick<typeof db, 'select'>

async function assertAucunPaiementBloquant(lecteur: LecteurDb, userId: string, now: Date): Promise<void> {
  const ouverts = await lecteur
    .select({ id: paiements.id, createdAt: paiements.createdAt })
    .from(paiements)
    .where(and(eq(paiements.userId, userId), inArray(paiements.statut, [...PAIEMENT_STATUTS_OUVERTS])))
    .orderBy(desc(paiements.createdAt))
    .limit(PAIEMENTS_OUVERTS_MAX)
  const recent = ouverts[0]
  if (recent === undefined) return
  const trop = ouverts.length >= PAIEMENTS_OUVERTS_MAX
  const tropRecent = now.getTime() - recent.createdAt.getTime() < PAIEMENT_RELANCE_APRES_S * MS_PAR_SECONDE
  if (trop || tropRecent) throw new ConflictError('PAIEMENT_EN_COURS', { paiementId: recent.id })
}

function resoudreProvider(nom: FournisseurPaiement, deps: InitiationDeps): PaiementProvider | null {
  if (deps.provider !== undefined) return deps.provider
  return (deps.getProvider ?? getPaiementProvider)(nom)
}

async function relire(id: string): Promise<Paiement> {
  const [ligne] = await db.select().from(paiements).where(eq(paiements.id, id))
  if (!ligne) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  return ligne
}

/**
 * Applique le résultat de l'appel à la ligne `cree`. Garde `statut = 'cree'` : si le webhook a déjà fait avancer
 * le paiement (il peut devancer cette mise à jour), on ne régresse jamais son statut.
 */
async function terminerInitiation(id: string, valeurs: Partial<typeof paiements.$inferInsert>, now: Date): Promise<Paiement> {
  const [ligne] = await db
    .update(paiements)
    .set({ ...valeurs, updatedAt: now })
    .where(and(eq(paiements.id, id), eq(paiements.statut, 'cree')))
    .returning()
  return ligne ?? (await relire(id))
}

function echec(code: string, now: Date): Partial<typeof paiements.$inferInsert> {
  return { statut: 'echoue', codeEchec: code, termineLe: now, prochaineVerification: null }
}

async function appliquerResultat(
  ligne: Paiement,
  resultat: InitiationResultat,
  now: Date,
): Promise<Paiement> {
  switch (resultat.issue) {
    case 'accepte': {
      const premierDelai = PAIEMENTS_VERIFICATION_CALENDRIER_S[0]
      return terminerInitiation(ligne.id, {
        statut: 'en_attente',
        idFournisseur: resultat.idFournisseur,
        referenceFournisseur: resultat.referenceFournisseur,
        prochaineVerification: new Date(now.getTime() + premierDelai * MS_PAR_SECONDE),
      }, now)
    }
    case 'incertain':
      // On ignore si le paiement existe chez le fournisseur : jamais interrogé (pas d'identifiant), seul le
      // webhook (externalId) pourra le rapprocher ; il expire localement sinon.
      console.warn({ paiement: 'initiation_incertaine', id: ligne.id, code: resultat.code })
      return terminerInitiation(ligne.id, { statut: 'en_attente', initiationIncertaine: true, prochaineVerification: null }, now)
    case 'refuse': {
      await terminerInitiation(ligne.id, echec(CODE_ECHEC_REQUETE_REFUSEE, now), now)
      throw new UnprocessableError('PAIEMENT_REFUSE', { paiementId: ligne.id })
    }
    case 'indisponible': {
      await terminerInitiation(ligne.id, echec(CODE_ECHEC_INDISPONIBLE, now), now)
      console.error({ paiement: 'fournisseur_indisponible', id: ligne.id, code: resultat.code })
      // Clés refusées = problème de configuration, pas une panne passagère : message neutre pour l'utilisateur.
      if (resultat.code === 'AUTH') throw new ServiceUnavailableError('PAIEMENT_INDISPONIBLE')
      throw new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE', { retryAfter: resultat.retryAfterS ?? RETRY_APRES_DEFAUT_S })
    }
  }
}

/**
 * Initie un paiement d'abonnement. Renvoie la ligne `en_attente` (sinon lève : 409 `PAIEMENT_EN_COURS`, 422
 * `MOYEN_PAIEMENT_INVALIDE` / `DEVISE_NON_PAYABLE` / `TELEPHONE_INVALIDE` / `PAIEMENT_REFUSE`, 429, 503).
 */
export async function initierPaiement(
  userId: string,
  input: PaiementInitierInput,
  now: Date,
  deps: InitiationDeps = {},
): Promise<Paiement> {
  const moyens = deps.config?.moyens ?? MOYENS_PAIEMENT
  const fraisTable = deps.config?.frais ?? FRAIS_PAIEMENT
  const grille = deps.config?.prix ?? PRIX_PLANS[PLAN_PAYANT_ID]

  // (0) Validation métier, avant tout effet.
  const moyen = moyens.find((candidat) => candidat.id === input.moyen && candidat.actif)
  if (!moyen) throw new UnprocessableError('MOYEN_PAIEMENT_INVALIDE')
  if (input.devise !== moyen.devise) throw new UnprocessableError('DEVISE_NON_PAYABLE')
  const prixPlan = prixDeDevise(grille, input.devise)?.[input.periodeMois]
  if (prixPlan === undefined) throw new UnprocessableError('DEVISE_NON_PAYABLE')
  const fraisConfig = fraisTable[moyen.fournisseur]?.[moyen.methode]
  if (fraisConfig === undefined) throw new ServiceUnavailableError('PAIEMENT_INDISPONIBLE')
  const numero = normaliserNumero(input.telephone, moyen)
  const provider = resoudreProvider(moyen.fournisseur, deps)
  if (!provider) throw new ServiceUnavailableError('PAIEMENT_INDISPONIBLE')
  const montants = calculerMontants({ prixPlan, tauxPb: fraisConfig.tauxPointsBase, supporteur: fraisConfig.supporteur })
  const empreinteNumero = empreinte(numero)

  // (1) Un paiement déjà ouvert se suit, il ne se double pas : refus AVANT de consommer les compteurs (double clic).
  await assertAucunPaiementBloquant(db, userId, now)
  // Limiteurs FAIL-CLOSED : Redis coupé = 503, aucune ligne, aucun appel. Le numéro n'entre jamais dans une clé :
  // seule son empreinte HMAC (non réversible sans le secret de l'application).
  await enforceLimit(
    `${PAIEMENT_LIMITE_CLE_UTILISATEUR_PREFIXE}${userId}`,
    PAIEMENT_INIT_LIMIT_UTILISATEUR.limit,
    PAIEMENT_INIT_LIMIT_UTILISATEUR.windowS,
    { failClosed: true },
  )
  await enforceLimit(
    `${PAIEMENT_LIMITE_CLE_NUMERO_PREFIXE}${empreinteNumero}`,
    PAIEMENT_INIT_LIMIT_NUMERO.limit,
    PAIEMENT_INIT_LIMIT_NUMERO.windowS,
    { failClosed: true },
  )
  // Budget global d'appels du fournisseur (100/min chez K-PAY, 60 chez nous), avant de créer la ligne.
  await (deps.reserverAppel ?? reserverAppelFournisseur)(moyen.fournisseur)

  // (2) Ligne `cree`, COMMITÉE avant l'appel : son id est l'`externalId` du fournisseur. Le verrou consultatif
  // sérialise les initiations d'un même utilisateur (le plafond de paiements ouverts tient sous concurrence).
  const id = (deps.genererId ?? randomUUID)()
  const ligne = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paiement-init:${userId}`}, 0))`)
    await assertAucunPaiementBloquant(tx, userId, now)
    const [creee] = await tx
      .insert(paiements)
      .values({
        id,
        userId,
        fournisseur: moyen.fournisseur,
        methode: moyen.methode,
        operateur: moyen.operateur,
        environnement: provider.environnement,
        statut: 'cree',
        plan: PLAN_PAYANT_ID,
        periodeMois: input.periodeMois,
        devise: moyen.devise,
        montantPlan: prixPlan,
        montant: montants.montant,
        fraisTauxPb: fraisConfig.tauxPointsBase,
        fraisSupporteur: fraisConfig.supporteur,
        fraisEstimes: montants.frais,
        netEstime: montants.net,
        telephoneMasque: masquer(numero, moyens.map((candidat) => candidat.indicatif)),
        telephoneEmpreinte: empreinteNumero,
        expireAvant: new Date(now.getTime() + PAIEMENT_EXPIRATION_MINUTES * MS_PAR_MINUTE),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!creee) throw new Error('PAIEMENT_NON_CREE')
    return creee
  })

  // (3) Appel au fournisseur : hors transaction, sans nouvel essai. Toute exception inattendue = résultat incertain.
  let resultat: InitiationResultat
  try {
    resultat = await provider.initier(
      {
        externalId: ligne.id,
        montant: montants.montant,
        devise: moyen.devise,
        operateur: moyen.operateur,
        telephoneInternational: numero,
        description: decrirePaiement(moyen.fournisseur, input.periodeMois),
      },
      new AbortController().signal,
    )
  } catch {
    resultat = { issue: 'incertain', code: 'RESEAU' }
  }

  // (4) Mise à jour du statut.
  return appliquerResultat(ligne, resultat, now)
}

/** Paiement d'un utilisateur ; celui d'autrui est « introuvable » (404), jamais « interdit » (pas d'oracle). */
export async function getOwnPaiement(userId: string, id: string): Promise<Paiement> {
  const [ligne] = await db
    .select()
    .from(paiements)
    .where(and(eq(paiements.id, id), eq(paiements.userId, userId)))
  if (!ligne) throw new NotFoundError('PAIEMENT_INTROUVABLE')
  return ligne
}

/**
 * Lecture du statut par le navigateur (toutes les 5 s) : NOTRE base, jamais le fournisseur. Limite par utilisateur,
 * fail-open (c'est une lecture).
 */
export async function suivrePaiement(userId: string, id: string): Promise<Paiement> {
  await enforceLimit(`${PAIEMENT_LIMITE_CLE_SUIVI_PREFIXE}${userId}`, PAIEMENT_SUIVI_LIMIT.limit, PAIEMENT_SUIVI_LIMIT.windowS)
  return getOwnPaiement(userId, id)
}
