import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, afterAll } from 'vitest'
import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_IDEMPOTENCE_ENTETE, ADMIN_REAUTH_ENTETE } from '../../../shared/admin'
import type { ActiverVersion } from '../../../shared/schemas/admin-versions'
import { PLANS, PRIX_PLANS } from '../../../server/config/plans'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { fakeEvent } from '../../support/h3'
import { demanderEtLireCode, hoteDe, origineDe, MOTIF_TEST } from './admin'
import type { ReponseRouteAdmin } from './admin'
import type { UserRow } from './fabriques'

// Aides des tests d'intégration d'A5 (docs/specs/A5-catalogues-versions.md, tier critique). Mêmes règles qu'A1 à A3 :
// état de départ par insertions DIRECTES, comportement prouvé par les routes et services RÉELS (PostgreSQL, Redis, Better
// Auth, journal, réauthentification) ; jamais de mock du journal, des droits, des déclencheurs ni des verrous.
//
// ============================================================================================================
// NOMS DE FICHIERS DES ROUTES (PROPOSITION du tester, à corriger ICI si le backend en choisit d'autres : un seul endroit).
// Convention Nitro d'A2/A3 : `index.<verbe>.ts`, `[id].<verbe>.ts`, `[id]/<action>.post.ts` ; les routes statiques
// `versions/plans/impact` et `versions/prompts/essai` priment sur `versions/[type]/…`.
//
// NOMS DE SERVICES SUPPOSÉS (spec §5, propositions marquées *) :
//   server/services/configuration/lecture.ts    lireVersionActive(categorie, cle, { sansCache }), lirePlanConfig(plan) (sync),
//                                               lireGrillePrix(), lireFrais(fournisseur, methode), lireMoyensActifs()
//   server/services/configuration/versions.ts   appliquerVersionsProgrammees()*  (corps du job `versions-appliquer`)
//   server/services/configuration/catalogues.ts verifierNomUtilisateur(valeur)
//   server/jobs/versions-appliquer.ts           planifierVersionsAppliquer(queue: { upsertJobScheduler })
// SENS DE `[id]/retour` (⚠️ ambigu dans la spec) : `id` = la version ANTÉRIEURE à restaurer (statut `remplacee`, ou prompt
// inactif de numéro inférieur) ; elle redevient active, l'actuelle devient `remplacee`. `activer` ne s'applique qu'à un
// brouillon ou une version programmée (sinon 422 VERSION_NON_ACTIVABLE).
// ============================================================================================================

export const CHARGEURS_A5 = {
  cataloguesListe: () => import('../../../server/api/admin/catalogues/[nom]/index.get'),
  cataloguesCreer: () => import('../../../server/api/admin/catalogues/[nom]/index.post'),
  catalogueModifier: () => import('../../../server/api/admin/catalogues/[nom]/[id].patch'),
  catalogueSupprimer: () => import('../../../server/api/admin/catalogues/[nom]/[id].delete'),
  versionsListe: () => import('../../../server/api/admin/versions/[type]/index.get'),
  versionsCreer: () => import('../../../server/api/admin/versions/[type]/index.post'),
  versionActiver: () => import('../../../server/api/admin/versions/[type]/[id]/activer.post'),
  versionRetour: () => import('../../../server/api/admin/versions/[type]/[id]/retour.post'),
  prixValider: () => import('../../../server/api/admin/versions/[type]/[id]/valider.post'),
  plansImpact: () => import('../../../server/api/admin/versions/[type]/impact.post'),
  promptsEssai: () => import('../../../server/api/admin/versions/[type]/essai.post'),
  referentiels: () => import('../../../server/api/public/referentiels.get'),
} as const
export type RouteA5 = keyof typeof CHARGEURS_A5

type Methode = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface Description {
  methode: Methode
  modele: string
  /** Action et type de cible liés au code de réauthentification (cible = identifiant de la version), `null` sinon. */
  reauth: { action: string, cibleType: string } | null
}

