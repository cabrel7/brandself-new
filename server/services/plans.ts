import { and, count, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
  abonnements,
  capacitesAccordees,
  generationsIa,
  realisations,
  reservations,
  services,
  temoignages,
  users,
  vitrines,
} from '../../shared/db/schema'
import type { QuotaDTO } from '../../shared/dto/abonnement'
import type { QuotaIaDTO } from '../../shared/dto/ia'
import { GENERATION_EXPIRATION_MS, IA_TYPES_QUOTA } from '../../shared/ia'
import {
  ABONNEMENT_FUSEAU_REPLI,
  ABONNEMENT_GRACE_JOURS,
  PLAN_IDS,
  RESSOURCES_QUOTA,
} from '../../shared/plans'
import type { CapacitePayante, EtatAbonnement, PlanId, RessourceQuota } from '../../shared/plans'
import { REGLAGE_CLES } from '../../shared/reglages'
import { LIMITE_CHAMP_PAR_RESSOURCE, PLAN_GRATUIT_ID } from '../config/plans'
import { db } from '../utils/db'
import { assurerInstantane, lirePlanConfig, lirePlanConfigSansCache, lirePlanVersionne } from './configuration/lecture'
import { Reglages } from './reglages'
import { ajouterJoursLocaux, bornesMoisLocal, construireErreurLimite, dernierJourInclusLocal } from './plans-regles'
import type { Executor, Transaction } from './vitrine-acces'

// S10 (docs/specs/S10-abonnements.md §1 #119 à #126, §5.1) : PlanService UNIQUE. Plan effectif calculé depuis
// `abonnements.expire_le` et l'horloge (jamais stocké), quotas appliqués sous verrou, compteur IA.
// CLAUDE.md §4 règle 11 : aucune limite chiffrée ici, tout vient de server/config/plans.ts.

/** Ce que la résolution du plan lit de la ligne `abonnements`. */
export interface AbonnementLu {
  plan: string
  expireLe: Date
}

export interface PlanEffectif {
  /** Plan dont les DROITS s'appliquent (`payant` pendant l'abonnement ET pendant la grâce). */
  plan: PlanId
  etat: EtatAbonnement
  expireLe: Date | null
  /** Fin de la grâce (exclusive) ; `null` hors abonnement actif ou en grâce. */
  graceJusquau: Date | null
  /** Jours entamés avant l'échéance ; `null` hors abonnement actif. */
  joursRestants: number | null
  /** AAAA-MM-JJ local du dernier jour payé. */
  dernierJourInclus: string | null
}

export interface ContexteQuota {
  userId: string
  /** Obligatoire pour services, réalisations, témoignages et réservations. */
  vitrineId?: string
  /** Fuseau du mois civil : celui de la vitrine (réservations) ou, par défaut, `users.fuseau` (IA). */
  fuseau?: string
}

export interface ResultatQuota {
  plan: PlanId
  etat: EtatAbonnement
  limite: number | null
  /** `null` quand la ressource est illimitée : elle n'est alors pas comptée. */
  utilise: number | null
  atteinte: boolean
}

const MS_PAR_JOUR = 86_400_000
const STATUTS_RESERVATION_COMPTES = ['en_attente', 'confirmee', 'terminee'] as const
const STATUTS_IA_EN_COURS = ['en_attente', 'en_cours'] as const
const STATUT_IA_TERMINEE = 'terminee'
const VERROU_RESERVATIONS_PREFIXE = 'quota-reservations:'
const VERROU_IA_PREFIXE = 'quota-ia:'

function planGratuit(): PlanEffectif {
  return { plan: PLAN_GRATUIT_ID, etat: 'gratuit', expireLe: null, graceJusquau: null, joursRestants: null, dernierJourInclus: null }
}

function estPlanVendu(valeur: string): valeur is PlanId {
  return valeur !== PLAN_GRATUIT_ID && (PLAN_IDS as readonly string[]).includes(valeur)
}

/**
 * Plan effectif à l'instant `now` (fonction PURE, l'horloge est injectée) :
 * `now < expire_le` : actif · `now < expire_le + 7 jours` : grâce (droits du plan payant conservés) · sinon gratuit.
 * Sans abonnement, ou avec un plan inconnu : gratuit. `fuseau` (celui du compte) ne sert qu'aux dates locales.
 */
