import { z } from 'zod'
import { IA_CLE_API_LONGUEUR_MIN, IA_FOURNISSEURS, IA_HOTES_HTTP_AUTORISES, IA_MODELE_DEFAUT } from './ia'
import type { IaFournisseur } from './ia'
import { EMAIL_EXPEDITEUR_DEV_DEFAUT, SITE_URL_DEV_DEFAUT } from './notifications'
import {
  KPAY_BASE_URL_DEFAUT,
  KPAY_CLE_API_FORMAT,
  KPAY_CLE_PREFIXE_LIVE,
  KPAY_CLE_SECRETE_FORMAT,
  KPAY_HOTES_HTTP_AUTORISES,
  KPAY_WEBHOOK_SECRET_LONGUEUR_MIN,
} from './paiements'
import type { PaiementEnvironnement } from './paiements'

function videVautAbsent(valeur: unknown): unknown {
  return typeof valeur === 'string' && valeur.trim() === '' ? undefined : valeur
}

/** HTTPS, ou HTTP vers un hôte local de la liste ; jamais un autre schéma (file:…) ni des identifiants dans l'URL. */
function baseUrlValide(valeur: string, hotesHttp: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(valeur)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && hotesHttp.includes(url.hostname)
}

const baseUrlIaValide = (valeur: string): boolean => baseUrlValide(valeur, IA_HOTES_HTTP_AUTORISES)
const baseUrlKpayValide = (valeur: string): boolean => baseUrlValide(valeur, KPAY_HOTES_HTTP_AUTORISES)

/** Variable texte facultative : vide ou espaces = absente, sinon rognée. */
const rognerOuAbsent = (valeur: unknown): unknown => videVautAbsent(typeof valeur === 'string' ? valeur.trim() : valeur)