const A = '/api/admin'
export const DESCRIPTIONS_A5: Readonly<Record<RouteA5, Description>> = {
  cataloguesListe: { methode: 'GET', modele: `${A}/catalogues/:nom`, reauth: null },
  cataloguesCreer: { methode: 'POST', modele: `${A}/catalogues/:nom`, reauth: null },
  catalogueModifier: { methode: 'PATCH', modele: `${A}/catalogues/:nom/:id`, reauth: null },
  catalogueSupprimer: { methode: 'DELETE', modele: `${A}/catalogues/:nom/:id`, reauth: null },
  versionsListe: { methode: 'GET', modele: `${A}/versions/:type`, reauth: null },
  versionsCreer: { methode: 'POST', modele: `${A}/versions/:type`, reauth: null },
  versionActiver: { methode: 'POST', modele: `${A}/versions/:type/:id/activer`, reauth: { action: ADMIN_ACTIONS.versionActiver, cibleType: ADMIN_CIBLES.version } },
  versionRetour: { methode: 'POST', modele: `${A}/versions/:type/:id/retour`, reauth: { action: ADMIN_ACTIONS.versionRetour, cibleType: ADMIN_CIBLES.version } },
  prixValider: { methode: 'POST', modele: `${A}/versions/:type/:id/valider`, reauth: { action: ADMIN_ACTIONS.versionValiderPrix, cibleType: ADMIN_CIBLES.version } },
  plansImpact: { methode: 'POST', modele: `${A}/versions/:type/impact`, reauth: null },
  promptsEssai: { methode: 'POST', modele: `${A}/versions/:type/essai`, reauth: null },
  referentiels: { methode: 'GET', modele: '/api/public/referentiels', reauth: null },
}

/** Routes statiques en pratique : `[type]` est fixé par la nature de la route (impact d'un plan, essai d'un prompt, validation d'un prix). */
const PARAMS_PAR_DEFAUT: Partial<Record<RouteA5, Record<string, string>>> = {
  plansImpact: { type: 'plans' },
  promptsEssai: { type: 'prompts' },
  prixValider: { type: 'prix' },
}

export const MOTIF_A5 = MOTIF_TEST
export const MOTIF_REVISION = 'Revue trimestrielle de la grille'

export interface AdminA5 {
  admin: UserRow
  cookie: string
}

export interface OptionsA5 {
  /** Paramètres de route : `nom`, `type`, `id`. */
  params?: Record<string, string>
  query?: Record<string, string>
  corps?: unknown
  reauth?: string
  cleIdempotence?: string
  /** Absent : session de l'administrateur de la suite. `null` : aucune session. */
  cookie?: string | null
}

const cleUnique = (): string => `cle-${randomUUID()}`
export { cleUnique as cleIdempotenceUnique }

/** Appelle une route d'A5 (handler Nitro réel, événement h3 réel). Le module de route absent est relancé tel quel (phase RED lisible). */
export async function appelerA5(route: RouteA5, connecte: AdminA5 | null, options: OptionsA5 = {}): Promise<ReponseRouteAdmin> {
  const { default: handler } = await CHARGEURS_A5[route]() as { default: (event: H3Event) => unknown }
  const description = DESCRIPTIONS_A5[route]
  const publique = route === 'referentiels'
  const hote = publique ? 'public' : 'admin'
  let chemin = description.modele
  const params = { ...PARAMS_PAR_DEFAUT[route], ...options.params }
  for (const [cle, valeur] of Object.entries(params)) chemin = chemin.replace(`:${cle}`, valeur)
  const entetes: Record<string, string> = { host: hoteDe(hote) }
  if (description.methode !== 'GET') entetes.origin = origineDe(hote)
  const cookie = options.cookie === undefined ? connecte?.cookie : (options.cookie ?? undefined)
  if (cookie) entetes.cookie = cookie
  if (options.reauth !== undefined) entetes[ADMIN_REAUTH_ENTETE] = options.reauth
  if (options.cleIdempotence !== undefined) entetes[ADMIN_IDEMPOTENCE_ENTETE] = options.cleIdempotence
  const requete = new URLSearchParams(options.query ?? {}).toString()
  const event = fakeEvent({
    method: description.methode,
    url: requete === '' ? chemin : `${chemin}?${requete}`,
    headers: entetes,
    params,
    ...(options.corps === undefined ? {} : { body: JSON.stringify(options.corps) }),
  })
  try {
    const corps = await handler(event)
    const lu: unknown = corps === undefined || corps === null ? null : JSON.parse(JSON.stringify(corps))
    return { status: event.node.res.statusCode, corps: lu, code: undefined, data: undefined, message: undefined }
  } catch (erreur) {
    if (erreur instanceof Error && /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/.test(erreur.message)) throw erreur
    const h3 = erreur as { statusCode?: number, data?: Record<string, unknown>, message?: string }
    const code = h3.data?.code
    return { status: h3.statusCode ?? -1, corps: undefined, code: typeof code === 'string' ? code : undefined, data: h3.data, message: h3.message }
  }
}

