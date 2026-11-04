import type { PlanId } from './plans'
import { SERVICE_TYPES } from './services'

// S8 §3.1 : contrats et constantes de l'IA (pur, sans dépendance serveur).
// Les listes du statut, des motifs et des types sont recopiées dans les CHECK de la
// migration 0018 : les garder synchronisées.

export const IA_TYPES = ['onboarding_vitrine', 'ameliorer_texte'] as const
export type IaType = (typeof IA_TYPES)[number]

export const GENERATION_STATUTS = ['en_attente', 'en_cours', 'terminee', 'repli', 'expiree'] as const
export type GenerationStatut = (typeof GENERATION_STATUTS)[number]

export const GENERATION_STATUTS_TERMINAUX = ['terminee', 'repli', 'expiree'] as const
export type GenerationStatutTerminal = (typeof GENERATION_STATUTS_TERMINAUX)[number]

export const MOTIFS_REPLI = [
  'echec_fournisseur',
  'delai_depasse',
  'sortie_invalide',
  'injection',
  'sans_fournisseur',
  'sans_prompt',
  'file_indisponible',
  'limiteur_indisponible',
  'plafond_global',
  // S10 : quota mensuel du plan atteint pendant l'onboarding (jamais de blocage, repli déterministe).
  'quota_atteint',
] as const
export type MotifRepli = (typeof MOTIFS_REPLI)[number]

/**
 * Replis dus à une panne passagère (notre infrastructure OU le fournisseur) : le contenu servi n'est pas
 * définitif, donc une nouvelle demande identique doit créer une nouvelle génération (« Réessayer » utile).
 * Les autres replis (`sortie_invalide`, `injection`, `sans_prompt`, `sans_fournisseur`) sont déterministes :
 * même entrée, même issue, ils restent dédoublonnés.
 */
export const MOTIFS_REPLI_TRANSITOIRES: readonly MotifRepli[] = [
  'echec_fournisseur',
  'delai_depasse',
  'file_indisponible',
  'limiteur_indisponible',
  'plafond_global',
  'quota_atteint',
]

/** Fournisseur résolu (`aucun` = repli déterministe, aucun appel). */
// `openai` = TOUT fournisseur compatible OpenAI (OpenAI, Gemini, Groq, Mistral, DeepSeek, OpenRouter, Ollama…),
// choisi par `IA_BASE_URL` + `IA_MODELE`.
export const IA_FOURNISSEURS = ['anthropic', 'openai', 'faux', 'aucun'] as const
export type IaFournisseur = (typeof IA_FOURNISSEURS)[number]

/** Fournisseurs réellement enregistrés sur une génération (colonne `fournisseur`). */
export const IA_FOURNISSEURS_APPELES = ['anthropic', 'openai', 'faux'] as const
export type IaFournisseurAppele = (typeof IA_FOURNISSEURS_APPELES)[number]

/** Endpoint public d'OpenAI : utilisé quand `IA_BASE_URL` est absente (jamais la variable ambiante du SDK). */
export const IA_BASE_URL_DEFAUT = 'https://api.openai.com/v1'
/** Seuls hôtes autorisés en HTTP clair (modèles locaux, ex. Ollama). Tout le reste exige HTTPS. */
export const IA_HOTES_HTTP_AUTORISES: readonly string[] = ['localhost', '127.0.0.1']

/** Codes d'erreur courts conservés sur une génération (jamais un message brut). */
export const IA_ERREUR_CODES = ['delai', 'fournisseur', 'reponse_vide', 'sortie_invalide', 'faits_inventes'] as const
export type IaErreurCode = (typeof IA_ERREUR_CODES)[number]

export const IA_MODELE_DEFAUT = 'claude-haiku-5-5'
export const IA_CLE_API_LONGUEUR_MIN = 20

// Contenu proposé.
export const ACCROCHES_PROPOSEES = 3
export const SERVICES_PROPOSES = 3
export const ACCROCHE_MOTS_MIN = 10
export const ACCROCHE_MOTS_MAX = 15
export const PRESENTATION_MOTS_MIN = 80
export const PRESENTATION_MOTS_MAX = 260
export const SERVICE_TITRE_MOTS_MAX = 8
export const SERVICE_DESCRIPTION_MOTS_MIN = 10
export const SERVICE_DESCRIPTION_MOTS_MAX = 60

export const SERVICE_TYPES_PROPOSABLES = SERVICE_TYPES

/** Listes fermées : propositions modifiables, pas des faits biographiques. */
export const DUREES_PROPOSEES = [30, 45, 60, 90, 120] as const
export const SEANCES_PROPOSEES = [4, 6, 8, 10, 12] as const

// Délais (§0 #72).
export const IA_DELAI_TOTAL_MS = 25_000
export const IA_DELAI_TENTATIVE_MS = 15_000
export const IA_TENTATIVES_MAX = 3
export const IA_ATTENTE_BASE_MS = 1_000
export const GENERATION_EXPIRATION_MS = 45_000
export const GENERATION_POLL_MS = 2_000
export const GENERATION_POLL_MAX_MS = 60_000

export const IA_RETENTION_JOURS = 30
export const IA_CONCURRENCE_WORKER = 4

/** Progression affichée selon l'état de la génération. */
export const GENERATION_PROGRESSION = { en_attente: 10, en_cours: 50, terminal: 100 } as const
export type GenerationProgression = 10 | 50 | 100

// Amélioration d'un texte existant.
export const AMELIORER_CHAMPS = ['bio', 'accroche'] as const
export type AmeliorerChamp = (typeof AMELIORER_CHAMPS)[number]
export const AMELIORER_OBJECTIFS = ['reformuler'] as const
export type AmeliorerObjectif = (typeof AMELIORER_OBJECTIFS)[number]
export const AMELIORER_TEXTE_MIN = 20

// Réglages d'un prompt (colonne `parametres`).
export const PROMPT_TEMPERATURE_MIN = 0
export const PROMPT_TEMPERATURE_MAX = 1
export const PROMPT_MAX_TOKENS_MIN = 100
export const PROMPT_MAX_TOKENS_MAX = 4000

/** Plan pris en compte pour le quota de générations : alias du plan unique (shared/plans.ts, S10). */
export type IaPlan = PlanId

const JETON_SIGNIFICATIF = /[\p{L}\p{N}]/u
const SEPARATEUR_MOTS = /\s+/u

/** Jetons séparés par des espaces contenant au moins une lettre ou un chiffre : « c'est » = 1 mot. */
export function countWords(texte: string): number {
  return texte
    .split(SEPARATEUR_MOTS)
    .filter((jeton) => JETON_SIGNIFICATIF.test(jeton))
    .length
}