// `PAIEMENT_EN_LIGNE=` (chaîne vide, ex. copié depuis .env.example) vaut « absent » : défaut faux.
const schemaPaiementEnLigne = z.preprocess(videVautAbsent, z.stringbool().default(false))
// S10 : même règle pour `KPAY_MODE_TEST_AUTORISE` (défaut faux).
const schemaBooleenFaux = z.preprocess(videVautAbsent, z.stringbool().default(false))

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
    // S9 (#91) : expéditeur des e-mails (domaine vérifié chez Resend). Absent hors production =
    // adresse de test de Resend, qui n'envoie qu'au titulaire du compte. Obligatoire en production.
    EMAIL_EXPEDITEUR: z.preprocess(videVautAbsent, z.string().trim().min(3).optional()),
    // S9 (#91) : URL publique du site (liens absolus des e-mails ; le worker n'a pas runtimeConfig).
    // Absente hors production = http://localhost:3000. Obligatoire et en https en production.
    NUXT_PUBLIC_SITE_URL: z.preprocess(videVautAbsent, z.url('doit être une URL valide').optional()),
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
    // S10 (#118) : K-PAY (paiement Mobile Money de l'abonnement). Lues côté serveur seulement : jamais dans
    // runtimeConfig.public, un DTO ou un journal. Variable vide = absente ; les messages d'erreur ne répètent
    // jamais la valeur. Fournisseur « configuré » <=> clé API et clé secrète présentes (`kpayConfigure`).
    KPAY_API_KEY: z.preprocess(
      rognerOuAbsent,
      z.string().regex(KPAY_CLE_API_FORMAT, 'format invalide (clé K-PAY de test ou de production attendue)').optional(),
    ),
    KPAY_SECRET_KEY: z.preprocess(
      rognerOuAbsent,
      z.string().regex(KPAY_CLE_SECRETE_FORMAT, 'doit contenir 64 caractères hexadécimaux').optional(),
    ),
    // Secret de signature des webhooks (HMAC-SHA256). Obligatoire en production dès que les clés sont présentes.
    KPAY_WEBHOOK_SECRET: z.preprocess(
      rognerOuAbsent,
      z.string().min(KPAY_WEBHOOK_SECRET_LONGUEUR_MIN, `doit contenir au moins ${KPAY_WEBHOOK_SECRET_LONGUEUR_MIN} caractères`).optional(),
    ),
    // Absente = KPAY_BASE_URL_DEFAUT. HTTPS obligatoire en production ; http://127.0.0.1 ou http://localhost
    // seulement hors production (faux serveur K-PAY des tests). Sans identifiants dans l'URL.
    KPAY_BASE_URL: z.preprocess(
      rognerOuAbsent,
      z.string().refine(baseUrlKpayValide, 'doit être une URL https (http seulement pour localhost ou 127.0.0.1 hors production), sans identifiants').optional(),
    ),
    // Autorise une clé kpay_test_ en production (préproduction uniquement). Défaut faux.
    KPAY_MODE_TEST_AUTORISE: schemaBooleenFaux,
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
    if (env.NODE_ENV === 'production' && !env.EMAIL_EXPEDITEUR) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_EXPEDITEUR'],
        message: 'requis en production (adresse d’un domaine vérifié chez Resend)',
      })
    }
    if (env.NODE_ENV === 'production') {
      if (!env.NUXT_PUBLIC_SITE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['NUXT_PUBLIC_SITE_URL'],
          message: 'requise en production (liens absolus des e-mails)',
        })
      } else if (!env.NUXT_PUBLIC_SITE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['NUXT_PUBLIC_SITE_URL'],
          message: 'doit commencer par https:// en production',
        })
      }
    }
    // S10 (#118) : K-PAY. Les clés vont ensemble ; en production, pas de clé de test (sauf préproduction
    // explicite), secret de webhook obligatoire et HTTPS strict. Messages sans valeur.
    if (Boolean(env.KPAY_API_KEY) !== Boolean(env.KPAY_SECRET_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.KPAY_API_KEY ? 'KPAY_SECRET_KEY' : 'KPAY_API_KEY'],
        message: 'KPAY_API_KEY et KPAY_SECRET_KEY vont ensemble',
      })
    }
    if (env.NODE_ENV === 'production') {
      if (env.KPAY_API_KEY && resolveKpayEnvironnement(env.KPAY_API_KEY) === 'test' && !env.KPAY_MODE_TEST_AUTORISE) {
        ctx.addIssue({
          code: 'custom',
          path: ['KPAY_API_KEY'],
          message: 'une clé de test est interdite en production (KPAY_MODE_TEST_AUTORISE=true seulement en préproduction)',
        })
      }
      if (env.KPAY_API_KEY && env.KPAY_SECRET_KEY && !env.KPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['KPAY_WEBHOOK_SECRET'],
          message: 'requis en production dès que les clés K-PAY sont présentes (signature des webhooks)',
        })
      }
      if (env.KPAY_BASE_URL && !env.KPAY_BASE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['KPAY_BASE_URL'],
          message: 'doit commencer par https:// en production',
        })
      }
    }
    if ((env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) || (!env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET vont ensemble',
      })
    }
  })
  .transform((env) => ({
    ...env,
    IA_MODELE: env.IA_MODELE ?? IA_MODELE_DEFAUT,
    // Garanti défini : requis en production par la validation ci-dessus, valeur de repli sinon.
    EMAIL_EXPEDITEUR: env.EMAIL_EXPEDITEUR ?? EMAIL_EXPEDITEUR_DEV_DEFAUT,
    // Sans barre finale : les chemins ajoutés commencent par `/`.
    NUXT_PUBLIC_SITE_URL: (env.NUXT_PUBLIC_SITE_URL ?? SITE_URL_DEV_DEFAUT).replace(/\/+$/, ''),
    // Garanti défini : adresse par défaut de K-PAY sinon (sans barre finale, les chemins commencent par `/`).
    KPAY_BASE_URL: (env.KPAY_BASE_URL ?? KPAY_BASE_URL_DEFAUT).replace(/\/+$/, ''),
  }))

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

/** Environnement K-PAY déduit du préfixe de la clé API (`kpay_live_` = production, tout le reste = test). */
export function resolveKpayEnvironnement(cleApi: string): PaiementEnvironnement {
  return cleApi.startsWith(KPAY_CLE_PREFIXE_LIVE) ? 'live' : 'test'
}

/** K-PAY est configuré <=> la clé API et la clé secrète sont présentes (la validation exige qu'elles aillent ensemble). */
export function kpayConfigure(env: Pick<Env, 'KPAY_API_KEY' | 'KPAY_SECRET_KEY'>): boolean {
  return Boolean(env.KPAY_API_KEY) && Boolean(env.KPAY_SECRET_KEY)
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