/** Code de réauthentification lié à (action de la route, type `version`, identifiant de la version). */
export async function codeReauthVersion(adminId: string, route: 'versionActiver' | 'versionRetour' | 'prixValider', versionId: string): Promise<string> {
  const exigence = DESCRIPTIONS_A5[route].reauth
  if (exigence === null) throw new Error(`La route ${route} n'exige pas de réauthentification.`)
  return (await demanderEtLireCode(adminId, { action: exigence.action, cibleType: exigence.cibleType, cibleId: versionId })).code
}

/**
 * Code de réauthentification d'une écriture de CATALOGUE : le backend lie le code à (action `catalogue.*`, cible `catalogue`,
 * identifiant `<nom>:<code ou valeur>`), ex. `pays:TD`, `noms-bloques:marque`. La spec ne le disait pas : décision du backend, suivie ici.
 */
export async function codeReauthCatalogue(adminId: string, action: 'catalogueCreer' | 'catalogueModifier' | 'catalogueSupprimer', cibleId: string): Promise<string> {
  return (await demanderEtLireCode(adminId, { action: ADMIN_ACTIONS[action], cibleType: ADMIN_CIBLES.catalogue, cibleId })).code
}

// ---------------------------------------------------------------------------------------------
// Valeurs valides par type (reprises des constantes du code, donc de la version 1 seedée : test seed-v1).
// ---------------------------------------------------------------------------------------------

export type ValeursPlanTest = typeof PLANS.gratuit & { capacites: { mcp: boolean } }
export const valeursGratuit = (surcharges: Partial<ValeursPlanTest> = {}): ValeursPlanTest => ({ ...PLANS.gratuit, capacites: { mcp: false }, ...surcharges })
export const valeursPayant = (surcharges: Partial<ValeursPlanTest> = {}): ValeursPlanTest => ({ ...PLANS.payant, capacites: { mcp: true }, ...surcharges })

/** Grille complète (3 devises x 1, 3, 12 mois) ; `xaf12` remplace le prix de 12 mois en XAF. */
export function grillePrix(xaf12: number = PRIX_PLANS.payant.XAF[12]): Record<'XAF' | 'EUR' | 'USD', Record<1 | 3 | 12, number>> {
  const grille = structuredClone(PRIX_PLANS.payant) as Record<'XAF' | 'EUR' | 'USD', Record<1 | 3 | 12, number>>
  grille.XAF[12] = xaf12
  return grille
}

export const VALEURS_PROMPT_TEST = {
  systeme: 'Tu écris des textes courts et clairs pour une vitrine de professionnel.',
  gabarit: 'Rédige à partir de ces données : {{donnees}}',
  parametres: { temperature: 0.3, maxTokens: 900 },
} as const

// ---------------------------------------------------------------------------------------------
// Écritures par les routes : brouillon, activation (réauthentifiée), retour, validation.
// ---------------------------------------------------------------------------------------------

export interface VersionLue {
  id: string
  categorie: string
  cle: string
  numero: number
  statut: string
  valeurs: Record<string, unknown>
  effectiveA: Date | null
  valideeLe: Date | null
  motif: string
  creePar: string
}