export function resoudrePlanEffectif(
  abonnement: AbonnementLu | null,
  now: Date,
  fuseau: string = ABONNEMENT_FUSEAU_REPLI,
  graceJours: number = ABONNEMENT_GRACE_JOURS,
): PlanEffectif {
  if (abonnement === null || !estPlanVendu(abonnement.plan)) return planGratuit()
  const graceJusquau = ajouterJoursLocaux(abonnement.expireLe, graceJours, fuseau)
  const commun = {
    plan: abonnement.plan,
    expireLe: abonnement.expireLe,
    graceJusquau,
    dernierJourInclus: dernierJourInclusLocal(abonnement.expireLe, fuseau),
  }
  const reste = abonnement.expireLe.getTime() - now.getTime()
  if (reste > 0) return { ...commun, etat: 'actif', joursRestants: Math.ceil(reste / MS_PAR_JOUR) }
  if (now.getTime() < graceJusquau.getTime()) return { ...commun, etat: 'grace', joursRestants: null }
  return planGratuit()
}

/**
 * Durée de la grâce (jours) : SOURCE UNIQUE, le réglage `abonnement.grace_jours`. Cache de 5 s (celui des réglages),
 * repli sur `ABONNEMENT_GRACE_JOURS` si la lecture est impossible, jamais d'exception. Tout lecteur de la grâce
 * (plan effectif, tarifs, sitemap, filtres d'administration, aperçu d'impact, e-mail) passe par ici.
 */
export async function lireGraceJours(): Promise<number> {
  try {
    const valeur = await Reglages.lire(REGLAGE_CLES.abonnementGraceJours)
    return Number.isInteger(valeur) && valeur >= 0 ? valeur : ABONNEMENT_GRACE_JOURS
  } catch {
    return ABONNEMENT_GRACE_JOURS
  }
}

interface PlanLu {
  effectif: PlanEffectif
  /** `users.fuseau` (repli si l'utilisateur n'existe pas). */
  fuseau: string
}

