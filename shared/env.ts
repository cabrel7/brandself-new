import { z } from 'zod'
import { IA_CLE_API_LONGUEUR_MIN, IA_FOURNISSEURS, IA_HOTES_HTTP_AUTORISES, IA_MODELE_DEFAUT } from './ia'
import type { IaFournisseur } from './ia'

function videVautAbsent(valeur: unknown): unknown {
  return typeof valeur === 'string' && valeur.trim() === '' ? undefined : valeur
}

/** HTTPS, ou HTTP vers un hôte local ; jamais un autre schéma (file:…) ni des identifiants dans l'URL. */
function baseUrlIaValide(valeur: string): boolean {
  let url: URL
  try {
    url = new URL(valeur)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && IA_HOTES_HTTP_AUTORISES.includes(url.hostname)
}

// `PAIEMENT_EN_LIGNE=` (chaîne vide, ex. copié depuis .env.example) vaut « absent » : défaut faux.
const schemaPaiementEnLigne = z.preprocess(videVautAbsent, z.stringbool().default(false))

const schemaEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url('doit être une URL PostgreSQL valide'),
    REDIS_URL: z.url('doit être une URL Redis valide'),
    // Dossier racine des médias (driver disque d'unstorage). Hors dépôt en production.
    MEDIAS_DIR: z.string().min(1).default('./storage/medias'),
    NUXT_BETTER_AUTH_SECRET: z.string().min(32, 'doit contenir au moins 32 caractères'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    // Paiement en ligne (K-PAY) : faux en v1, seul le règlement sur place est proposé (PROJECT_CONTEXT §4.1).
    PAIEMENT_EN_LIGNE: schemaPaiementEnLigne,
    // IA (S8). Lues par le worker seul : jamais dans runtimeConfig ni dans les drapeaux publics.
    // Variable vide = absente. Voir `resolveIaFournisseur` pour la règle de choix.
    IA_FOURNISSEUR: z.preprocess(videVautAbsent, z.enum(IA_FOURNISSEURS).optional()),
    IA_CLE_API: z.preprocess(
      (valeur) => videVautAbsent(typeof valeur === 'string' ? valeur.trim() : valeur),
      z.string().min(IA_CLE_API_LONGUEUR_MIN, `doit contenir au moins ${IA_CLE_API_LONGUEUR_MIN} caractères`).optional(),
    ),
    // Absent = défaut Anthropic (appliqué après la validation croisée). Obligatoire avec `openai`.
    IA_MODELE: z.preprocess(videVautAbsent, z.string().trim().min(1).optional()),
    // Endpoint d'un fournisseur compatible OpenAI (utilisé seulement avec IA_FOURNISSEUR=openai).
    // Absent = endpoint public d'OpenAI. HTTPS obligatoire (HTTP seulement pour localhost/127.0.0.1),
    // sans identifiants. Exemples :
    //   Gemini : IA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/  IA_MODELE=gemini-2.5-flash
    //   Ollama : IA_BASE_URL=http://localhost:11434/v1  IA_MODELE=<modèle local>
    // Le message d'erreur ne répète jamais la valeur (elle peut contenir un jeton).
    IA_BASE_URL: z.preprocess(
      (valeur) => videVautAbsent(typeof valeur === 'string' ? valeur.trim() : valeur),
      z.string().refine(baseUrlIaValide, 'doit être une URL https (http seulement pour localhost ou 127.0.0.1), sans identifiants').optional(),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.IA_FOURNISSEUR === 'openai' && !env.IA_MODELE) {
      ctx.addIssue({
        code: 'custom',
        path: ['IA_MODELE'],
        message: 'requis avec IA_FOURNISSEUR=openai (le modèle par défaut est celui d’Anthropic)',
      })
    }
    if (env.NODE_ENV === 'production' && env.IA_FOURNISSEUR === 'faux') {
      ctx.addIssue({
        code: 'custom',
        path: ['IA_FOURNISSEUR'],
        message: 'interdit en production (le faux fournisseur ne sert qu’aux tests)',
      })
    }
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
  .transform((env) => ({ ...env, IA_MODELE: env.IA_MODELE ?? IA_MODELE_DEFAUT }))

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

/**
 * Fournisseur IA effectivement utilisé (S8 §0 #71). Ne lève jamais : une configuration
 * qui ne permet pas d'appeler un fournisseur donne `aucun` (repli déterministe).
 * - explicite `anthropic` ou `openai` (tout fournisseur compatible OpenAI) sans clé -> `aucun` ;
 *   explicite `faux` en production -> `aucun` ;
 * - non défini : clé présente -> `anthropic` (jamais `openai` implicite) ; production sans clé -> `aucun` ;
 *   sinon `faux`.
 */
export function resolveIaFournisseur(
  env: Pick<Env, 'NODE_ENV' | 'IA_FOURNISSEUR' | 'IA_CLE_API'>,
): IaFournisseur {
  const production = env.NODE_ENV === 'production'
  const cle = Boolean(env.IA_CLE_API)
  switch (env.IA_FOURNISSEUR) {
    case 'anthropic':
      return cle ? 'anthropic' : 'aucun'
    case 'openai':
      return cle ? 'openai' : 'aucun'
    case 'faux':
      return production ? 'aucun' : 'faux'
    case 'aucun':
      return 'aucun'
    case undefined:
      if (cle) return 'anthropic'
      return production ? 'aucun' : 'faux'
  }
}

// Commandes Nuxt qui chargent la configuration sans démarrer l'application :
// elles doivent passer en CI sans .env réel (postinstall, typecheck).
const COMMANDES_SANS_ENV = ['prepare', 'typecheck']

export interface DrapeauxPublics {
  googleActif: boolean
  boiteOtpDev: boolean
  paiementEnLigne: boolean
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
      paiementEnLigne: schemaPaiementEnLigne.safeParse(source.PAIEMENT_EN_LIGNE).data ?? false,
    }
  }
  const valide = loadEnv(source)
  return {
    googleActif: Boolean(valide.GOOGLE_CLIENT_ID),
    boiteOtpDev: valide.NODE_ENV !== 'production',
    paiementEnLigne: valide.PAIEMENT_EN_LIGNE,
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
