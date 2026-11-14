import { randomUUID } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { Queue } from 'bullmq'
import type { Job } from 'bullmq'
import { vi } from 'vitest'
import { env } from '../../../shared/env'
import { sessions, verifications } from '../../../shared/db/schema'
import type { users } from '../../../shared/db/schema'
import { FILE_MESSAGES_AUTH, JOBS } from '../../../shared/jobs'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import type { EntreeAudit } from '../../../server/services/admin/audit'
import type { ContexteAdmin } from '../../../server/utils/admin'
import { fakeEvent } from '../../support/h3'
import { createUser } from './fabriques'
import type { SessionRow, UserRow } from './fabriques'

// Aides des tests d'intégration de l'administration (A1). RÈGLES : insertions DIRECTES pour l'état de départ ;
// base, Redis, files BullMQ et instance Better Auth RÉELS pour tout ce que les critères prouvent ; jamais de mock du
// journal, des droits ni des déclencheurs. Imports PARESSEUX des modules de production (phase RED lisible).

export const auditService = () => import('../../../server/services/admin/audit')
export const reauthService = () => import('../../../server/services/admin/reauth')
export const sessionAdminService = () => import('../../../server/services/admin/session')
export const superadminService = () => import('../../../server/services/admin/superadmin')
export const garde = () => import('../../../server/utils/admin')
export const gardeReauth = () => import('../../../server/utils/reauth')
export const jobReauth = () => import('../../../server/jobs/admin-reauth')

export const HEURE_MS = 3_600_000
/** Délai laissé à un envoi « en arrière-plan » avant d'affirmer qu'AUCUN job n'a été mis en file. */
const DELAI_ABSENCE_JOB_MS = 300
const DELAI_ATTENTE_JOB_MS = 5_000
const PORT_DEV = 3000

// ---------------------------------------------------------------------------------------------
// Comptes et sessions (insertions directes).
// ---------------------------------------------------------------------------------------------

type NouvelUtilisateur = Partial<typeof users.$inferInsert>

export async function creerSuperadmin(surcharges: NouvelUtilisateur = {}): Promise<UserRow> {
  const id = surcharges.id ?? randomUUID()
  return createUser({ id, role: 'superadmin', name: 'Administrateur de test', email: `admin-${id}@exemple.test`, ...surcharges })
}

export async function creerUtilisateurOrdinaire(surcharges: NouvelUtilisateur = {}): Promise<UserRow> {
  const id = surcharges.id ?? randomUUID()
  return createUser({ id, role: 'user', name: 'Utilisateur de test', email: `user-${id}@exemple.test`, ...surcharges })
}

/** Compte suspendu (plugin admin : `banned`). `banExpires` null = suspension sans terme. */
export async function creerUtilisateurSuspendu(surcharges: NouvelUtilisateur = {}): Promise<UserRow> {
  const id = surcharges.id ?? randomUUID()
  return createUser({
    id,
    role: 'user',
    email: `suspendu-${id}@exemple.test`,
    banned: true,
    banReason: 'suspension de test',
    banExpires: null,
    ...surcharges,
  })
}

export interface SessionAdminOptions {
  /** Ancienneté de la session (`created_at`), en heures (fractions admises). */
  creeIlYADesHeures?: number
  /** Fin de validité, en heures à partir de maintenant ; défaut : 30 jours (le cookie de Better Auth). */
  expireDansDesHeures?: number
  admin?: boolean
}

/** Session insérée directement, par défaut une session d'administration (`admin = true`). */
export async function creerSessionAdmin(userId: string, options: SessionAdminOptions = {}): Promise<SessionRow> {
  const maintenant = Date.now()
  const [ligne] = await db
    .insert(sessions)
    .values({
      id: randomUUID(),
      userId,
      token: `jeton-admin-${randomUUID()}`,
      userAgent: 'Mozilla/5.0 (test)',
      ipAddress: '203.0.113.7',
      admin: options.admin ?? true,
      createdAt: new Date(maintenant - (options.creeIlYADesHeures ?? 0) * HEURE_MS),
      updatedAt: new Date(maintenant),
      expiresAt: new Date(maintenant + (options.expireDansDesHeures ?? 24 * 30) * HEURE_MS),
    })
    .returning()
  if (!ligne) throw new Error('Insertion de session sans résultat.')
  return ligne
}

export async function lireSessions(userId: string): Promise<SessionRow[]> {
  return db.select().from(sessions).where(eq(sessions.userId, userId))
}

