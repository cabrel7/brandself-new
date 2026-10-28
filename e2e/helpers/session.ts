import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { expect } from '@playwright/test'
import type { APIRequestContext, APIResponse, Playwright } from '@playwright/test'
import Redis from 'ioredis'
import { Pool } from 'pg'

// Helpers des tests e2e d'API (Playwright `request`, sans navigateur).
//
// Une session par fichier : l'envoi d'un code OTP est limité à 10 par minute et par IP
// (server/middleware/otp-limiteur.ts). Chaque spec se connecte donc UNE fois dans son `beforeAll`
// (describe.serial) et réutilise le contexte. Le code est lu en base, comme e2e/connexion.spec.ts.

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

const LONGUEUR_CODE_OTP = 6
const FENETRE_LIMITE_OTP_MS = 61_000
const STATUT_TROP_DE_REQUETES = 429
const ASCII_IMPRIMABLE = /^[\x20-\x7E]*$/

/** Variable d'environnement, sinon valeur du fichier `.env` (créé par la CI et utilisé par `pnpm dev`). */
export function lireEnv(nom: string): string {
  const depuisProcess = process.env[nom]
  if (depuisProcess) return depuisProcess
  const contenu = readFileSync('.env', 'utf-8')
  const ligne = contenu.split('\n').find((l) => l.startsWith(`${nom}=`))
  if (!ligne) {
    throw new Error(`Variable ${nom} absente de l'environnement et de .env`)
  }
  return ligne.slice(nom.length + 1).trim()
}

let pool: Pool | undefined
let redis: Redis | undefined

/** Pool PostgreSQL de l'application testée (la même base que le serveur de développement / CI). */
export function db(): Pool {
  pool ??= new Pool({ connectionString: lireEnv('DATABASE_URL'), max: 2 })
  return pool
}

function redisClient(): Redis {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

/** À appeler dans `afterAll` : referme les connexions pour que Playwright se termine. */
export async function fermerConnexions(): Promise<void> {
  await pool?.end()
  pool = undefined
  if (redis) {
    await redis.quit()
    redis = undefined
  }
}

/** Better Auth stocke `sign-in-otp-<email>` pour l'email ; la valeur est `<code>:<essais>`. */
export async function lireDernierCode(email: string): Promise<string> {
  const resultat = await db().query<{ value: string }>(
    'SELECT value FROM verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1',
    [`sign-in-otp-${email}`],
  )
  const code = resultat.rows[0]?.value.split(':')[0]
  if (!code || code.length !== LONGUEUR_CODE_OTP) {
    throw new Error(`Code OTP introuvable en base pour ${email}`)
  }
  return code
}

/**
 * Retire le garde « 1 envoi / 60 s / identifiant » pour pouvoir ouvrir une SECONDE session du même
 * compte pendant un test (appareils). Manipulation de test explicite, jamais utilisée en production.
 */
export async function libererLimiteurOtp(identifiant: string): Promise<void> {
  const empreinte = createHash('sha256').update(identifiant).digest('hex')
  await redisClient().del(`otp:id:${empreinte}`)
}

export interface Session {
  /** Contexte HTTP authentifié (le cookie de session est conservé entre les appels). */
  api: APIRequestContext
  email: string
  userId: string
  sessionId: string
  /** En-tête Cookie prêt à l'emploi pour les requêtes brutes (node:http). */
  cookie: string
}

async function envoyerCode(api: APIRequestContext, email: string): Promise<void> {
  const envoyer = () => api.post('/api/auth/email-otp/send-verification-otp', { data: { email, type: 'sign-in' } })
  let reponse = await envoyer()
  if (reponse.status() === STATUT_TROP_DE_REQUETES) {
    // Fenêtre de 60 s de la limite OTP par IP : on attend qu'elle se referme, une seule fois.
    await new Promise((resolve) => setTimeout(resolve, FENETRE_LIMITE_OTP_MS))
    reponse = await envoyer()
  }
  expect(reponse.ok(), `envoi du code OTP : ${reponse.status()}`).toBe(true)
}

/** Ouvre une session par code OTP email (compte créé à la volée si l'adresse est nouvelle). */
export async function seConnecter(playwright: Playwright, email = `e2e-api-${Date.now()}-${randomUUID().slice(0, 8)}@exemple.com`): Promise<Session> {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } })
  await envoyerCode(api, email)
  const otp = await lireDernierCode(email)
  const connexion = await api.post('/api/auth/sign-in/email-otp', { data: { email, otp } })
  expect(connexion.ok(), `connexion par code OTP : ${connexion.status()}`).toBe(true)

  const { cookies } = await api.storageState()
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const utilisateur = await db().query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  const session = await db().query<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [utilisateur.rows[0].id],
  )
  return { api, email, userId: utilisateur.rows[0].id, sessionId: session.rows[0].id, cookie }
}

/** Corps d'erreur normalisé (§5) : `{ statusCode, statusMessage, message, data: { code, ... } }`. */
export interface CorpsErreur {
  statusCode: number
  statusMessage: string
  message: string
  data?: { code?: string, champs?: Record<string, string[]>, manquants?: string[], retryAfter?: number }
}

export async function lireErreur(reponse: APIResponse): Promise<CorpsErreur> {
  return (await reponse.json()) as CorpsErreur
}

/** Vérifie le contrat d'erreur §5 : statut, code, statusMessage ASCII, message français non vide. */
export async function attendreErreur(reponse: APIResponse, statut: number, code: string): Promise<CorpsErreur> {
  expect(reponse.status()).toBe(statut)
  const corps = await lireErreur(reponse)
  expect(corps.data?.code).toBe(code)
  expect(corps.statusMessage).toMatch(ASCII_IMPRIMABLE)
  expect(typeof corps.message).toBe('string')
  expect(corps.message.length).toBeGreaterThan(0)
  return corps
}

export interface ReponseBrute {
  status: number
  headers: http.IncomingHttpHeaders
  corps: string
}

export interface RequeteBrute {
  method: string
  path: string
  headers: Record<string, string>
  /** `null` : on n'envoie aucun octet du corps (le serveur doit répondre avant de le lire). */
  corps: Buffer | null
}

const DELAI_REQUETE_BRUTE_MS = 15_000

/**
 * Requête HTTP brute : permet d'annoncer un Content-Length sans envoyer le corps (`corps: null`),
 * ou d'envoyer un corps sans Content-Length (Node bascule alors en Transfer-Encoding: chunked).
 */
export function requeteBrute(options: RequeteBrute): Promise<ReponseBrute> {
  const url = new URL(BASE_URL)
  return new Promise((resolve, reject) => {
    const requete = http.request(
      { hostname: url.hostname, port: url.port, method: options.method, path: options.path, headers: options.headers, agent: false },
      (reponse) => {
        const morceaux: Buffer[] = []
        reponse.on('data', (m: Buffer) => morceaux.push(m))
        reponse.on('end', () => {
          resolve({ status: reponse.statusCode ?? 0, headers: reponse.headers, corps: Buffer.concat(morceaux).toString('utf-8') })
          requete.destroy()
        })
      },
    )
    requete.setTimeout(DELAI_REQUETE_BRUTE_MS, () => requete.destroy(new Error('Aucune réponse : le serveur lit-il le corps avant de répondre ?')))
    requete.on('error', reject)
    if (options.corps === null) {
      requete.flushHeaders()
    } else {
      requete.end(options.corps)
    }
  })
}
