import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { Queue } from 'bullmq'
import type { BetterAuthOptions } from 'better-auth'
import { drizzle } from 'drizzle-orm/node-postgres'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { phoneNumber } from 'better-auth/plugins/phone-number'
import Redis from 'ioredis'
import { Pool } from 'pg'
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

export const optionsAuth: OptionsAuth = {
  database: drizzleAdapter(dbAuth, { provider: 'pg', usePlural: true }),
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
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
      sendVerificationOTP: async ({ email, otp }) => {
        await enqueueOtpEmail(email, otp)
      },
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