export async function compterSessions(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM sessions`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export async function compterUtilisateurs(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM users`)
  return Number(resultat.rows[0]?.n ?? 0)
}

// ---------------------------------------------------------------------------------------------
// Instance Better Auth RÉELLE (mêmes options que l'application) et appels HTTP-like.
// ---------------------------------------------------------------------------------------------

const SECRET = process.env.NUXT_BETTER_AUTH_SECRET ?? ''
const LONGUEUR_CODE = 6

/** Hôte public (en-tête `Host` d'un navigateur sur le serveur de développement) et hôte d'administration. */
const HOTES = {
  public: { host: `localhost:${PORT_DEV}`, origine: `http://localhost:${PORT_DEV}` },
  admin: { host: `${env.ADMIN_HOST}:${PORT_DEV}`, origine: `http://${env.ADMIN_HOST}:${PORT_DEV}` },
} as const
export type Hote = keyof typeof HOTES
export const hoteDe = (hote: Hote): string => HOTES[hote].host
export const origineDe = (hote: Hote): string => HOTES[hote].origine

let auth: ReturnType<typeof betterAuth> | undefined

/** Instance construite avec les MÊMES options que l'application (`optionsAuth`), sur la base PostgreSQL réelle. */
export async function creerAuth(): Promise<ReturnType<typeof betterAuth>> {
  if (auth) return auth
  const { optionsAuth } = await import('../../../server/auth.config')
  auth = betterAuth({ ...optionsAuth, secret: SECRET, baseURL: `http://localhost:${PORT_DEV}`, basePath: '/api/auth' })
  return auth
}

export interface ReponseAuth {
  status: number
  corps: Record<string, unknown> | null
  /** Valeurs brutes des en-têtes `Set-Cookie`. */
  setCookie: string[]
  /** En-tête `Cookie` prêt à l'emploi (cookies non vides posés par la réponse). */
  cookie: string
}

export interface AppelAuth {
  hote: Hote
  chemin: string
  methode?: 'GET' | 'POST'
  corps?: unknown
  cookie?: string
}

function lireCorpsJson(texte: string): Record<string, unknown> | null {
  if (texte === '') return null
  try {
    const lu: unknown = JSON.parse(texte)
    return typeof lu === 'object' && lu !== null ? (lu as Record<string, unknown>) : null
  } catch {
    return null
  }
}

let compteurIp = 0

/**
 * Appelle le gestionnaire HTTP de Better Auth comme le ferait Nitro : une vraie `Request` avec l'en-tête `Host` de
 * l'hôte visé (les hooks lisent `ctx.request.headers`). Une adresse IP distincte par appel évite que la limitation
 * en mémoire de Better Auth ne fausse un test.
 */
export async function appelerAuth(instance: ReturnType<typeof betterAuth>, appel: AppelAuth): Promise<ReponseAuth> {
  const { host, origine } = HOTES[appel.hote]
  compteurIp += 1
  const entetes: Record<string, string> = {
    host,
    origin: origine,
    'content-type': 'application/json',
    'x-forwarded-for': `203.0.113.${(compteurIp % 250) + 1}`,
    'user-agent': 'Mozilla/5.0 (test)',
  }
  if (appel.cookie) entetes.cookie = appel.cookie
  const methode = appel.methode ?? (appel.corps === undefined ? 'GET' : 'POST')
  const reponse = await instance.handler(
    new Request(`http://${host}${appel.chemin}`, {
      method: methode,
      headers: entetes,
      ...(appel.corps === undefined ? {} : { body: JSON.stringify(appel.corps) }),
    }),
  )
  const corps = lireCorpsJson(await reponse.text())
  const setCookie = reponse.headers.getSetCookie()
  const cookie = setCookie
    .map((c) => c.split(';')[0] ?? '')
    .filter((paire) => /=.+/.test(paire))
    .join('; ')
  return { status: reponse.status, corps, setCookie, cookie }
}

/** Demande un code de connexion par e-mail (`/email-otp/send-verification-otp`). */
export function demanderCodeConnexion(instance: ReturnType<typeof betterAuth>, email: string, hote: Hote): Promise<ReponseAuth> {
  return appelerAuth(instance, { hote, chemin: '/api/auth/email-otp/send-verification-otp', corps: { email, type: 'sign-in' } })
}

