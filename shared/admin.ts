// A1 (docs/specs/A1-socle-admin.md) : constantes et fonctions pures partagées de l'administration.
// Aucune dépendance serveur : importé par le serveur, le worker, l'application et les tests.
import type { RateLimit } from './limites'

export const ROLES = ['user', 'superadmin'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_PAR_DEFAUT: Role = 'user'
export const SUPERADMIN: Role = 'superadmin'

/** Hôte d'administration hors production (D-A1-02). Jamais utilisé en production : `ADMIN_HOST` y est obligatoire. */
export const ADMIN_HOST_DEV_DEFAUT = 'admin.localhost'

export const ADMIN_PREFIXE_PAGES = '/admin'
export const ADMIN_PREFIXE_API = '/api/admin'
/** Routes du plugin `admin` de Better Auth : fermées sur TOUS les hôtes (nos services font les écritures). */
export const AUTH_ADMIN_PLUGIN_PREFIXE = '/api/auth/admin'

/** Durée ABSOLUE d'une session d'administration (D-A1-05) : 8 heures depuis sa création, jamais prolongée. */
export const ADMIN_SESSION_DUREE_S = 28_800

/** Réauthentification (D-A1-08) : code à 6 chiffres à usage unique, lié à (action, type de cible, cible). */
export const ADMIN_REAUTH_TTL_S = 600
export const ADMIN_REAUTH_ESSAIS = 3
export const ADMIN_REAUTH_LIMITE: RateLimit = { limit: 5, windowS: 900 }
export const ADMIN_REAUTH_LIMITE_CLE_PREFIXE = 'admin-reauth:'
export const ADMIN_REAUTH_CODE_FORMAT = /^\d{6}$/
export const ADMIN_REAUTH_ENTETE = 'x-admin-reauth'

/** Motif obligatoire de toute écriture d'administration (même bornes que la contrainte CHECK de `journal_admin`). */
export const ADMIN_MOTIF_MIN = 5
export const ADMIN_MOTIF_MAX = 500

/** Actions journalisées (`domaine.verbe`, minuscules et `_`). Les sprints suivants complètent cette table. */
export const ADMIN_ACTIONS = {
  superadminCreer: 'superadmin.creer',
  superadminReinitialiser: 'superadmin.reinitialiser',
  // A2 : utilisateurs, vitrines, assistants (docs/specs/A2-utilisateurs-vitrines.md §5, journal).
  utilisateurSuspendre: 'utilisateur.suspendre',
  utilisateurReactiver: 'utilisateur.reactiver',
  utilisateurOffrirJours: 'utilisateur.offrir_jours',
  utilisateurChangerPlan: 'utilisateur.changer_plan',
  utilisateurRevoquerSessions: 'utilisateur.revoquer_sessions',
  utilisateurRetirerAssistants: 'utilisateur.retirer_assistants',
  utilisateurSupprimer: 'utilisateur.supprimer',
  vitrineDepublier: 'vitrine.depublier',
  vitrineRepublier: 'vitrine.republier',
  assistantRetirer: 'assistant.retirer',
  // A3 : abonnements et paiements (docs/specs/A3-abonnements-paiements.md §3).
  paiementReverifier: 'paiement.reverifier',
  paiementMarquerPaye: 'paiement.marquer_paye',
  abonnementRappeler: 'abonnement.rappeler',
  exportPaiements: 'export.paiements',
  // A4 : réglages, supervision des files, journal, capacités (docs/specs/A4-supervision-reglages.md §3).
  reglageModifier: 'reglage.modifier',
  jobRelancer: 'job.relancer',
  jobPurger: 'job.purger',
  journalExporter: 'journal.exporter',
  capaciteAccorder: 'capacite.accorder',
  capaciteRevoquer: 'capacite.revoquer',
  // A5 : catalogues et versions de configuration (docs/specs/A5-catalogues-versions.md §5).
  catalogueCreer: 'catalogue.creer',
  catalogueModifier: 'catalogue.modifier',
  catalogueSupprimer: 'catalogue.supprimer',
  versionCreer: 'version.creer',
  versionProgrammer: 'version.programmer',
  versionActiver: 'version.activer',
  versionRetour: 'version.retour',
  versionValiderPrix: 'version.valider_prix',
  /** Essai à blanc d'un prompt : lecture seule, JAMAIS journalisé (aucune écriture) ; l'action existe pour le libellé. */
  promptEssai: 'prompt.essai',
} as const
export type AdminAction = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS]

