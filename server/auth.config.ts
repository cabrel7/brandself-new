import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { mcp } from '@better-auth/mcp'
import { Queue } from 'bullmq'
import type { BetterAuthOptions } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { defaultAc, userAc } from 'better-auth/plugins/admin/access'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { jwt } from 'better-auth/plugins/jwt'
import { phoneNumber } from 'better-auth/plugins/phone-number'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { ADMIN_SESSION_DUREE_S, ROLE_PAR_DEFAUT, SUPERADMIN, estHoteAdmin } from '../shared/admin'
import { TEMP_EMAIL_DOMAIN } from '../shared/compte'
import { env } from '../shared/env'
import {
  FILE_MESSAGES_AUTH,
  JOBS,
  OTP_JOB_BACKOFF_MS,
  OTP_JOB_GARDER_ECHECS,
  OTP_JOB_GARDER_REUSSIS,
  OTP_JOB_MAX_ATTEMPTS,
} from '../shared/jobs'
import {
  MCP_CHEMIN,
  MCP_JETON_ACCES_TTL_S,
  MCP_JETON_RENOUVELLEMENT_TTL_S,
  MCP_LIMITE_AUTORISATION,
  MCP_LIMITE_ENREGISTREMENT,
  MCP_LIMITE_JETON,
  OAUTH_PORTEES,
} from '../shared/mcp'
import * as schema from '../shared/db/schema'

export type OptionsAuth = Omit<BetterAuthOptions, 'secret' | 'baseURL' | 'basePath'>

const phoneRegex = /^\+[1-9]\d{6,14}$/

function validatePhone(value: string): boolean {
  return phoneRegex.test(value)
}

// File BullMQ dédiée aux OTP (e-mail et SMS), sans limiteur de débit : jamais derrière des e-mails de notification.
// This file is checked by the tsconfig.node project: it only imports node_modules and shared/.
const g = globalThis as typeof globalThis & { __fileMessagesAuth?: Queue }

function getMessagesAuthQueue(): Queue {
  const queue = g.__fileMessagesAuth ?? new Queue(FILE_MESSAGES_AUTH, { connection: new Redis(env.REDIS_URL) })
  g.__fileMessagesAuth = queue
  return queue
}

async function enqueueOtpEmail(identifier: string, code: string): Promise<void> {
  await getMessagesAuthQueue().add(JOBS.sendOtpEmail, { identifier, code }, {
    attempts: OTP_JOB_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: OTP_JOB_BACKOFF_MS },
    removeOnComplete: OTP_JOB_GARDER_REUSSIS,
    removeOnFail: OTP_JOB_GARDER_ECHECS,
  })
}

async function enqueueOtpSms(identifier: string, code: string): Promise<void> {
  await getMessagesAuthQueue().add(JOBS.sendOtpSms, { identifier, code }, {
    attempts: OTP_JOB_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: OTP_JOB_BACKOFF_MS },
    removeOnComplete: OTP_JOB_GARDER_REUSSIS,
    removeOnFail: OTP_JOB_GARDER_ECHECS,
  })
}

// Instance Drizzle dédiée à l'authentification (même base, même schéma).
// Les autres requêtes applicatives passent par server/utils/db.ts.
const poolAuth = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
const dbAuth = drizzle(poolAuth, { schema })

// A1 (D-A1-05, D-A1-06) : sur l'hôte d'administration, seul un superadmin ouvre une session, aucun compte ne se
// crée, et la session a une durée ABSOLUE de 8 h. L'hôte est lu dans l'en-tête `Host` de la requête d'origine
// (jamais `X-Forwarded-Host`). Sans requête (appel serveur direct), l'hôte est inconnu : ce n'est jamais l'hôte admin.
// Vérifié dans better-auth 1.7.18 : les hooks reçoivent `tryGetCurrentAuthEndpointContext()` (contexte de la
// route, `request` = la Request web) ; `sendVerificationOTP` reçoit ce même contexte en second argument.
interface ContexteRequete {
  request?: Request | undefined
  headers?: Headers | undefined
  context?: { session?: { session: { createdAt: Date | string, admin?: unknown } } | null }
}

const MS_PAR_SECONDE = 1_000
const MESSAGE_ACCES_REFUSE = 'Accès refusé.'
const MESSAGE_COMPTE_SUSPENDU = 'Ce compte est suspendu. Contactez le support si vous pensez qu’il s’agit d’une erreur.'

let hoteIllisibleSignale = false

/** `Host` de la requête d'origine ; à défaut, le nom d'hôte de son URL (jamais `X-Forwarded-Host`). */
function hoteDe(ctx: ContexteRequete | null | undefined): string | null {
  const entete = ctx?.request?.headers.get('host') ?? ctx?.headers?.get('host')
  if (entete) return entete
  if (ctx?.request?.url) {
    try {
      return new URL(ctx.request.url).hostname
    } catch {
      return null
    }
  }
  return null
}

