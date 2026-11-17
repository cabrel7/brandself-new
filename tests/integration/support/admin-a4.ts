import { randomUUID } from 'node:crypto'
import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { sql } from 'drizzle-orm'
import Redis from 'ioredis'
import type { H3Event } from 'h3'
import { vi } from 'vitest'
import { ADMIN_IDEMPOTENCE_ENTETE, ADMIN_REAUTH_ENTETE } from '../../../shared/admin'
import { reglages } from '../../../shared/db/schema'
import { env } from '../../../shared/env'
import { FILES_SUPERVISEES } from '../../../shared/jobs'
import type { FileSupervisee } from '../../../shared/jobs'
import type { ReglageCle, ReglageValeur } from '../../../shared/reglages'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { fakeEvent } from '../../support/h3'
import { demanderEtLireCode, hoteDe, origineDe } from './admin'
import type { Hote } from './admin'

// Aides des tests d'intégration d'A4 (docs/specs/A4-supervision-reglages.md §7). Mêmes règles qu'A1 à A3 : état de
// départ par insertions DIRECTES, comportement prouvé par les routes et services RÉELS sur PostgreSQL, Redis, BullMQ et
// Better Auth réels ; jamais de mock du journal, des droits, des déclencheurs, du repository ni de la file. Seuls
// l'horloge et les tiers (expéditeurs d'OTP) sont factices. Imports PARESSEUX (phase RED lisible : un module absent
// fait échouer le test qui l'utilise, pas la collecte du fichier). Chaque fichier d'intégration a sa base ET son
// Redis (tests/integration/support/bases-par-worker.ts) : rien ici ne suppose une base commune.
//
// ============================================================================================================
// CONTRAT SUPPOSÉ DE LA COUCHE SERVEUR (les noms que la spec ne fixe pas sont des PROPOSITIONS du tester : un seul
// endroit à corriger ici si le backend en choisit d'autres).
//   Fichiers de route (convention d'A2/A3 : `index.get.ts` pour une liste, `[x].put.ts`, `<verbe>.post.ts`) :
//     server/api/admin/reglages/index.get.ts            reglages/[cle].put.ts
//     server/api/admin/systemes/jobs/index.get.ts       systemes/jobs/relancer.post.ts   systemes/jobs/purger.post.ts
//     server/api/admin/systemes/{envois,ia,pwa,sante,assistants}.get.ts
//     server/api/admin/utilisateurs/[id]/capacites/index.post.ts   utilisateurs/[id]/capacites/[capacite].delete.ts
//     server/api/admin/journal/index.get.ts             journal/verifier.get.ts          journal/export.post.ts
//     server/api/public/etat.get.ts
//   Réauthentification (code lié à action, type de cible, cible) : reglage.modifier / reglage / <clé>,
//     job.purger / job / <file>, capacite.accorder / utilisateur / <id utilisateur>.
//   Idempotence : `cleIdempotence` dans le corps (réglage, relance) ; en-tête `Idempotency-Key` pour accorder une capacité.
//   Services : server/services/reglages.ts (`Reglages`), server/services/supervision-echecs.ts (`enregistrerEchecFile(file, now)`),
//     server/services/admin/supervision-alertes.ts (`alerterSiSeuil(now)`), server/services/envois-codes.ts (`enregistrerEnvoi`),
//     server/middleware/maintenance.ts (export par défaut : gestionnaire h3 qui lève 503 MAINTENANCE).
//   OTP (CA12) : `processOtpJob(name, data, cle, senders, tentative)` de server/jobs/otp.ts (le journal des envois y est écrit).
// ============================================================================================================

export const reglagesModule = () => import('../../../server/services/reglages')
export const supervisionEchecsModule = () => import('../../../server/services/supervision-echecs')
export const supervisionAlertesModule = () => import('../../../server/services/admin/supervision-alertes')
export const envoisCodesModule = () => import('../../../server/services/envois-codes')
export const otpJobModule = () => import('../../../server/jobs/otp')
export const middlewareMaintenance = () => import('../../../server/middleware/maintenance')

type Charger = () => Promise<{ default: (event: H3Event) => unknown }>