/** Types de cible du journal (`cible_type`), au format `ADMIN_CIBLE_TYPE_FORMAT`. */
export const ADMIN_CIBLES = {
  utilisateur: 'utilisateur',
  vitrine: 'vitrine',
  assistant: 'assistant',
  paiement: 'paiement',
  abonnement: 'abonnement',
  export: 'export',
  reglage: 'reglage',
  job: 'job',
  journal: 'journal',
  catalogue: 'catalogue',
  version: 'version',
} as const
export type AdminCible = (typeof ADMIN_CIBLES)[keyof typeof ADMIN_CIBLES]

/** Listes d'administration (A2, A3) : pagination par page (1 = première), tri en liste blanche côté serveur. */
export const ADMIN_LISTE_LIMITE_DEFAUT = 25
export const ADMIN_LISTE_LIMITE_MAX = 100
export const ADMIN_LISTE_PAGE_MAX = 10_000
export const ADMIN_ORDRES = ['asc', 'desc'] as const
export type AdminOrdre = (typeof ADMIN_ORDRES)[number]

/**
 * Idempotence des écritures (D-A2-06, D-A3-04) : `journal_admin.cle_idempotence`, unique par administrateur.
 * A2 la lit dans l'en-tête, A3 dans le corps. Jeu de caractères restreint (UUID, ULID, jeton hexadécimal).
 */
export const ADMIN_IDEMPOTENCE_ENTETE = 'idempotency-key'
export const ADMIN_CLE_IDEMPOTENCE_MIN = 8
export const ADMIN_CLE_IDEMPOTENCE_MAX = 128
export const ADMIN_CLE_IDEMPOTENCE_FORMAT = /^[A-Za-z0-9._:-]+$/
export const ADMIN_ACTION_FORMAT = /^[a-z_]+\.[a-z_]+$/
export const ADMIN_CIBLE_TYPE_FORMAT = /^[a-z_]+$/
export const ADMIN_CIBLE_ID_MAX = 64

/** Valeurs plates de `avant`/`apres` du journal (D-A1-09) : jamais de donnée personnelle. */
export const AUDIT_VALEUR_TEXTE_MAX = 64
export const AUDIT_CLE_FORMAT = /^[a-z_]+$/
/**
 * Clés refusées dans `avant`/`apres` : elles porteraient une donnée personnelle (compte ou visiteur). Liste noire
 * complémentaire de la règle de forme (clé `^[a-z_]+$`, valeur courte) : on journalise des identifiants et des
 * champs neutres, jamais des textes libres.
 */
export const CLES_AUDIT_INTERDITES: readonly string[] = [
  'email', 'courriel', 'telephone', 'phone', 'phone_number', 'nom', 'prenom', 'name', 'full_name', 'adresse',
  'message', 'contenu', 'texte', 'sujet', 'motif_visiteur', 'visiteur', 'commentaire', 'note', 'password',
  'mot_de_passe', 'token', 'jeton', 'secret', 'code', 'cle', 'ip',
]

// --- A4 : supervision, réglages, journal (docs/specs/A4-supervision-reglages.md) ---

/** Fenêtre des agrégats IA, PWA et assistants : 30 jours au plus (`generations_ia` est purgée à 30 jours, D-A4-17). */
export const ADMIN_SUPERVISION_JOURS_MIN = 1
export const ADMIN_SUPERVISION_JOURS_DEFAUT = 30
export const ADMIN_SUPERVISION_JOURS_MAX = 30
/** Envois de codes : 7 jours par défaut ; au plus la rétention du journal d'envoi (`ENVOIS_CODES_RETENTION_JOURS`). */
export const ADMIN_ENVOIS_JOURS_DEFAUT = 7
/** Identifiant d'un job BullMQ pris en charge (≤ 64 : il sert de `cible_id` du journal). */
export const ADMIN_JOB_ID_FORMAT = /^[A-Za-z0-9._:-]{1,64}$/
/** Top des consommateurs d'IA et des assistants listés au plus. */
export const ADMIN_SUPERVISION_TOP_MAX = 10
export const ADMIN_SUPERVISION_ERREURS_TOP_MAX = 10
export const ADMIN_SUPERVISION_ASSISTANTS_MAX = 20