/** Aucun hôte lisible : traité comme NON admin (avertissement unique, sans donnée personnelle). */
function surHoteAdmin(ctx: ContexteRequete | null | undefined): boolean {
  const hote = hoteDe(ctx)
  if (hote === null) {
    if (ctx?.request && !hoteIllisibleSignale) {
      hoteIllisibleSignale = true
      console.warn('[auth] hôte de la requête illisible : traité comme hôte public (HOTE_ILLISIBLE)')
    }
    return false
  }
  return estHoteAdmin(hote, env.ADMIN_HOST)
}

/** Compte superadmin non suspendu ? (adresse en minuscules : Better Auth les enregistre ainsi). */
async function estSuperadminActif(email: string): Promise<boolean> {
  const [ligne] = await dbAuth
    .select({ role: schema.users.role, suspendu: schema.users.banned })
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1)
  return ligne?.role === SUPERADMIN && ligne.suspendu !== true
}

async function roleDe(userId: string): Promise<string | null> {
  const [ligne] = await dbAuth.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  return ligne?.role ?? null
}

// Hors production, l'hôte d'administration se joint en HTTP sur le port du serveur de développement.
const ORIGINES_CONFIANCE_ADMIN: string[] = [
  `https://${env.ADMIN_HOST}`,
  ...(env.NODE_ENV === 'production' ? [] : ['http://admin.localhost:3000', `http://${env.ADMIN_HOST}:3000`]),
]

