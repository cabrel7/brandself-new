import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { Queue } from 'bullmq'
import type { BetterAuthOptions } from 'better-auth'
import { drizzle } from 'drizzle-orm/node-postgres'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { phoneNumber } from 'better-auth/plugins/phone-number'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { env } from '../shared/env'
import { FILE_EMAILS, JOBS } from '../shared/jobs'
import * as schema from '../shared/db/schema'

export type OptionsAuth = Omit<BetterAuthOptions, 'secret' | 'baseURL' | 'basePath'>

const telephoneRegex = /^\+[1-9]\d{6,14}$/

function validerTelephone(valeur: string): boolean {
  return telephoneRegex.test(valeur)
}

// File BullMQ dédiée aux envois OTP (les jobs sont traités par le worker).
// Ce fichier est vérifié par le projet tsconfig.node : il n'importe que node_modules et shared/.
const g = globalThis as typeof globalThis & { __fileEmailsAuth?: Queue }

function getEmailsQueue(): Queue {
  const file = g.__fileEmailsAuth ?? new Queue(FILE_EMAILS, { connection: new Redis(env.REDIS_URL) })
  g.__fileEmailsAuth = file
  return file
}

async function enfilerOtpEmail(identifiant: string, code: string): Promise<void> {
  await getEmailsQueue().add(JOBS.envoyerOtpEmail, { identifiant, code }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  })
}

async function enfilerOtpSms(identifiant: string, code: string): Promise<void> {
  await getEmailsQueue().add(JOBS.envoyerOtpSms, { identifiant, code }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
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
    additionalFields: {
      nom: { type: 'string', defaultValue: '' },
      locale: { type: 'string', defaultValue: 'fr' },
      devise: { type: 'string', defaultValue: 'XAF' },
      fuseau: { type: 'string', defaultValue: 'Africa/Douala' },
      email_hebdo: { type: 'boolean', defaultValue: true },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      rateLimit: { window: 60, max: 1 },
      storeOTP: env.NODE_ENV === 'production' ? 'hashed' : 'plain',
      sendVerificationOTP: async ({ email, otp }) => {
        await enfilerOtpEmail(email, otp)
      },
    }),
    phoneNumber({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      phoneNumberValidator: validerTelephone,
      signUpOnVerification: {
        getTempEmail: (tel) => `${tel.replace(/[^+\d]/g, '')}@telephone.brandself.local`,
      },
      sendOTP: async ({ phoneNumber: tel, code }) => {
        await enfilerOtpSms(tel, code)
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
    },
  },
}

export default defineServerAuth(optionsAuth)