/** Santé (D-A4-16) : états d'un contrôle et de la dernière sauvegarde (`inconnue` n'est JAMAIS présentée comme bonne). */
export const SANTE_ETATS = ['ok', 'degrade', 'indisponible'] as const
export type SanteEtat = (typeof SANTE_ETATS)[number]
export const SAUVEGARDE_ETATS = ['ok', 'ancienne', 'inconnue'] as const
export type SauvegardeEtat = (typeof SAUVEGARDE_ETATS)[number]
/** Délai de la requête `SELECT 1` de santé. */
export const SANTE_BASE_TIMEOUT_MS = 2_000

/** D-A4-22 : version de l'application (`APP_VERSION`, facultative) ; texte sûr, jamais un secret. */
export const APP_VERSION_DEFAUT = 'inconnue'
export const APP_VERSION_FORMAT = /^[A-Za-z0-9._+-]{1,64}$/

/** D-A4-08 : la maintenance refuse (503 `MAINTENANCE`, `Retry-After`) ces chemins ; le reste reste ouvert. */
export const MAINTENANCE_RETRY_AFTER_S = 300
/** `/api/studio/**` : toute requête sauf `GET`. */
export const MAINTENANCE_PREFIXES_STUDIO: readonly string[] = ['/api/studio']
/** Connexion et inscription : toutes méthodes. Les vitrines publiques, l'administration et la lecture de session restent ouvertes. */
export const MAINTENANCE_PREFIXES_AUTH: readonly string[] = [
  '/api/auth/sign-in',
  '/api/auth/email-otp',
  '/api/auth/phone-number',
]
/** État public (maintenance en cours ou non) : lu par le studio, jamais refusé. */
export const ETAT_PUBLIC_CHEMIN = '/api/public/etat'

/** D-A4-18 : `GET journal/verifier` limité à 5 par minute et par administrateur (recalcul de toute la chaîne). */
export const ADMIN_JOURNAL_VERIFICATION_LIMIT: RateLimit = { limit: 5, windowS: 60 }
export const ADMIN_JOURNAL_VERIFICATION_CLE_PREFIXE = 'admin-journal-verif:'
/** Export CSV du journal : colonnes dans cet ordre (jamais d'adresse IP ni de clé d'idempotence). */
export const EXPORT_JOURNAL_COLONNES = [
  'numero',
  'creeLe',
  'adminId',
  'action',
  'cibleType',
  'cibleId',
  'motif',
  'avant',
  'apres',
  'empreinte',
] as const
export type ExportJournalColonne = (typeof EXPORT_JOURNAL_COLONNES)[number]
export const EXPORT_JOURNAL_NOM_FICHIER_PREFIXE = 'journal-admin-'
export const EXPORT_JOURNAL_CONTENT_TYPE = 'text/csv; charset=utf-8'

// --- A5 : catalogues et versions de configuration (docs/specs/A5-catalogues-versions.md) ---

/** `[nom]` des routes `/api/admin/catalogues/[nom]`. */
export const ADMIN_CATALOGUES = ['pays', 'devises', 'noms-bloques'] as const
export type AdminCatalogue = (typeof ADMIN_CATALOGUES)[number]
/** Pays : code ISO alpha-2, indicatif sans `+` (non unique : `+1`), libellé, fuseaux (le premier sert de repli). */
export const PAYS_CODE_FORMAT = /^[A-Z]{2}$/
export const PAYS_INDICATIF_FORMAT = /^[1-9][0-9]{0,3}$/
export const PAYS_LIBELLE_MIN = 2
export const PAYS_LIBELLE_MAX = 80
export const PAYS_FUSEAUX_MAX = 10
/** Noms d'adresse bloqués en plus de `shared/reserved.ts` ; motif de 5 à 200 caractères (CHECK de `usernames_bloques`). */
export const NOM_BLOQUE_FORMAT = /^[a-z0-9][a-z0-9_-]{1,39}$/
export const CATALOGUE_MOTIF_MAX = 200