export const optionsAuth: OptionsAuth = {
  database: drizzleAdapter(dbAuth, { provider: 'pg', usePlural: true }),
  emailAndPassword: { enabled: false },
  // D-A1-07 : l'hôte d'administration est une origine de confiance de Better Auth (cookies host-only, sans Domain).
  trustedOrigins: [...new Set(ORIGINES_CONFIANCE_ADMIN)],
  // D-A1-03 : l'impersonation est fermée (aussi par la contrainte CHECK `incarne_par IS NULL` en base). Option de
  // Better Auth (pas du plugin admin) : appliquée avant tout traitement, réponse 404.
  disabledPaths: ['/admin/impersonate-user', '/admin/stop-impersonating'],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    additionalFields: {
      // D-A1-05 : drapeau « session d'administration » posé par le hook de création, jamais par le client.
      admin: { type: 'boolean', defaultValue: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        async before(session, ctx: ContexteRequete | null) {
          if (!surHoteAdmin(ctx)) return
          if ((await roleDe(session.userId)) !== SUPERADMIN) {
            throw APIError.from('FORBIDDEN', { message: MESSAGE_ACCES_REFUSE, code: 'ACCES_REFUSE' })
          }
          // Une seule date de référence : celle de création posée par Better Auth (sinon une constante locale),
          // pour que `expires_at` ne dépasse jamais `created_at + 8 h`.
          const creeeLe = session.createdAt instanceof Date ? session.createdAt : new Date()
          return { data: { admin: true, expiresAt: new Date(creeeLe.getTime() + ADMIN_SESSION_DUREE_S * MS_PAR_SECONDE) } }
        },
      },
      update: {
        // `get-session` prolonge la session de 30 jours : on plafonne à `created_at + 8 h` (la garde du serveur
        // impose de toute façon la durée absolue, ceci garde `expires_at` honnête).
        async before(donnees, ctx: ContexteRequete | null) {
          const courante = ctx?.context?.session?.session
          if (!courante || courante.admin !== true || !(donnees.expiresAt instanceof Date)) return
          const fin = new Date(new Date(courante.createdAt).getTime() + ADMIN_SESSION_DUREE_S * MS_PAR_SECONDE)
          if (donnees.expiresAt.getTime() <= fin.getTime()) return
          return { data: { expiresAt: fin } }
        },
      },
    },
    user: {
      create: {
        async before(_utilisateur, ctx: ContexteRequete | null) {
          if (surHoteAdmin(ctx)) throw APIError.from('FORBIDDEN', { message: MESSAGE_ACCES_REFUSE, code: 'ACCES_REFUSE' })
        },
      },
    },
  },
  user: {
    // S9 (#96) : `input: false` ferme `/api/auth/update-user` à ces champs (ils contourneraient Zod et la
    // synchronisation du fuseau avec la vitrine). Ils ne s'écrivent que par `PUT /api/studio/moi`.
    // Les valeurs par défaut restent appliquées à la création du compte.
    additionalFields: {
      nom: { type: 'string', defaultValue: '', input: false },
      locale: { type: 'string', defaultValue: 'fr', input: false },
      devise: { type: 'string', defaultValue: 'XAF', input: false },
      fuseau: { type: 'string', defaultValue: 'Africa/Douala', input: false },
      email_hebdo: { type: 'boolean', defaultValue: true, input: false },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      storeOTP: env.NODE_ENV === 'production' ? 'hashed' : 'plain',
      sendVerificationOTP: async ({ email, otp }, ctx?: ContexteRequete) => {
        // D-A1-06 : sur l'hôte d'administration, rien n'est envoyé ni mis en file pour une adresse qui n'est pas
        // celle d'un superadmin actif ; la réponse reste identique (aucun oracle sur les comptes).
        if (surHoteAdmin(ctx) && !(await estSuperadminActif(email))) return
        await enqueueOtpEmail(email, otp)
      },
    }),
    // D-A1-03 : le plugin ne sert qu'au schéma (rôle, suspension) et au refus de connexion d'un compte suspendu.
    // Le superadmin n'a AUCUNE permission du plugin ; ses routes (/api/auth/admin/**) sont fermées sur tous les hôtes
    // (server/middleware/00-hote.ts) : toutes les écritures passent par nos services, journalisées.
    // `ac` n'est lu que par le client du plugin (aucune permission serveur n'est utilisée : `roles` suffit, et le
    // type `AccessControl` générique n'accepte pas `defaultAc`, dont `newRole` est typé sur les permissions par défaut).
    admin({
      roles: { user: userAc, [SUPERADMIN]: defaultAc.newRole({ user: [], session: [] }) },
      adminRoles: [SUPERADMIN],
      defaultRole: ROLE_PAR_DEFAUT,
      bannedUserMessage: MESSAGE_COMPTE_SUSPENDU,
    }),
    phoneNumber({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      phoneNumberValidator: validatePhone,
      signUpOnVerification: {
        getTempEmail: (tel) => `${tel.replace(/[^+\d]/g, '')}@${TEMP_EMAIL_DOMAIN}`,
      },
      sendOTP: async ({ phoneNumber: tel, code }) => {
        await enqueueOtpSms(tel, code)
      },
    }),
    // S16 : serveur d'autorisation OAuth 2.1 du serveur MCP (jeton d'accès JWT signé par `jwt()`).
    // Better Auth est monté sous /api/auth : la découverte (/.well-known/…) est republiée à la racine
    // par server/routes/.well-known/. PKCE (S256) est imposé par le fournisseur à tout client public.
    jwt(),
    mcp({
      loginPage: '/connexion',
      consentPage: '/studio/assistants/autorisation',
      resource: `${env.NUXT_PUBLIC_SITE_URL}${MCP_CHEMIN}`,
      scopes: [...OAUTH_PORTEES],
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: MCP_JETON_ACCES_TTL_S,
      refreshTokenExpiresIn: MCP_JETON_RENOUVELLEMENT_TTL_S,
      // Claude et ChatGPT s'enregistrent seuls (RFC 7591), sans compte : l'enregistrement est ouvert mais borné
      // à nos portées, PKCE exigé, sans secret pour un client public. L'utilisateur consent ensuite, client par client.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // POST /oauth2/create-client (et la gestion des clients) fermé à tout utilisateur connecté : seuls les clients
      // enregistrés dynamiquement (sans session) existent. Aucun rôle administrateur n'est prévu à ce stade.
      clientPrivileges: () => false,
      clientRegistrationDefaultScopes: [...OAUTH_PORTEES],
      clientRegistrationAllowedScopes: [],
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultApplicationType: 'infer',
      rateLimit: {
        register: { ...MCP_LIMITE_ENREGISTREMENT },
        token: { ...MCP_LIMITE_JETON },
        authorize: { ...MCP_LIMITE_AUTORISATION },
      },
    }),
  ],
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      // La limite d'envoi d'OTP est portée par notre garde Redis
      // (server/middleware/otp-limiteur.ts : 10/min par IP, 1/60s par
      // identifiant). La règle par défaut de Better Auth (3/min par IP, en
      // mémoire) bloquerait deux envois légitimes et fausserait le test de
      // non-divulgation.
      '/email-otp/send-verification-otp': false,
      '/phone-number/send-otp': false,
      // Le plugin email-otp applique sa règle à TOUS ses chemins (3/min/IP par
      // défaut). Une connexion = 1 appel : derrière une même IP (réseau mobile,
      // CGNAT) cela bloquait tous les utilisateurs sauf un par minute. Les essais
      // par code restent bornés par `allowedAttempts` (3) côté Better Auth.
      '/sign-in/email-otp': { window: 60, max: 30 },
      '/email-otp/check-verification-otp': { window: 60, max: 30 },
      // Lecture de la session, appelée à chaque navigation du studio : un 429
      // ici affichait la page d'incident à tout un réseau partagé (CGNAT).
      '/get-session': false,
    },
  },
}

export default defineServerAuth(optionsAuth)