export const CHARGEURS_A4 = {
  reglagesListe: () => import('../../../server/api/admin/reglages/index.get'),
  reglageModifier: () => import('../../../server/api/admin/reglages/[cle].put'),
  jobsEtat: () => import('../../../server/api/admin/systemes/jobs/index.get'),
  jobRelancer: () => import('../../../server/api/admin/systemes/jobs/relancer.post'),
  jobsPurger: () => import('../../../server/api/admin/systemes/jobs/purger.post'),
  envois: () => import('../../../server/api/admin/systemes/envois.get'),
  agregatsIa: () => import('../../../server/api/admin/systemes/ia.get'),
  agregatsPwa: () => import('../../../server/api/admin/systemes/pwa.get'),
  sante: () => import('../../../server/api/admin/systemes/sante.get'),
  assistants: () => import('../../../server/api/admin/systemes/assistants.get'),
  capaciteAccorder: () => import('../../../server/api/admin/utilisateurs/[id]/capacites/index.post'),
  capaciteRevoquer: () => import('../../../server/api/admin/utilisateurs/[id]/capacites/[capacite].delete'),
  journalListe: () => import('../../../server/api/admin/journal/index.get'),
  journalVerifier: () => import('../../../server/api/admin/journal/verifier.get'),
  journalExport: () => import('../../../server/api/admin/journal/export.post'),
  etatPublic: () => import('../../../server/api/public/etat.get'),
} as const satisfies Record<string, Charger>

export type RouteA4 = keyof typeof CHARGEURS_A4

type MethodeA4 = 'GET' | 'POST' | 'PUT' | 'DELETE'

const A = '/api/admin'
export const MODELES_A4: Readonly<Record<RouteA4, { methode: MethodeA4, modele: string }>> = {
  reglagesListe: { methode: 'GET', modele: `${A}/reglages` },
  reglageModifier: { methode: 'PUT', modele: `${A}/reglages/:cle` },
  jobsEtat: { methode: 'GET', modele: `${A}/systemes/jobs` },
  jobRelancer: { methode: 'POST', modele: `${A}/systemes/jobs/relancer` },
  jobsPurger: { methode: 'POST', modele: `${A}/systemes/jobs/purger` },
  envois: { methode: 'GET', modele: `${A}/systemes/envois` },
  agregatsIa: { methode: 'GET', modele: `${A}/systemes/ia` },
  agregatsPwa: { methode: 'GET', modele: `${A}/systemes/pwa` },
  sante: { methode: 'GET', modele: `${A}/systemes/sante` },
  assistants: { methode: 'GET', modele: `${A}/systemes/assistants` },
  capaciteAccorder: { methode: 'POST', modele: `${A}/utilisateurs/:id/capacites` },
  capaciteRevoquer: { methode: 'DELETE', modele: `${A}/utilisateurs/:id/capacites/:capacite` },
  journalListe: { methode: 'GET', modele: `${A}/journal` },
  journalVerifier: { methode: 'GET', modele: `${A}/journal/verifier` },
  journalExport: { methode: 'POST', modele: `${A}/journal/export` },
  etatPublic: { methode: 'GET', modele: '/api/public/etat' },
}

export interface OptionsA4 {
  params?: Record<string, string>
  query?: Record<string, string>
  corps?: unknown
  cookie?: string
  reauth?: string
  /** En-tête `Idempotency-Key` (accorder une capacité). */
  cleIdempotenceEntete?: string
  hote?: Hote
  entetes?: Record<string, string>
}

export interface ReponseA4 {
  status: number
  /** Corps de succès (objet JSON relu, ou texte pour un export CSV). */
  corps: unknown
  code: string | undefined
  data: Record<string, unknown> | undefined
  entetes: Record<string, string | undefined>
}

const ENTETES_LUS = ['content-type', 'content-disposition', 'cache-control', 'retry-after'] as const
const MODULE_ABSENT = /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/

function remplacer(modele: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((chemin, [nom, valeur]) => chemin.replace(`:${nom}`, encodeURIComponent(valeur)), modele)
}

