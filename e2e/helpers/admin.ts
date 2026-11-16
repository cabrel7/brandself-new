import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { Queue } from 'bullmq'
import type { Job } from 'bullmq'
import Redis from 'ioredis'
import { ADMIN_HOST_DEV_DEFAUT } from '../../shared/admin'
import { FILE_MESSAGES_AUTH, JOBS } from '../../shared/jobs'
import { BASE_URL, db, fermerConnexions, lireDernierCode, lireEnv, requeteBrute } from './session'

// Helpers des specs e2e de l'administration (A1). Tout passe par des requêtes HTTP BRUTES (node:http) avec l'en-tête
// `Host` voulu : le serveur de développement répond sur 127.0.0.1 quel que soit l'hôte annoncé, ce qui permet de
// tester la séparation par nom d'hôte SANS navigateur ni résolution DNS. La base et Redis sont ceux du serveur testé
// (`.env`), comme e2e/helpers/session.ts.

/** Préfixe des comptes créés par ces specs : le nettoyage ne supprime que ceux-là. */
const PREFIXE_EMAIL = 'e2e-admin-'
const STATUT_TROP_DE_REQUETES = 429
const FENETRE_LIMITE_OTP_MS = 61_000
const DELAI_JOB_MS = 10_000
const INTERVALLE_JOB_MS = 250

function lireEnvFacultative(nom: string): string | undefined {
  try {
    return lireEnv(nom)
  } catch {
    return undefined
  }
}

/** Hôte d'administration du serveur testé : `ADMIN_HOST` de l'environnement ou de `.env`, sinon le défaut de développement. */
export const ADMIN_HOST = (process.env.ADMIN_HOST ?? lireEnvFacultative('ADMIN_HOST') ?? ADMIN_HOST_DEV_DEFAUT).trim().toLowerCase()

const url = new URL(BASE_URL)
/** Valeur de l'en-tête `Host` d'un navigateur : hôte et port. */
export const HOTE_ADMIN = url.port === '' ? ADMIN_HOST : `${ADMIN_HOST}:${url.port}`
export const HOTE_PUBLIC = url.host
export const ORIGINE_ADMIN = `http://${HOTE_ADMIN}`
export const ORIGINE_PUBLIC = `http://${HOTE_PUBLIC}`
/** URL de base d'une page de l'administration, telle que Chromium la joint (hôte mappé sur 127.0.0.1). */
export const URL_ADMIN = ORIGINE_ADMIN

export type Hote = 'admin' | 'public'
const hoteDe = (hote: Hote): string => (hote === 'admin' ? HOTE_ADMIN : HOTE_PUBLIC)

export interface AppelAdmin {
  methode?: string
  chemin: string
  /** Hôte annoncé dans l'en-tête `Host` (défaut : l'hôte d'administration). */
  hote?: Hote | string
  /** En-tête `Cookie` complet. */
  cookie?: string
  /** Corps JSON (sérialisé) ; absent : aucun corps. */
  corps?: unknown
  /** `false` : aucun en-tête Origin (appel hors navigateur). Défaut : l'origine de l'hôte visé pour une écriture. */
  origine?: string | false
  entetes?: Record<string, string>
}

export interface ReponseAdmin {
  status: number
  headers: IncomingHttpHeaders
  corps: string
  json: unknown
  setCookie: string[]
}

function lireJson(texte: string): unknown {
  if (texte === '') return null
  try {
    return JSON.parse(texte)
  } catch {
    return null
  }
}