/** Dernier code e-mail stocké (hors production Better Auth le garde en clair : `storeOTP: 'plain'`). */
export async function lireCodeEmail(email: string): Promise<string> {
  const [ligne] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, `sign-in-otp-${email.toLowerCase()}`))
    .orderBy(desc(verifications.createdAt))
    .limit(1)
  const code = ligne?.value.split(':')[0]
  if (!code || code.length !== LONGUEUR_CODE) throw new Error(`Code de connexion introuvable en base pour ${email}.`)
  return code
}

export function connecterParCode(instance: ReturnType<typeof betterAuth>, email: string, code: string, hote: Hote): Promise<ReponseAuth> {
  return appelerAuth(instance, { hote, chemin: '/api/auth/sign-in/email-otp', corps: { email, otp: code } })
}

/** Parcours complet : demande du code sur `hote`, lecture du code en base, connexion sur `hote`. */
export async function ouvrirSession(instance: ReturnType<typeof betterAuth>, email: string, hote: Hote): Promise<ReponseAuth> {
  await demanderCodeConnexion(instance, email, hote)
  return connecterParCode(instance, email, await lireCodeEmail(email), hote)
}

export function demanderCodeTelephone(instance: ReturnType<typeof betterAuth>, telephone: string, hote: Hote): Promise<ReponseAuth> {
  return appelerAuth(instance, { hote, chemin: '/api/auth/phone-number/send-otp', corps: { phoneNumber: telephone } })
}

/** Dernier code SMS stocké : l'identifiant est le numéro, avec ou sans préfixe selon la version de Better Auth. */
export async function lireCodeTelephone(telephone: string): Promise<string> {
  const resultat = await db.execute<{ value: string }>(sql`
    SELECT value FROM verifications
    WHERE identifier IN (${telephone}, ${`phone-number-otp-${telephone}`})
    ORDER BY created_at DESC LIMIT 1`)
  const code = resultat.rows[0]?.value.split(':')[0]
  if (!code || code.length !== LONGUEUR_CODE) throw new Error('Code SMS introuvable en base.')
  return code
}

export function verifierCodeTelephone(instance: ReturnType<typeof betterAuth>, telephone: string, code: string, hote: Hote): Promise<ReponseAuth> {
  return appelerAuth(instance, { hote, chemin: '/api/auth/phone-number/verify', corps: { phoneNumber: telephone, code } })
}

/** Date de fin et de création de l'unique session d'un compte (lecture directe). */
export async function derniereSession(userId: string): Promise<SessionRow> {
  const [ligne] = await db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt)).limit(1)
  if (!ligne) throw new Error(`Aucune session pour ${userId}.`)
  return ligne
}

// ---------------------------------------------------------------------------------------------
// Garde `requireSuperadmin` : un événement h3 réel, la session lue par la VRAIE instance Better Auth.
// ---------------------------------------------------------------------------------------------

export interface OptionsEvenementAdmin {
  hote?: Hote
  cookie?: string
  methode?: string
  /** `null` : aucun en-tête Origin ; absent : l'origine de l'hôte visé. */
  origine?: string | null
  entetes?: Record<string, string>
}

export function evenementAdmin(options: OptionsEvenementAdmin = {}) {
  const hote = options.hote ?? 'admin'
  const entetes: Record<string, string> = { host: HOTES[hote].host, ...options.entetes }
  if (options.cookie) entetes.cookie = options.cookie
  if (options.origine !== null) entetes.origin = options.origine ?? HOTES[hote].origine
  return fakeEvent({ method: options.methode ?? 'GET', url: '/api/admin/session', headers: entetes })
}

/**
 * `getRequestSession` est une fonction auto-importée par Nitro (@nuxtjs/better-auth) : hors Nitro, on la fournit en
 * la branchant sur la vraie instance d'authentification (même appel : `auth.api.getSession` avec les en-têtes de la
 * requête). Aucune logique de l'application n'est simulée ; à défaire avec `vi.unstubAllGlobals()`.
 */
export function brancherGardeSurAuth(instance: ReturnType<typeof betterAuth>): void {
  vi.stubGlobal('getRequestSession', async (event: { node: { req: { headers: Record<string, string | string[] | undefined> } } }) => {
    const entetes = new Headers()
    for (const [nom, valeur] of Object.entries(event.node.req.headers)) {
      if (typeof valeur === 'string') entetes.set(nom, valeur)
    }
    return instance.api.getSession({ headers: entetes })
  })
}