/** Appelle une route d'A4 (gestionnaire Nitro réel, événement h3 réel). Un module absent est relancé tel quel. */
export async function appelerA4(route: RouteA4, options: OptionsA4 = {}): Promise<ReponseA4> {
  const { default: handler } = await CHARGEURS_A4[route]()
  const { methode, modele } = MODELES_A4[route]
  const hote = options.hote ?? 'admin'
  const entetes: Record<string, string> = { host: hoteDe(hote), ...options.entetes }
  if (methode !== 'GET') entetes.origin = origineDe(hote)
  if (options.cookie) entetes.cookie = options.cookie
  if (options.reauth !== undefined) entetes[ADMIN_REAUTH_ENTETE] = options.reauth
  if (options.cleIdempotenceEntete !== undefined) entetes[ADMIN_IDEMPOTENCE_ENTETE] = options.cleIdempotenceEntete
  const chemin = remplacer(modele, options.params ?? {})
  const requete = new URLSearchParams(options.query ?? {}).toString()
  const event = fakeEvent({
    method: methode,
    url: requete === '' ? chemin : `${chemin}?${requete}`,
    headers: entetes,
    ...(options.params === undefined ? {} : { params: options.params }),
    ...(options.corps === undefined ? {} : { body: typeof options.corps === 'string' ? options.corps : JSON.stringify(options.corps) }),
  })
  const lireEntetes = (): Record<string, string | undefined> =>
    Object.fromEntries(ENTETES_LUS.map((nom) => {
      const valeur = event.node.res.getHeader(nom)
      return [nom, valeur === undefined ? undefined : String(valeur)]
    }))
  try {
    const corps = await handler(event)
    const lu: unknown = corps === undefined || corps === null ? null : typeof corps === 'string' ? corps : JSON.parse(JSON.stringify(corps))
    return { status: event.node.res.statusCode, corps: lu, code: undefined, data: undefined, entetes: lireEntetes() }
  } catch (erreur) {
    if (erreur instanceof Error && MODULE_ABSENT.test(erreur.message)) throw erreur
    const h3 = erreur as { statusCode?: number, data?: Record<string, unknown> & { code?: string } }
    return { status: h3.statusCode ?? -1, corps: undefined, code: h3.data?.code, data: h3.data, entetes: lireEntetes() }
  }
}

// ---------------------------------------------------------------------------------------------
// Réauthentification et écriture d'un réglage par la VRAIE route.
// ---------------------------------------------------------------------------------------------

export const MOTIF_A4 = 'Décision d’exploitation validée'
export const cleIdempotenceA4 = (): string => `cle-${randomUUID()}`

export async function codeReglage(adminId: string, cle: string): Promise<string> {
  return (await demanderEtLireCode(adminId, { action: 'reglage.modifier', cibleType: 'reglage', cibleId: cle })).code
}

export interface EcritureOptions {
  cleIdempotence?: string
  motif?: string
  /** `null` : aucun en-tête de réauthentification ; absent : un code valide est demandé (sauf `sansCode`). */
  reauth?: string | null
  /** Réglage sans réauthentification (message de maintenance, défauts d'agenda) : n'en demande pas. */
  sansCode?: boolean
}

export interface AdminA4 {
  admin: { id: string }
  cookie: string
}

/** `PUT /api/admin/reglages/[cle]` avec un code de réauthentification frais (sauf `sansCode` ou `reauth` fourni). */
export async function ecrireReglage(connecte: AdminA4, cle: string, valeur: ReglageValeur | null, options: EcritureOptions = {}): Promise<ReponseA4> {
  const reauth = options.reauth === undefined
    ? (options.sansCode === true ? undefined : await codeReglage(connecte.admin.id, cle))
    : (options.reauth ?? undefined)
  return appelerA4('reglageModifier', {
    params: { cle },
    cookie: connecte.cookie,
    ...(reauth === undefined ? {} : { reauth }),
    corps: { valeur, motif: options.motif ?? MOTIF_A4, cleIdempotence: options.cleIdempotence ?? cleIdempotenceA4() },
  })
}

// ---------------------------------------------------------------------------------------------
// Réglages : lecture et état direct (les lignes posées ici simulent « une autre instance » ou l'état de départ).
// ---------------------------------------------------------------------------------------------

export async function viderCacheReglages(): Promise<void> {
  const { Reglages } = await reglagesModule()
  Reglages._viderCache()
}

/** Pose une ligne de `reglages` directement (le cache du processus est vidé : la lecture voit la ligne). */
export async function poserReglage(cle: ReglageCle, valeur: ReglageValeur, modifiePar: string): Promise<void> {
  await db.insert(reglages).values({ cle, valeur, modifiePar }).onConflictDoUpdate({ target: reglages.cle, set: { valeur, modifiePar } })
  await viderCacheReglages()
}

export interface LigneReglage {
  cle: string
  valeur: unknown
  modifie_par: string
  modifie_le: Date | string
}