interface LigneVersionBrute {
  id: string
  categorie: string
  cle: string
  numero: number
  statut: string
  valeurs: Record<string, unknown>
  effective_a: Date | string | null
  validee_le: Date | string | null
  motif: string
  cree_par: string
}

const enDate = (valeur: Date | string | null): Date | null => (valeur === null ? null : valeur instanceof Date ? valeur : new Date(valeur))

/** Versions d'une (catégorie, clé), de la plus ancienne à la plus récente (lecture directe en base). */
export async function lireVersions(categorie: string, cle: string): Promise<VersionLue[]> {
  const resultat = await db.execute<LigneVersionBrute>(sql`
    SELECT id, categorie, cle, numero, statut, valeurs, effective_a, validee_le, motif, cree_par
    FROM configuration_versions WHERE categorie = ${categorie} AND cle = ${cle} ORDER BY numero`)
  return resultat.rows.map((r) => ({
    id: r.id, categorie: r.categorie, cle: r.cle, numero: r.numero, statut: r.statut, valeurs: r.valeurs,
    effectiveA: enDate(r.effective_a), valideeLe: enDate(r.validee_le), motif: r.motif, creePar: r.cree_par,
  }))
}

export async function versionActive(categorie: string, cle: string): Promise<VersionLue> {
  const active = (await lireVersions(categorie, cle)).find((v) => v.statut === 'active')
  if (!active) throw new Error(`Aucune version active pour ${categorie}/${cle}.`)
  return active
}

