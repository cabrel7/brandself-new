import { z } from 'zod'

const schemaEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url('doit être une URL PostgreSQL valide'),
    REDIS_URL: z.url('doit être une URL Redis valide'),
    NUXT_BETTER_AUTH_SECRET: z.string().min(32, 'doit contenir au moins 32 caractères'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'requise en production (envoi des codes par courriel)',
      })
    }
    if ((env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) || (!env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET vont ensemble',
      })
    }
  })

export type Env = z.infer<typeof schemaEnv>

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = schemaEnv.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n  - ')
    throw new Error(
      `Configuration invalide — corrige les variables d'environnement :\n  - ${problems}`,
    )
  }
  return result.data
}

// Commandes Nuxt qui chargent la configuration sans démarrer l'application :
// elles doivent passer en CI sans .env réel (postinstall, typecheck).
const COMMANDES_SANS_ENV = ['prepare', 'typecheck']

export interface DrapeauxPublics {
  googleActif: boolean
  boiteOtpDev: boolean
}

/**
 * Valide l'environnement pour nuxt.config.ts et en dérive les drapeaux publics.
 * Strict (échec immédiat, message clair) pour dev/build ; tolérant pour
 * `nuxt prepare` / `nuxt typecheck`, qui n'exécutent aucun code applicatif.
 */
export function loadDrapeauxPublics(
  source: Record<string, string | undefined>,
  argv: readonly string[],
): DrapeauxPublics {
  if (argv.some((arg) => COMMANDES_SANS_ENV.includes(arg))) {
    return {
      googleActif: Boolean(source.GOOGLE_CLIENT_ID),
      boiteOtpDev: source.NODE_ENV !== 'production',
    }
  }
  const valide = loadEnv(source)
  return {
    googleActif: Boolean(valide.GOOGLE_CLIENT_ID),
    boiteOtpDev: valide.NODE_ENV !== 'production',
  }
}

// Chargement paresseux : importer ce module (ex. depuis nuxt.config.ts) ne doit
// pas valider l'environnement ; la validation a lieu au premier accès.
let cache: Env | undefined
function charger(): Env {
  cache ??= loadEnv(process.env)
  return cache
}

export const env: Env = new Proxy({} as Env, {
  get: (_cible, cle) => charger()[cle as keyof Env],
  has: (_cible, cle) => cle in charger(),
  ownKeys: () => Reflect.ownKeys(charger()),
  getOwnPropertyDescriptor: (_cible, cle) => {
    const valeur = Reflect.getOwnPropertyDescriptor(charger(), cle)
    return valeur ? { ...valeur, configurable: true } : undefined
  },
})