/** `[type]` des routes `/api/admin/versions/[type]`. Les prompts vivent dans `prompts_ia`, les autres dans `configuration_versions`. */
export const ADMIN_VERSION_TYPES = ['plans', 'prix', 'frais', 'moyens', 'prompts'] as const
export type AdminVersionType = (typeof ADMIN_VERSION_TYPES)[number]
/** CHECK `configuration_versions_categorie_check`. */
export const VERSION_CATEGORIES = ['plan', 'prix', 'frais', 'moyens'] as const
export type VersionCategorie = (typeof VERSION_CATEGORIES)[number]
export const VERSION_CATEGORIE_PAR_TYPE: Record<Exclude<AdminVersionType, 'prompts'>, VersionCategorie> = {
  plans: 'plan',
  prix: 'prix',
  frais: 'frais',
  moyens: 'moyens',
}
/** CHECK `configuration_versions_statut_check` : brouillon, puis programmee ou active, puis remplacee. */
export const VERSION_STATUTS = ['brouillon', 'programmee', 'active', 'remplacee'] as const
export type VersionStatut = (typeof VERSION_STATUTS)[number]
/** Un prompt n'a que `actif` en base : active, ou inactive (jamais activée ou remplacée). */
export const VERSION_PROMPT_STATUTS = ['active', 'inactive'] as const
export type VersionPromptStatut = (typeof VERSION_PROMPT_STATUTS)[number]
/** CHECK `configuration_versions_cle_check`. */
export const VERSION_CLE_FORMAT = /^[a-z0-9_:.-]{1,60}$/
/** D-A5-05 : limite d'un plan, de 0 à 10 000 (ou `null` = illimité). */
export const VERSION_PLAN_LIMITE_MAX = 10_000
/** Moyens actifs listés au plus dans une version `moyens`. */
export const VERSION_MOYENS_MAX = 50
/** Mention affichée avec l'aperçu d'impact (R7). */
export const VERSION_IMPACT_MENTION = 'Estimation : la période de grâce est comptée à une journée près.'
/** D-A5-15 : cache de la lecture publique `GET /api/referentiels`, en secondes. */
export const REFERENTIELS_CACHE_S = 60

export interface ElementNavAdmin {
  id: string
  libelle: string
  to: string
  icone: string
}

/** Barre latérale de l'administration (icônes Phosphor, une seule famille). */
export const ADMIN_NAV: readonly ElementNavAdmin[] = [
  { id: 'vue-ensemble', libelle: 'Vue d’ensemble', to: '/admin', icone: 'i-ph-gauge' },
  { id: 'utilisateurs', libelle: 'Utilisateurs', to: '/admin/utilisateurs', icone: 'i-ph-users' },
  { id: 'vitrines', libelle: 'Vitrines', to: '/admin/vitrines', icone: 'i-ph-storefront' },
  { id: 'abonnements', libelle: 'Abonnements', to: '/admin/abonnements', icone: 'i-ph-credit-card' },
  { id: 'systemes', libelle: 'Systèmes', to: '/admin/systemes', icone: 'i-ph-heartbeat' },
  { id: 'reglages', libelle: 'Réglages', to: '/admin/reglages', icone: 'i-ph-sliders' },
  { id: 'catalogues', libelle: 'Catalogues', to: '/admin/catalogues', icone: 'i-ph-globe-hemisphere-west' },
  { id: 'versions', libelle: 'Versions', to: '/admin/versions', icone: 'i-ph-clock-counter-clockwise' },
  { id: 'journal', libelle: 'Journal', to: '/admin/journal', icone: 'i-ph-scroll' },
]

/**
 * Seuls chemins `/api/auth` servis sur l'hôte d'administration (D-A1-06) : lecture de session, demande et
 * vérification d'un code e-mail, déconnexion. Tout le reste (Google, téléphone, OAuth/MCP, update-user…) : 404.
 */