export async function compterVersions(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM configuration_versions`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export function creerBrouillon(connecte: AdminA5, type: 'plans' | 'prix' | 'frais' | 'moyens' | 'prompts', cle: string, valeurs: unknown, options: { motif?: string, cleIdempotence?: string } = {}): Promise<ReponseRouteAdmin> {
  return appelerA5('versionsCreer', connecte, {
    params: { type },
    corps: { cle, valeurs, motif: options.motif ?? MOTIF_A5 },
    cleIdempotence: options.cleIdempotence ?? cleUnique(),
  })
}

/** Identifiant de la version renvoyée par une écriture réussie (échoue clairement sinon). */
export function idDeReponse(reponse: ReponseRouteAdmin): string {
  const version = (reponse.corps as { version?: { id?: unknown } } | null)?.version
  if (reponse.status !== 200 || typeof version?.id !== 'string') {
    throw new Error(`Écriture attendue réussie, reçu ${reponse.status} ${reponse.code ?? ''} ${JSON.stringify(reponse.corps ?? reponse.data)}`)
  }
  return version.id
}

/** Crée un brouillon et renvoie son identifiant. */
export async function brouillon(connecte: AdminA5, type: 'plans' | 'prix' | 'frais' | 'moyens' | 'prompts', cle: string, valeurs: unknown): Promise<string> {
  return idDeReponse(await creerBrouillon(connecte, type, cle, valeurs))
}

export interface OptionsActivation extends Partial<Omit<ActiverVersion, 'motif'>> {
  motif?: string
  /** `null` : aucun code ; absent : un code valide lié à cette version. */
  reauth?: string | null
  cleIdempotence?: string
}

/** Active (ou programme) une version avec un code de réauthentification valide par défaut. */
export async function activer(connecte: AdminA5, type: string, id: string, options: OptionsActivation = {}): Promise<ReponseRouteAdmin> {
  const reauth = options.reauth === null ? undefined : (options.reauth ?? await codeReauthVersion(connecte.admin.id, 'versionActiver', id))
  return appelerA5('versionActiver', connecte, {
    params: { type, id },
    corps: {
      programmeePour: options.programmeePour ?? null,
      ...(options.impactAcquitte === undefined ? {} : { impactAcquitte: options.impactAcquitte }),
      motif: options.motif ?? MOTIF_A5,
    },
    ...(reauth === undefined ? {} : { reauth }),
    cleIdempotence: options.cleIdempotence ?? cleUnique(),
  })
}

export async function retourArriere(connecte: AdminA5, type: string, id: string, options: { reauth?: string | null, motif?: string, impactAcquitte?: ActiverVersion['impactAcquitte'] } = {}): Promise<ReponseRouteAdmin> {
  const reauth = options.reauth === null ? undefined : (options.reauth ?? await codeReauthVersion(connecte.admin.id, 'versionRetour', id))
  return appelerA5('versionRetour', connecte, {
    params: { type, id },
    corps: { motif: options.motif ?? MOTIF_A5, ...(options.impactAcquitte === undefined ? {} : { impactAcquitte: options.impactAcquitte }) },
    ...(reauth === undefined ? {} : { reauth }),
    cleIdempotence: cleUnique(),
  })
}

export async function validerPrix(connecte: AdminA5, id: string, options: { reauth?: string | null } = {}): Promise<ReponseRouteAdmin> {
  const reauth = options.reauth === null ? undefined : (options.reauth ?? await codeReauthVersion(connecte.admin.id, 'prixValider', id))
  return appelerA5('prixValider', connecte, {
    params: { id },
    corps: { motif: MOTIF_A5 },
    ...(reauth === undefined ? {} : { reauth }),
    cleIdempotence: cleUnique(),
  })
}

/** Crée un brouillon de plan et l'active (réauthentifié) : état de départ « la version n est active ». */
export async function activerPlan(connecte: AdminA5, cle: 'gratuit' | 'payant', valeurs: ValeursPlanTest, options: OptionsActivation = {}): Promise<string> {
  const id = await brouillon(connecte, 'plans', cle, valeurs)
  const reponse = await activer(connecte, 'plans', id, options)
  if (reponse.status !== 200) throw new Error(`Activation du plan attendue réussie, reçu ${reponse.status} ${reponse.code ?? ''}`)
  return id
}

// ---------------------------------------------------------------------------------------------
// Isolation : `configuration_versions` et `prompts_ia` refusent DELETE (42501), `pays` / `devises` / `usernames_bloques` ne
// sont pas vidés par tests/integration/setup.ts. Ce nettoyage de TEST (et lui seul) lève les déclencheurs UTILISATEUR le
// temps de la remise à l'état de départ, dans UNE transaction (le DDL est transactionnel), puis les rétablit.
// ---------------------------------------------------------------------------------------------

interface InstantaneBase {
  prompts: Array<{ id: string, actif: boolean }>
  pays: unknown[]
  devises: unknown[]
  /** Versions posées par les migrations (`systeme`) et leur statut de départ : 0035 remplace une version de 0034. */
  versionsSysteme: Array<{ id: string, statut: string }>
}

let instantane: InstantaneBase | undefined

async function prendreInstantane(): Promise<void> {
  const prompts = await db.execute<{ id: string, actif: boolean }>(sql`SELECT id, actif FROM prompts_ia`)
  const pays = await db.execute(sql`SELECT * FROM pays`)
  const devises = await db.execute(sql`SELECT * FROM devises`)
  const versionsSysteme = await db.execute<{ id: string, statut: string }>(sql`SELECT id, statut FROM configuration_versions WHERE cree_par = 'systeme'`)
  instantane = { prompts: prompts.rows, pays: pays.rows, devises: devises.rows, versionsSysteme: versionsSysteme.rows }
}

/** Remet les catalogues, les versions, les prompts et les compteurs à l'état de la migration 0032 (appelé avant chaque test et en fin de fichier). */
export async function restaurerConfiguration(): Promise<void> {
  if (!instantane) throw new Error('Instantané absent : appeler preparerConfigurationA5() au niveau du module.')
  const base = instantane
  await db.transaction(async (tx) => {
    await tx.execute(sql`ALTER TABLE configuration_versions DISABLE TRIGGER USER`)
    await tx.execute(sql`ALTER TABLE prompts_ia DISABLE TRIGGER USER`)
    await tx.execute(sql`DELETE FROM configuration_versions WHERE cree_par <> 'systeme'`)
    // Statut de départ de chaque version `systeme` (et non « tout actif » : 0035 a remplacé la v1 des moyens Mercy Pay).
    // Deux instructions : tout passe d'abord à `remplacee`, puis seules les versions actives au départ le redeviennent,
    // sans jamais deux actives en même temps (index unique de la version active).
    await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee', validee_le = NULL WHERE cree_par = 'systeme'`)
    await tx.execute(sql`
      UPDATE configuration_versions c SET statut = 'active'
      FROM json_to_recordset(${JSON.stringify(base.versionsSysteme)}::json) AS s(id text, statut text)
      WHERE c.id = s.id AND s.statut = 'active'`)
    const ids = JSON.stringify(base.prompts.map((p) => p.id))
    await tx.execute(sql`DELETE FROM prompts_ia WHERE id NOT IN (SELECT json_array_elements_text(${ids}::json))`)
    await tx.execute(sql`UPDATE prompts_ia SET actif = false`)
    const actifs = JSON.stringify(base.prompts.filter((p) => p.actif).map((p) => p.id))
    await tx.execute(sql`UPDATE prompts_ia SET actif = true WHERE id IN (SELECT json_array_elements_text(${actifs}::json))`)
    await tx.execute(sql`DELETE FROM usernames_bloques`)
    await tx.execute(sql`
      UPDATE pays p SET libelle = s.libelle, indicatif = s.indicatif, actif = s.actif, devise_defaut = s.devise_defaut,
        fuseaux = s.fuseaux, canal_sms = s.canal_sms, canal_whatsapp = s.canal_whatsapp, canal_email = s.canal_email
      FROM json_populate_recordset(NULL::pays, ${JSON.stringify(base.pays)}::json) s WHERE p.code = s.code`)
    await tx.execute(sql`
      UPDATE devises d SET actif = s.actif FROM json_populate_recordset(NULL::devises, ${JSON.stringify(base.devises)}::json) s WHERE d.code = s.code`)
    await tx.execute(sql`ALTER TABLE prompts_ia ENABLE TRIGGER USER`)
    await tx.execute(sql`ALTER TABLE configuration_versions ENABLE TRIGGER USER`)
  })
  const { viderCacheConfiguration } = await import('../../../server/services/configuration/lecture')
  const { viderCachePays } = await import('../../../server/services/configuration/catalogues')
  viderCacheConfiguration()
  viderCachePays()
  for (const motif of ['*limite:ia-essai:*', '*admin-reauth:*', '*admin-reauth-essai:*']) {
    const cles = await redis.keys(motif)
    if (cles.length > 0) await redis.del(...cles)
  }
}