export interface ErreurGarde {
  statusCode: number | undefined
  statusMessage: string | undefined
  message: string | undefined
  data: unknown
}

/** Exécute `requireSuperadmin` : le contexte renvoyé, ou la description de l'erreur levée (jamais les deux). */
export async function appelerGarde(event: ReturnType<typeof evenementAdmin>): Promise<{ contexte: ContexteAdmin } | { erreur: ErreurGarde }> {
  const { requireSuperadmin } = await garde()
  try {
    return { contexte: await requireSuperadmin(event) }
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }
    return { erreur: { statusCode: h3.statusCode, statusMessage: h3.statusMessage, message: h3.message, data: h3.data } }
  }
}

// ---------------------------------------------------------------------------------------------
// File BullMQ RÉELLE `messages-auth` (OTP de connexion et codes de réauthentification). Aucun worker ne tourne :
// un job mis en file y reste, donc l'ABSENCE d'un job prouve qu'aucun envoi n'a été demandé.
// ---------------------------------------------------------------------------------------------

let file: Queue | undefined

export function fileMessagesAuth(): Queue {
  file ??= new Queue(FILE_MESSAGES_AUTH, { connection: redis })
  return file
}

export async function viderFileMessagesAuth(): Promise<void> {
  await fileMessagesAuth().drain(true)
}

/** Tous les jobs de la file, quel que soit leur état (un worker éventuel les ferait passer à « terminé »). */
export async function tousLesJobs(): Promise<Job[]> {
  return fileMessagesAuth().getJobs(['wait', 'delayed', 'active', 'prioritized', 'paused', 'completed', 'failed'], 0, -1)
}

/** Jobs d'envoi d'un code de CONNEXION par e-mail pour l'adresse donnée (même adresse en minuscules). */
export async function jobsConnexionPour(email: string): Promise<Job[]> {
  const cible = email.toLowerCase()
  return (await tousLesJobs()).filter((job) => job.name === JOBS.sendOtpEmail && String((job.data as { identifier?: unknown }).identifier ?? '').toLowerCase() === cible)
}

/** Attend l'arrivée d'un job (envoi éventuellement en arrière-plan) ; échoue après quelques secondes. */
export async function attendreJobsConnexion(email: string): Promise<Job[]> {
  return vi.waitFor(async () => {
    const jobs = await jobsConnexionPour(email)
    if (jobs.length === 0) throw new Error(`Aucun job de connexion pour ${email}.`)
    return jobs
  }, { timeout: DELAI_ATTENTE_JOB_MS, interval: 50 })
}

/** Laisse passer un éventuel envoi en arrière-plan, puis lit les jobs : la liste vide est alors une VRAIE absence. */
export async function jobsConnexionApresDelai(email: string): Promise<Job[]> {
  await new Promise((resolve) => setTimeout(resolve, DELAI_ABSENCE_JOB_MS))
  return jobsConnexionPour(email)
}

// ---------------------------------------------------------------------------------------------
// Réauthentification : le code n'est stocké qu'en empreinte ; le test le lit dans le job mis en file.
// ---------------------------------------------------------------------------------------------

export interface LigneReauth {
  id: string
  admin_id: string
  action: string
  cible_type: string
  cible_id: string | null
  code_empreinte: string
  essais: number
  expire_le: Date
  consomme_le: Date | null
  cree_le: Date
}

/** Drizzle rend les horodatages bruts d'une requête `execute` en TEXTE : on les relit en `Date`. */
const enDate = (valeur: Date | string): Date => (valeur instanceof Date ? valeur : new Date(valeur))

type LigneReauthBrute = Omit<LigneReauth, 'expire_le' | 'consomme_le' | 'cree_le'> & {
  expire_le: Date | string
  consomme_le: Date | string | null
  cree_le: Date | string
}

export async function lignesReauth(adminId: string): Promise<LigneReauth[]> {
  const resultat = await db.execute<LigneReauthBrute>(sql`SELECT * FROM admin_reauth WHERE admin_id = ${adminId} ORDER BY cree_le, id`)
  return resultat.rows.map((r) => ({
    ...r,
    expire_le: enDate(r.expire_le),
    consomme_le: r.consomme_le === null ? null : enDate(r.consomme_le),
    cree_le: enDate(r.cree_le),
  }))
}

export interface DemandeLue {
  reauthId: string
  code: string
  expireLe: Date
}

export interface PreuveTest {
  action: string
  cibleType: string
  cibleId?: string | null
}