/** Envoie une requête HTTP brute au serveur testé, avec l'en-tête `Host` de l'hôte voulu. */
export async function appeler(appel: AppelAdmin): Promise<ReponseAdmin> {
  const methode = appel.methode ?? (appel.corps === undefined ? 'GET' : 'POST')
  const hote = appel.hote === 'admin' || appel.hote === 'public' || appel.hote === undefined ? hoteDe(appel.hote ?? 'admin') : appel.hote
  const ecriture = methode !== 'GET' && methode !== 'HEAD'
  // Sans corps, on envoie un corps VIDE (et non `null`, qui laisse la requête ouverte : le serveur attendrait la fin du
  // corps d'un POST sans corps et aucune réponse n'arriverait).
  const corps = appel.corps === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(appel.corps), 'utf-8')
  const entetes: Record<string, string> = { host: hote, accept: 'application/json', ...appel.entetes }
  if (appel.cookie) entetes.cookie = appel.cookie
  if (corps.length > 0) {
    entetes['content-type'] = 'application/json'
    entetes['content-length'] = String(corps.length)
  } else if (ecriture) {
    entetes['content-length'] = '0'
  }
  if (appel.origine !== false && (ecriture || appel.origine !== undefined)) {
    entetes.origin = appel.origine ?? (appel.hote === 'public' ? ORIGINE_PUBLIC : ORIGINE_ADMIN)
  }
  const reponse = await requeteBrute({ method: methode, path: appel.chemin, headers: entetes, corps })
  const brut = reponse.headers['set-cookie']
  return { status: reponse.status, headers: reponse.headers, corps: reponse.corps, json: lireJson(reponse.corps), setCookie: Array.isArray(brut) ? brut : [] }
}

/** En-tête `Cookie` à partir des `Set-Cookie` d'une réponse (cookies non vides seulement). */
export function cookieDepuis(setCookie: string[]): string {
  return setCookie
    .map((c) => c.split(';')[0] ?? '')
    .filter((paire) => /=.+/.test(paire))
    .join('; ')
}

/** Nom et valeur du cookie de session, pour l'injecter dans un navigateur. */
export function cookiesDepuis(cookie: string): Array<{ name: string, value: string }> {
  return cookie
    .split(/;\s*/)
    .filter((paire) => paire.includes('='))
    .map((paire) => ({ name: paire.slice(0, paire.indexOf('=')), value: paire.slice(paire.indexOf('=') + 1) }))
}

// ---------------------------------------------------------------------------------------------
// Redis : limites d'envoi de code, file BullMQ `messages-auth`.
// ---------------------------------------------------------------------------------------------

let redis: Redis | undefined
let file: Queue | undefined