export async function lignesReglages(): Promise<LigneReglage[]> {
  const resultat = await db.execute<LigneReglage>(sql`SELECT cle, valeur, modifie_par, modifie_le FROM reglages ORDER BY cle`)
  return resultat.rows
}

/** Rend la table des réglages illisible (renommée) le temps de `corps`, puis la rétablit dans un `finally`. Aucun mock : PostgreSQL lève. */
export async function avecTableReglagesIllisible<T>(corps: () => Promise<T>): Promise<T> {
  await viderCacheReglages()
  await db.execute(sql`ALTER TABLE reglages RENAME TO reglages_hors_service`)
  try {
    return await corps()
  } finally {
    await db.execute(sql`ALTER TABLE reglages_hors_service RENAME TO reglages`)
    await viderCacheReglages()
  }
}

// ---------------------------------------------------------------------------------------------
// Remise à zéro des ressources d'A4 que `tests/integration/setup.ts` ne vide pas (tables sans clé vers `users`, clés Redis
// `supervision:*`, files supervisées, cache de réglages). À appeler dans `beforeEach` des fichiers d'A4.
// ---------------------------------------------------------------------------------------------

const PREFIXE_SUPERVISION = 'supervision:'

export async function reinitialiserA4(options: { files?: boolean } = {}): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE envois_codes, battements_systeme RESTART IDENTITY`)
  const cles = await redis.keys(`${PREFIXE_SUPERVISION}*`)
  if (cles.length > 0) await redis.del(...cles)
  await viderCacheReglages()
  if (options.files === true) await viderFilesSupervisees()
}

// ---------------------------------------------------------------------------------------------
// Files BullMQ RÉELLES. Aucun worker permanent : un job échoué l'est parce qu'un Worker de test a levé une erreur.
// ---------------------------------------------------------------------------------------------

const files = new Map<string, Queue>()

export function fileReelle(nom: FileSupervisee): Queue {
  let file = files.get(nom)
  if (!file) {
    file = new Queue(nom, { connection: redis })
    files.set(nom, file)
  }
  return file
}

export async function viderFilesSupervisees(): Promise<void> {
  for (const nom of FILES_SUPERVISEES) await fileReelle(nom).obliterate({ force: true })
}

export async function fermerFilesReelles(): Promise<void> {
  for (const file of files.values()) await file.close()
  files.clear()
}

/** Tous les jobs en attente ou différés, toutes files supervisées confondues (détecte une alerte « enfilée » où qu'elle soit). */
export async function compterJobsEnFile(): Promise<number> {
  let total = 0
  for (const nom of FILES_SUPERVISEES) {
    const compteurs = await fileReelle(nom).getJobCounts('waiting', 'delayed', 'prioritized', 'active')
    total += Object.values(compteurs).reduce((somme, n) => somme + n, 0)
  }
  return total
}

export async function compterOutboxTotal(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM emails_transactionnels`)
  return Number(resultat.rows[0]?.n ?? 0)
}

/** Données et message d'erreur « canaris » : s'ils ressortent d'une réponse d'administration, c'est une fuite. */
export const CANARI_JOB = {
  email: 'canari.job.zorglub@exemple.test',
  code: '482916',
  erreur: 'Resend a refusé canari.job.zorglub@exemple.test avec le jeton sk_canari_secret_9f3',
} as const

/**
 * Crée un job réellement `failed` dans `file` : un Worker de test le prend et lève une erreur dont le message contient un
 * canari. Le Worker est fermé avant de rendre la main (les jobs suivants restent en attente).
 */
export async function creerJobEchoue(file: FileSupervisee, nom = 'send-transactional-email', erreur: string = CANARI_JOB.erreur): Promise<string> {
  const queue = fileReelle(file)
  const job = await queue.add(nom, { identifier: CANARI_JOB.email, code: CANARI_JOB.code }, { attempts: 1, removeOnFail: false })
  const connexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker(file, async () => { throw new Error(erreur) }, { connection: connexion, concurrency: 1 })
  try {
    await vi.waitFor(async () => {
      const lu = await queue.getJob(job.id ?? '')
      if ((await lu?.getState()) !== 'failed') throw new Error('Job pas encore échoué.')
    }, { timeout: 15_000, interval: 100 })
  } finally {
    await worker.close()
    connexion.disconnect()
  }
  if (job.id === undefined) throw new Error('Job sans identifiant.')
  return job.id
}