export const CHEMINS_AUTH_ADMIN: readonly string[] = [
  '/api/auth/get-session',
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/sign-in/email-otp',
  '/api/auth/sign-out',
]

/** Hôte sans port, en minuscules, sans point final. Vide si absent. Les hôtes IPv6 ne sont jamais des hôtes admin. */
export function normaliserHote(host: string | null | undefined): string {
  if (!host) return ''
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h
  return (h.split(':')[0] ?? '').replace(/\.$/, '')
}

/** Vrai si `host` (en-tête `Host`, jamais `X-Forwarded-Host`) est l'hôte d'administration configuré. */
export function estHoteAdmin(host: string | null | undefined, adminHost: string): boolean {
  const attendu = normaliserHote(adminHost)
  return attendu !== '' && normaliserHote(host) === attendu
}

/**
 * Chemin comparable : sans requête ni ancre, décodé UNE fois, en minuscules, sans `.`/`..`/`//`. `null` si illisible
 * (encodage invalide, octet nul, antislash) : l'appelant refuse. Évite les contournements `/%61dmin`, `/x/../admin`,
 * `//admin`, `/ADMIN`.
 */
export function cheminNormalise(brut: string): string | null {
  const sansRequete = brut.split(/[?#]/, 1)[0] ?? ''
  let decode: string
  try {
    decode = decodeURIComponent(sansRequete)
  } catch {
    return null
  }
  if (decode.includes('\0') || decode.includes('\\')) return null
  const segments: string[] = []
  for (const segment of decode.toLowerCase().split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

const sousChemin = (chemin: string, prefixe: string): boolean => chemin === prefixe || chemin.startsWith(`${prefixe}/`)

/** Préfixes servis sur l'hôte d'administration (pages, API, assets de l'application, polices, icônes, logo). */
const PREFIXES_HOTE_ADMIN: readonly string[] = [
  ADMIN_PREFIXE_PAGES, ADMIN_PREFIXE_API, '/_nuxt', '/_fonts', '/api/_nuxt_icon', '/__nuxt_error', '/brand',
]
const CHEMINS_EXACTS_HOTE_ADMIN: readonly string[] = ['/favicon.ico', ...CHEMINS_AUTH_ADMIN]
/** Chemins du serveur de développement (Vite, HMR) : servis seulement hors production. */
const PREFIXES_DEV: readonly string[] = ['/@vite', '/@fs', '/@id', '/__nuxt_vite_node__', '/node_modules', '/__vite_ping']

export type DecisionHote = 'laisser' | 'refuser'

/**
 * Décision du middleware d'hôte (server/middleware/00-hote.ts), pure et testable.
 * - `/api/auth/admin/**` (routes du plugin admin de Better Auth) : refusé sur TOUS les hôtes ;
 * - hôte public : `/admin/**` et `/api/admin/**` refusés ; le reste est laissé ;
 * - hôte d'administration : seuls les préfixes et chemins exacts listés ci-dessus sont laissés ; tout le reste
 *   (studio, vitrines, `/sw.js`, `/manifest.json`, `/robots.txt`, `/sitemap*`, `/mcp`, `/.well-known`) est refusé.
 */
export function decisionHote(cheminBrut: string, hoteAdmin: boolean, dev = false): DecisionHote {
  const chemin = cheminNormalise(cheminBrut)
  if (chemin === null) return 'refuser'
  if (sousChemin(chemin, AUTH_ADMIN_PLUGIN_PREFIXE)) return 'refuser'
  if (!hoteAdmin) {
    return sousChemin(chemin, ADMIN_PREFIXE_PAGES) || sousChemin(chemin, ADMIN_PREFIXE_API) ? 'refuser' : 'laisser'
  }
  if (CHEMINS_EXACTS_HOTE_ADMIN.includes(chemin)) return 'laisser'
  if (PREFIXES_HOTE_ADMIN.some((prefixe) => sousChemin(chemin, prefixe))) return 'laisser'
  if (dev && PREFIXES_DEV.some((prefixe) => sousChemin(chemin, prefixe))) return 'laisser'
  return 'refuser'
}