function redisClient(): Redis {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

function fileMessagesAuth(): Queue {
  file ??= new Queue(FILE_MESSAGES_AUTH, { connection: redisClient() })
  return file
}

/**
 * Remet à zéro les gardes d'envoi de code (`otp:ip:*` : 10 / min / IP ; `otp:id:*` : 1 / 60 s / adresse). Derrière
 * `nuxt dev` tous les appels partagent la même IP : un parcours qui envoie plusieurs codes doit les libérer.
 * Manipulation de test explicite, jamais utilisée en production.
 */
export async function libererLimitesOtp(): Promise<void> {
  const client = redisClient()
  let curseur = '0'
  do {
    const [suivant, cles] = await client.scan(curseur, 'MATCH', 'otp:*', 'COUNT', '200')
    curseur = suivant
    const cibles = cles.filter((c) => c.startsWith('otp:ip:') || c.startsWith('otp:id:'))
    if (cibles.length > 0) await client.del(...cibles)
  } while (curseur !== '0')
}

/** Jobs d'envoi du code de CONNEXION pour une adresse, dans tous les états (un worker les fait passer à « terminé »). */
export async function jobsConnexionPour(email: string): Promise<Job[]> {
  const jobs = await fileMessagesAuth().getJobs(['wait', 'delayed', 'active', 'prioritized', 'paused', 'completed', 'failed'], 0, -1)
  return jobs.filter((j) => j.name === JOBS.sendOtpEmail && String((j.data as { identifier?: unknown }).identifier ?? '').toLowerCase() === email.toLowerCase())
}

/** Attend l'arrivée d'au moins un job pour l'adresse (échoue sinon). */
export async function attendreJobConnexion(email: string): Promise<Job[]> {
  const fin = Date.now() + DELAI_JOB_MS
  for (;;) {
    const jobs = await jobsConnexionPour(email)
    if (jobs.length > 0) return jobs
    if (Date.now() > fin) throw new Error(`Aucun job de connexion mis en file pour ${email}.`)
    await new Promise((resolve) => setTimeout(resolve, INTERVALLE_JOB_MS))
  }
}

// ---------------------------------------------------------------------------------------------
// Comptes et sessions.
// ---------------------------------------------------------------------------------------------

export interface CompteE2E {
  id: string
  email: string
}

export interface OptionsCompte {
  role?: 'user' | 'superadmin'
  suspendu?: boolean
  nom?: string
}

/** Crée un compte directement en base (adresse vérifiée). Adresse unique, préfixe `e2e-admin-`, domaine factice. */
export async function creerCompte(options: OptionsCompte = {}): Promise<CompteE2E> {
  const id = randomUUID()
  const email = `${PREFIXE_EMAIL}${id}@exemple.test`
  await db().query(
    'INSERT INTO users (id, name, email, email_verified, role, suspendu) VALUES ($1, $2, $3, true, $4, $5)',
    [id, options.nom ?? 'Administrateur de test', email, options.role ?? 'user', options.suspendu ?? false],
  )
  return { id, email }
}

/** Superadmin FIXE des specs : `journal_admin` est append-only (FK RESTRICT sur `admin_id`), un admin qui a écrit ne se supprime plus. */
export const EMAIL_SUPERADMIN_FIXE = `${PREFIXE_EMAIL}fixe@exemple.test`

/**
 * Compte superadmin FIXE, créé s'il manque et JAMAIS supprimé (les specs qui écrivent dans le journal l'utilisent).
 * Remis dans un état sain à chaque appel (rôle superadmin, non suspendu). Un test qui doit suspendre, rétrograder ou
 * épuiser le budget de réauthentification d'un administrateur utilise `creerSuperadminJetable`.
 */
export async function creerSuperadmin(options: { nom?: string } = {}): Promise<CompteE2E> {
  const resultat = await db().query<{ id: string }>(
    `INSERT INTO users (id, name, email, email_verified, role, suspendu) VALUES ($1, $2, $3, true, 'superadmin', false)
     ON CONFLICT (email) DO UPDATE SET role = 'superadmin', suspendu = false, name = EXCLUDED.name
     RETURNING id`,
    [randomUUID(), options.nom ?? 'Administrateur de test', EMAIL_SUPERADMIN_FIXE],
  )
  return { id: resultat.rows[0]!.id, email: EMAIL_SUPERADMIN_FIXE }
}

/** Superadmin éphémère (supprimé au nettoyage) : pour suspension, perte de rôle, budgets de code. Ne doit écrire aucun journal. */
export const creerSuperadminJetable = (options: Omit<OptionsCompte, 'role'> = {}): Promise<CompteE2E> => creerCompte({ ...options, role: 'superadmin' })

/** Envoie un code de connexion par e-mail sur l'hôte voulu ; attend la fenêtre de limitation une seule fois si besoin. */
export async function demanderCodeConnexion(email: string, hote: Hote): Promise<ReponseAdmin> {
  const envoyer = () => appeler({ hote, chemin: '/api/auth/email-otp/send-verification-otp', corps: { email, type: 'sign-in' } })
  let reponse = await envoyer()
  if (reponse.status === STATUT_TROP_DE_REQUETES) {
    await new Promise((resolve) => setTimeout(resolve, FENETRE_LIMITE_OTP_MS))
    reponse = await envoyer()
  }
  return reponse
}

export function connecterAvecCode(email: string, code: string, hote: Hote): Promise<ReponseAdmin> {
  return appeler({ hote, chemin: '/api/auth/sign-in/email-otp', corps: { email, otp: code } })
}

export interface SessionE2E {
  email: string
  userId: string
  /** En-tête `Cookie` à présenter sur l'hôte où la session a été ouverte. */
  cookie: string
  /** Réponse de la connexion (`Set-Cookie` compris). */
  connexion: ReponseAdmin
  sessionId: string
}

/** Parcours complet : envoi du code, lecture en base, connexion, sur l'hôte voulu. Échoue si la connexion est refusée. */
export async function ouvrirSession(compte: CompteE2E, hote: Hote): Promise<SessionE2E> {
  await libererLimitesOtp()
  const envoi = await demanderCodeConnexion(compte.email, hote)
  if (envoi.status !== 200) throw new Error(`Envoi du code refusé (${envoi.status}) sur l'hôte ${hote}.`)
  const code = await lireDernierCode(compte.email)
  let connexion = await connecterAvecCode(compte.email, code, hote)
  if (connexion.status === STATUT_TROP_DE_REQUETES) {
    // Limiteur de Better Auth (100 requêtes / minute / IP, en mémoire) saturé par les tests précédents : on attend une fenêtre.
    await new Promise((resolve) => setTimeout(resolve, FENETRE_LIMITE_OTP_MS))
    await libererLimitesOtp()
    const nouvelEnvoi = await demanderCodeConnexion(compte.email, hote)
    if (nouvelEnvoi.status !== 200) throw new Error(`Envoi du code refusé (${nouvelEnvoi.status}) sur l'hôte ${hote}.`)
    connexion = await connecterAvecCode(compte.email, await lireDernierCode(compte.email), hote)
  }
  if (connexion.status !== 200) throw new Error(`Connexion refusée (${connexion.status}) sur l'hôte ${hote} : ${connexion.corps}`)
  const cookie = cookieDepuis(connexion.setCookie)
  const session = await db().query<{ id: string }>('SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [compte.id])
  return { email: compte.email, userId: compte.id, cookie, connexion, sessionId: session.rows[0]!.id }
}

export interface LigneSession {
  id: string
  admin: boolean
  created_at: Date
  expires_at: Date
}

export async function lireSessionsDe(userId: string): Promise<LigneSession[]> {
  const resultat = await db().query<LigneSession>('SELECT id, admin, created_at, expires_at FROM sessions WHERE user_id = $1 ORDER BY created_at', [userId])
  return resultat.rows
}

export async function compterUtilisateursParEmail(email: string): Promise<number> {
  const resultat = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM users WHERE email = $1', [email])
  return Number(resultat.rows[0]?.n ?? 0)
}

export async function lireRole(userId: string): Promise<string | undefined> {
  const resultat = await db().query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId])
  return resultat.rows[0]?.role
}