/** À appeler UNE fois par fichier, au niveau du module : instantané avant le premier test, remise à zéro avant chaque test et après le dernier. */
export function preparerConfigurationA5(): void {
  beforeAll(prendreInstantane)
  beforeEach(restaurerConfiguration)
  afterAll(restaurerConfiguration)
}

// ---------------------------------------------------------------------------------------------
// Lectures utiles aux critères.
// ---------------------------------------------------------------------------------------------

export interface LignePays {
  code: string
  actif: boolean
  canal_sms: boolean
  canal_whatsapp: boolean
  canal_email: boolean
}

export async function lirePays(code: string): Promise<LignePays | undefined> {
  const resultat = await db.execute<LignePays>(sql`SELECT code, actif, canal_sms, canal_whatsapp, canal_email FROM pays WHERE code = ${code}`)
  return resultat.rows[0]
}

export async function compterTable(table: 'pays' | 'usernames_bloques' | 'prompts_ia' | 'generations_ia' | 'configuration_versions'): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.raw(table)}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export interface LignePrompt {
  id: string
  type: string
  version: number
  actif: boolean
  gabarit: string
  systeme: string
  variables: string[]
  motif: string | null
  cree_par: string | null
}

export async function lirePrompts(type: string): Promise<LignePrompt[]> {
  const resultat = await db.execute<LignePrompt>(sql`
    SELECT id, type, version, actif, gabarit, systeme, variables, motif, cree_par FROM prompts_ia WHERE type = ${type} ORDER BY version`)
  return resultat.rows
}

/** Délai maximal d'attente d'une lecture mise en cache (5 s, D-A5-04) avant de juger qu'elle ne reflète pas l'écriture. */
export const DELAI_CACHE_MS = 8_000