/** Une seule requête : le fuseau du compte et son abonnement éventuel (clé unique). */
async function lirePlan(executor: Executor, userId: string, now: Date): Promise<PlanLu> {
  // A5 (D-A5-04) : l'instantané des versions actives a au plus 5 s ; `limiteDe` et les lecteurs de `lirePlanConfig` sont synchrones.
  await assurerInstantane()
  const [ligne] = await executor
    .select({ fuseau: users.fuseau, plan: abonnements.plan, expireLe: abonnements.expireLe })
    .from(users)
    .leftJoin(abonnements, eq(abonnements.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1)
  if (!ligne) return { effectif: planGratuit(), fuseau: ABONNEMENT_FUSEAU_REPLI }
  const abonnement = ligne.plan !== null && ligne.expireLe !== null ? { plan: ligne.plan, expireLe: ligne.expireLe } : null
  // A4 : durée de grâce pilotée par le réglage `abonnement.grace_jours` (repli : valeur du code, jamais d'exception).
  const graceJours = await lireGraceJours()
  return { effectif: resoudrePlanEffectif(abonnement, now, ligne.fuseau, graceJours), fuseau: ligne.fuseau }
}

export async function getPlanEffectif(userId: string, now: Date = new Date(), executor: Executor = db): Promise<PlanEffectif> {
  return (await lirePlan(executor, userId, now)).effectif
}

/** Plan dont les droits s'appliquent à l'utilisateur (compat S8 : `getPlanForUser`). */
export async function getPlanForUser(userId: string, now: Date = new Date()): Promise<PlanId> {
  return (await getPlanEffectif(userId, now)).plan
}

/** Limite d'une ressource pour un plan ; `null` = illimité. A5 : lue sur la version ACTIVE (cache de 5 s), repli sur le code. */
export function limiteDe(plan: PlanId, ressource: RessourceQuota): number | null {
  return lirePlanConfig(plan)[LIMITE_CHAMP_PAR_RESSOURCE[ressource]]
}

function exigerVitrine(contexte: ContexteQuota, ressource: RessourceQuota): string {
  if (contexte.vitrineId === undefined) throw new Error(`Quota « ${ressource} » : vitrine requise.`)
  return contexte.vitrineId
}

async function compterListe(
  executor: Executor,
  table: typeof services | typeof realisations | typeof temoignages,
  vitrineId: string,
): Promise<number> {
  // TOUTES les lignes, visibles ou non : masquer pour recréer contournerait la limite (#124).
  const [ligne] = await executor.select({ total: count() }).from(table).where(eq(table.vitrineId, vitrineId))
  return ligne?.total ?? 0
}

async function compterUtilise(
  executor: Executor,
  contexte: ContexteQuota,
  ressource: RessourceQuota,
  fuseauCompte: string,
  now: Date,
): Promise<number> {
  const fuseau = contexte.fuseau ?? fuseauCompte
  switch (ressource) {
    case 'services':
      return compterListe(executor, services, exigerVitrine(contexte, ressource))
    case 'realisations':
      return compterListe(executor, realisations, exigerVitrine(contexte, ressource))
    case 'temoignages':
      return compterListe(executor, temoignages, exigerVitrine(contexte, ressource))
    case 'reservations_mois': {
      // Refus et annulations exclus : un tiers ne peut pas épuiser le quota avec de fausses réservations (#124).
      const { debut, fin } = bornesMoisLocal(now, fuseau)
      const [ligne] = await executor
        .select({ total: count() })
        .from(reservations)
        .where(
          and(
            eq(reservations.vitrineId, exigerVitrine(contexte, ressource)),
            inArray(reservations.statut, [...STATUTS_RESERVATION_COMPTES]),
            gte(reservations.createdAt, debut),
            lt(reservations.createdAt, fin),
          ),
        )
      return ligne?.total ?? 0
    }
    case 'generations_ia_mois': {
      // Terminées + en cours dont le job peut encore aboutir ; les replis ne consomment pas.
      const { debut, fin } = bornesMoisLocal(now, fuseau)
      const debutFenetreActive = new Date(now.getTime() - GENERATION_EXPIRATION_MS)
      const [ligne] = await executor
        .select({ total: count() })
        .from(generationsIa)
        .where(
          and(
            eq(generationsIa.userId, contexte.userId),
            // Décision #24 : le SEO de fond n'est pas une demande de l'utilisateur, il ne consomme pas son quota.
            inArray(generationsIa.type, [...IA_TYPES_QUOTA]),
            gte(generationsIa.createdAt, debut),
            lt(generationsIa.createdAt, fin),
            or(
              eq(generationsIa.statut, STATUT_IA_TERMINEE),
              and(inArray(generationsIa.statut, [...STATUTS_IA_EN_COURS]), gt(generationsIa.createdAt, debutFenetreActive)),
            ),
          ),
        )
      return ligne?.total ?? 0
    }
  }
}

/** Verrou consultatif de transaction : sérialise les créations concurrentes d'une même ressource limitée. */
async function verrouiller(tx: Transaction, contexte: ContexteQuota, ressource: RessourceQuota): Promise<void> {
  if (ressource === 'reservations_mois') {
    const cle = `${VERROU_RESERVATIONS_PREFIXE}${exigerVitrine(contexte, ressource)}`
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${cle}, 0))`)
  } else if (ressource === 'generations_ia_mois') {
    const cle = `${VERROU_IA_PREFIXE}${contexte.userId}`
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${cle}, 0))`)
  }
  // services, réalisations, témoignages : le verrou est la ligne vitrine (`lockVitrineId`), pris par l'appelant.
}

async function mesurer(
  executor: Executor,
  contexte: ContexteQuota,
  ressource: RessourceQuota,
  now: Date,
  avecVerrou: Transaction | null,
): Promise<ResultatQuota> {
  const { effectif, fuseau } = await lirePlan(executor, contexte.userId, now)
  // A5 (D-A5-04) : sous verrou (écriture), la limite est relue SANS cache, dans la transaction : jamais un quota périmé.
  const limite = avecVerrou === null
    ? limiteDe(effectif.plan, ressource)
    : (await lirePlanConfigSansCache(effectif.plan, avecVerrou))[LIMITE_CHAMP_PAR_RESSOURCE[ressource]]
  // Illimité : rien à compter, AUCUN verrou pris (CA90).
  if (limite === null) return { plan: effectif.plan, etat: effectif.etat, limite: null, utilise: null, atteinte: false }
  if (avecVerrou !== null) await verrouiller(avecVerrou, contexte, ressource)
  const utilise = await compterUtilise(executor, contexte, ressource, fuseau, now)
  return { plan: effectif.plan, etat: effectif.etat, limite, utilise, atteinte: utilise >= limite }
}

/** Lecture seule, sans verrou : créneaux suspendus, affichage. */
export async function evaluerQuota(
  executor: Executor,
  contexte: ContexteQuota,
  ressource: RessourceQuota,
  now: Date = new Date(),
): Promise<ResultatQuota> {
  return mesurer(executor, contexte, ressource, now, null)
}