export async function etatJob(file: FileSupervisee, id: string): Promise<string | undefined> {
  const job: Job | undefined = await fileReelle(file).getJob(id)
  return job === undefined ? undefined : await job.getState()
}

// ---------------------------------------------------------------------------------------------
// Journal d'envoi des codes.
// ---------------------------------------------------------------------------------------------

export interface LigneEnvoi {
  id: string
  cree_le: Date | string
  canal: string
  pays: string | null
  statut: string
  tentative: number
  code_erreur: string | null
}

export async function lignesEnvois(): Promise<LigneEnvoi[]> {
  const resultat = await db.execute<LigneEnvoi>(sql`SELECT id::text AS id, cree_le, canal, pays, statut, tentative, code_erreur FROM envois_codes ORDER BY id`)
  return resultat.rows
}

const FONCTION_PANNE_ENVOIS = 'test_a4_panne_envois'
const DECLENCHEUR_PANNE_ENVOIS = 'zz_test_a4_panne_envois'

async function retirerPanneEnvois(): Promise<void> {
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${DECLENCHEUR_PANNE_ENVOIS} ON envois_codes`))
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${FONCTION_PANNE_ENVOIS}()`))
}

/** Fait refuser toute insertion dans `envois_codes` par PostgreSQL (déclencheur de test, retiré dans un `finally`). */
export async function avecEnvoisEnPanne<T>(corps: () => Promise<T>): Promise<T> {
  await retirerPanneEnvois()
  await db.execute(sql.raw(`CREATE FUNCTION ${FONCTION_PANNE_ENVOIS}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'panne du journal des envois simulee'; END $$`))
  await db.execute(sql.raw(`CREATE TRIGGER ${DECLENCHEUR_PANNE_ENVOIS} BEFORE INSERT ON envois_codes FOR EACH ROW EXECUTE FUNCTION ${FONCTION_PANNE_ENVOIS}()`))
  try {
    return await corps()
  } finally {
    await retirerPanneEnvois()
  }
}

// ---------------------------------------------------------------------------------------------
// Maintenance : le middleware est appelé avec un événement h3 réel ; `hoteAdmin` est posé comme le fait `00-hote.ts`.
// ---------------------------------------------------------------------------------------------

export interface ResultatMiddleware {
  status: number | undefined
  code: string | undefined
  retryAfter: string | undefined
  /** Données de l'erreur (porte le message de maintenance de l'administrateur). */
  data: unknown
  /** Le middleware a laissé passer (aucune erreur levée). */
  laisse: boolean
}

export async function passerParMaintenance(methode: string, chemin: string, hote: Hote = 'public'): Promise<ResultatMiddleware> {
  const { default: handler } = await middlewareMaintenance()
  const event = fakeEvent({ method: methode, url: chemin, headers: { host: hoteDe(hote), origin: origineDe(hote) } })
  event.context.hoteAdmin = hote === 'admin'
  try {
    await (handler as (e: H3Event) => unknown)(event)
    return { status: undefined, code: undefined, retryAfter: undefined, data: undefined, laisse: true }
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, data?: { code?: string } }
    const retry = event.node.res.getHeader('retry-after')
    return { status: h3.statusCode, code: h3.data?.code, retryAfter: retry === undefined ? undefined : String(retry), data: h3.data, laisse: false }
  }
}

// ---------------------------------------------------------------------------------------------
// Caches de processus (5 s) : `server/auth.config.ts` garde l'état des inscriptions 5 s, sans fonction de vidage (il ne peut pas
// importer le code serveur). L'horloge `Date.now()` est avancée (jamais reculée dans un même fichier : une entrée de cache créée
// « dans le futur » resterait valable) ; `new Date()` n'est pas touché. À rétablir en `afterAll`.
// ---------------------------------------------------------------------------------------------

const maintenantReel = Date.now.bind(Date)
let avanceMs = 0

export function expirerCachesProcessus(ms = 6_000): void {
  avanceMs += ms
  vi.spyOn(Date, 'now').mockImplementation(() => maintenantReel() + avanceMs)
}

export function retablirHorloge(): void {
  avanceMs = 0
  vi.restoreAllMocks()
}

// ---------------------------------------------------------------------------------------------
// Divers.
// ---------------------------------------------------------------------------------------------

/** Texte de toute la réponse, pour prouver l'ABSENCE d'une chaîne (donnée de visiteur, secret). */
export const brut = (reponse: ReponseA4): string => JSON.stringify(reponse.corps ?? reponse.data ?? null)