/** Demande un code par le service réel puis lit le code dans le job de la file `messages-auth`. */
export async function demanderEtLireCode(adminId: string, preuve: PreuveTest): Promise<DemandeLue> {
  const { demanderCode } = await reauthService()
  const { expireLe } = await demanderCode(adminId, preuve)
  const lignes = await lignesReauth(adminId)
  const ligne = lignes.at(-1)
  if (!ligne) throw new Error('Aucune ligne de réauthentification écrite.')
  const code = await vi.waitFor(async () => {
    const job = (await tousLesJobs()).find((j) => j.name === JOBS.sendAdminReauthEmail && (j.data as { reauthId?: unknown }).reauthId === ligne.id)
    const valeur = (job?.data as { code?: unknown } | undefined)?.code
    if (typeof valeur !== 'string') throw new Error('Job de réauthentification introuvable.')
    return valeur
  }, { timeout: DELAI_ATTENTE_JOB_MS, interval: 50 })
  return { reauthId: ligne.id, code, expireLe }
}

/** Un code de 6 chiffres qui n'est PAS `code` (jamais un faux positif par hasard). */
export function autreCode(code: string): string {
  return code === '000000' ? '000001' : '000000'
}

// ---------------------------------------------------------------------------------------------
// Journal d'administration.
// ---------------------------------------------------------------------------------------------

export const MOTIF_TEST = 'Motif de test valide'
export const IP_TEST = '203.0.113.9'

/** Entrée d'audit valide (aucune donnée personnelle). Les surcharges peuvent volontairement la rendre invalide. */
export function entreeAudit(adminId: string, surcharges: Record<string, unknown> = {}): EntreeAudit {
  return {
    adminId,
    action: 'compte.suspendre',
    cibleType: 'utilisateur',
    cibleId: 'cible-1',
    avant: { statut: 'actif' },
    apres: { statut: 'suspendu' },
    motif: MOTIF_TEST,
    ip: IP_TEST,
    ...surcharges,
  } as EntreeAudit
}

/** Journalise dans sa propre transaction (cas où seule l'écriture du journal est prouvée). */
export async function journaliser(adminId: string, surcharges: Record<string, unknown> = {}): Promise<{ id: string, numero: number }> {
  const { enregistrer } = await auditService()
  return db.transaction((tx) => enregistrer(tx, entreeAudit(adminId, surcharges)))
}

export interface LigneJournal {
  id: string
  numero: string
  admin_id: string
  action: string
  cible_type: string
  cible_id: string | null
  avant: Record<string, unknown> | null
  apres: Record<string, unknown> | null
  motif: string
  ip: string
  cle_idempotence: string | null
  cree_le: Date
  empreinte_precedente: string
  empreinte: string
}

export async function lireJournal(): Promise<LigneJournal[]> {
  const resultat = await db.execute<Omit<LigneJournal, 'cree_le'> & { cree_le: Date | string }>(sql`SELECT * FROM journal_admin ORDER BY numero`)
  return resultat.rows.map((r) => ({ ...r, cree_le: enDate(r.cree_le) }))
}

export async function compterJournal(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM journal_admin`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export type DeclencheurJournal = 'journal_admin_chainer' | 'journal_admin_sans_modif' | 'journal_admin_sans_vidage'

/** État (`tgenabled`) des trois déclencheurs du journal : `O` = actif. */
export async function etatDeclencheurs(): Promise<Record<string, string>> {
  const resultat = await db.execute<{ tgname: string, tgenabled: string }>(sql`
    SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgrelid = 'journal_admin'::regclass AND NOT tgisinternal ORDER BY tgname`)
  return Object.fromEntries(resultat.rows.map((r) => [r.tgname, r.tgenabled]))
}

/**
 * Désactive un déclencheur le temps de `corps`, puis le RÉTABLIT dans un `finally` (même si `corps` échoue). Sert à
 * simuler une altération faite « hors application » ; le test qui l'utilise vérifie ensuite que tout est rétabli.
 */
export async function sansDeclencheur<T>(declencheur: DeclencheurJournal, corps: () => Promise<T>): Promise<T> {
  const nom = sql.raw(declencheur)
  await db.execute(sql`ALTER TABLE journal_admin DISABLE TRIGGER ${nom}`)
  try {
    return await corps()
  } finally {
    await db.execute(sql`ALTER TABLE journal_admin ENABLE TRIGGER ${nom}`)
  }
}