/**
 * Mesure SOUS VERROU (si la ressource est limitée) sans lever : l'appelant décide (repli IA de l'onboarding,
 * 409 visiteur des réservations). Le verrou dure jusqu'à la fin de la transaction.
 */
export async function mesurerQuotaVerrouille(
  tx: Transaction,
  contexte: ContexteQuota,
  ressource: RessourceQuota,
  now: Date = new Date(),
): Promise<ResultatQuota> {
  return mesurer(tx, contexte, ressource, now, tx)
}

/**
 * Refuse (403 LIMITE_PLAN_ATTEINTE, `data: { ressource, limite, utilise, plan }`) quand la limite du plan effectif
 * est atteinte. À appeler DANS la transaction qui insère, après le verrou de la ressource. Renvoie la mesure
 * (limite du plan effectif comprise) pour que l'appelant n'ait pas à la relire.
 */
export async function assertQuota(
  tx: Transaction,
  contexte: ContexteQuota,
  ressource: RessourceQuota,
  now: Date = new Date(),
): Promise<ResultatQuota> {
  const mesure = await mesurerQuotaVerrouille(tx, contexte, ressource, now)
  if (mesure.atteinte && mesure.limite !== null && mesure.utilise !== null) {
    throw construireErreurLimite(ressource, { limite: mesure.limite, utilise: mesure.utilise, plan: mesure.plan })
  }
  return mesure
}

/** Usage de chaque ressource au regard du plan effectif (carte Abonnement). */
export async function getQuotas(userId: string, now: Date = new Date(), executor: Executor = db): Promise<QuotaDTO[]> {
  const { effectif, fuseau } = await lirePlan(executor, userId, now)
  const [vitrine] = await executor
    .select({ id: vitrines.id, fuseau: vitrines.fuseau })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  return Promise.all(
    RESSOURCES_QUOTA.map(async (ressource): Promise<QuotaDTO> => {
      const limite = limiteDe(effectif.plan, ressource)
      const sansVitrine = vitrine === undefined && ressource !== 'generations_ia_mois'
      if (sansVitrine) return { ressource, utilise: 0, limite }
      const contexte: ContexteQuota = {
        userId,
        ...(vitrine === undefined ? {} : { vitrineId: vitrine.id }),
        ...(ressource === 'reservations_mois' && vitrine !== undefined ? { fuseau: vitrine.fuseau } : {}),
      }
      return { ressource, utilise: await compterUtilise(executor, contexte, ressource, fuseau, now), limite }
    }),
  )
}

/**
 * Compteur des propositions de l'IA du mois civil (fuseau du compte), comparé à la limite du plan effectif.
 * Compte les générations `terminee` ET celles en cours dont le job peut encore aboutir (#124) ; un repli ne
 * consomme rien.
 */
export async function getIaQuota(userId: string, now: Date = new Date()): Promise<QuotaIaDTO> {
  const { effectif, fuseau } = await lirePlan(db, userId, now)
  const limite = limiteDe(effectif.plan, 'generations_ia_mois')
  const utilisees = await compterUtilise(db, { userId }, 'generations_ia_mois', fuseau, now)
  return {
    plan: effectif.plan,
    limite,
    utilisees,
    restantes: limite === null ? null : Math.max(0, limite - utilisees),
    depasse: limite !== null && utilisees >= limite,
  }
}

/**
 * A4 (D-A4-11) : le compte a-t-il une capacité accordée par l'administration (non révoquée) ? Lecture directe, sans
 * cache : une révocation prend effet au prochain appel. Se combine avec le plan (capacité incluse dans le plan payant).
 */
export async function aCapaciteAccordee(userId: string, capacite: CapacitePayante, executor: Executor = db): Promise<boolean> {
  const [ligne] = await executor
    .select({ id: capacitesAccordees.id })
    .from(capacitesAccordees)
    .where(and(eq(capacitesAccordees.userId, userId), eq(capacitesAccordees.capacite, capacite), isNull(capacitesAccordees.revoqueLe)))
    .limit(1)
  return ligne !== undefined
}

/** Capacité `mcp` : plan payant (actif ou en grâce) OU capacité accordée par l'administration. */
export async function aCapaciteMcp(userId: string, now: Date = new Date(), executor: Executor = db): Promise<boolean> {
  const plan = await getPlanEffectif(userId, now, executor)
  // A5 : la capacité `mcp` d'un plan vient de sa version active (`capacites.mcp`), plus d'une règle codée en dur.
  if (lirePlanVersionne(plan.plan).capacites.mcp) return true
  return aCapaciteAccordee(userId, 'mcp', executor)
}