/** Fait vieillir une session : `created_at` reculé de `heures`, `expires_at` laissé dans le futur. */
export async function vieillirSession(sessionId: string, heures: number): Promise<void> {
  await db().query(
    "UPDATE sessions SET created_at = now() - make_interval(secs => $2), expires_at = now() + interval '1 hour' WHERE id = $1",
    [sessionId, heures * 3_600],
  )
}

/** Supprime les comptes créés par les specs d'administration (sessions et réauthentifications en cascade). */
export async function nettoyerComptes(): Promise<void> {
  await db().query("DELETE FROM verifications WHERE identifier LIKE $1", [`%${PREFIXE_EMAIL}%`])
  // Le superadmin fixe est conservé (journal append-only) : on ne retire que ses sessions. Tout autre compte qui a écrit dans
  // `journal_admin` (reliquat d'anciens runs) est conservé aussi : la FK est en RESTRICT.
  await db().query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [EMAIL_SUPERADMIN_FIXE])
  await db().query(
    'DELETE FROM users WHERE email LIKE $1 AND email <> $2 AND id NOT IN (SELECT admin_id FROM journal_admin)',
    [`${PREFIXE_EMAIL}%`, EMAIL_SUPERADMIN_FIXE],
  )
}

/** À appeler dans `afterAll` : referme Redis, la file et la base pour que Playwright se termine. */
export async function fermerAdmin(): Promise<void> {
  await file?.close()
  file = undefined
  if (redis) {
    await redis.quit()
    redis = undefined
  }
  await fermerConnexions()
}
