// E1 (docs/specs/E1-essai-gratuit.md §4) : contrats partagés de l'essai gratuit à la création de la vitrine.
// Constantes et types seulement : aucune logique, aucune dépendance serveur. Les schémas Zod de la configuration
// vivent dans shared/schemas/admin-versions.ts (`schemaValeursEssai`) ; les types y sont dérivés (`ValeursEssai`).

/** Catégorie A5 de la version (`configuration_versions.categorie`) et clé unique de cette catégorie (CHECK de 0036). */
export const ESSAI_CATEGORIE = 'essai'
export const ESSAI_CLE_CONFIG = 'inscription'

/**
 * Bornes de la durée d'un essai, en jours. Le CHECK `essais.duree_jours` accepte 1..90, mais la durée MINIMALE
 * réellement configurable est 3 : `1 <= relanceServicesJour < relanceStatistiquesJour < dureeJours` impose 1 < 2 < 3.
 */
export const ESSAI_DUREE_MIN_JOURS = 3
export const ESSAI_DUREE_MAX_JOURS = 90

/** Identifiant de version renvoyé quand la configuration vient du code (ligne invalide ou base illisible). */
export const ESSAI_VERSION_CODE = 'code'

/** Valeurs d'une version `essai`. Structurellement égal à `ValeursEssai` (schemas/admin-versions.ts). */
export interface ConfigEssai {
  actif: boolean
  dureeJours: number
  /** Jour (depuis le début de l'essai) de l'e-mail « Ajoutez vos services à votre vitrine ». */
  relanceServicesJour: number
  /** Jour de l'e-mail « Votre vitrine cette semaine ». Règle : 1 <= services < statistiques < dureeJours. */
  relanceStatistiquesJour: number
}

/**
 * Repli et valeurs de la version 1 seedée (D3). Repli « ouvert » : un essai est un cadeau, pas un encaissement
 * (contrairement aux prix, où le repli est fermé). Le test CA-E1-13 vérifie l'égalité avec la ligne seedée.
 */
export const ESSAI_DEFAUT: Readonly<ConfigEssai> = {
  actif: true,
  dureeJours: 14,
  relanceServicesJour: 2,
  relanceStatistiquesJour: 7,
}

/** D9 : rappels d'échéance d'un essai. J-7 est supprimé (il tomberait le jour de l'e-mail « statistiques »). */
export const ESSAI_RAPPELS_JOURS = [3, 0] as const
export type EssaiRappelJours = (typeof ESSAI_RAPPELS_JOURS)[number]

/** D4 : info HKDF de la clé d'empreinte. Identifiant technique : ne se renomme JAMAIS (changerait toutes les empreintes). */
export const ESSAI_EMPREINTE_HKDF_INFO = 'jesuispro:essai-empreinte:v1'
/** HMAC-SHA256 en hexadécimal minuscule (CHECK `essais_empreintes.empreinte`). */
export const ESSAI_EMPREINTE_FORMAT = /^[0-9a-f]{64}$/
/** `essais_empreintes.nature` : clé dont l'empreinte est issue. */
export const ESSAI_EMPREINTE_NATURES = ['email', 'telephone'] as const
export type EssaiEmpreinteNature = (typeof ESSAI_EMPREINTE_NATURES)[number]

/** D8 : e-mails d'essai (outbox, `entite_type = 'abonnement'`, catégorie `relationnel`, avec lien de désabonnement : la migration lie ces deux types à cette catégorie). */
export const ESSAI_EMAIL_TYPES = ['abonnement_essai_services', 'abonnement_essai_statistiques'] as const
export type EssaiEmailType = (typeof ESSAI_EMAIL_TYPES)[number]
export const ESSAI_EMAIL_ENTITE_TYPE = 'abonnement'

/**
 * Occurrence d'un e-mail d'essai : `ESSAI:<fin ISO>` (30 caractères pour une ISO en millisecondes, 32 au plus
 * et `^[0-9A-Z:.-]*$` selon `emails_transactionnels_occurrence_check`).
 */
export const ESSAI_OCCURRENCE_PREFIXE = 'ESSAI:'

/** Fenêtre par défaut de l'indicateur de conversions de l'administration (D11). */
export const ESSAI_STATISTIQUES_JOURS = 30

/** Raisons pour lesquelles `accorderEssaiSiEligible` n'accorde rien (D6, dans l'ordre de contrôle). */
export const RAISONS_REFUS_ESSAI = [
  'desactive',
  'abonnement_existant',
  'essai_existant',
  'aucune_cle',
  'deja_consomme',
  'erreur',
] as const
export type RaisonRefusEssai = (typeof RAISONS_REFUS_ESSAI)[number]

/** Essai accordé, renvoyé par `terminer` à la création (D10). `finLe` : instant ISO. */
export interface EssaiDTO {
  finLe: string
  dureeJours: number
}

/** Essai en cours, tel que l'affiche la carte Abonnement du studio (`AbonnementDTO.essai`). */
export interface EssaiAbonnementDTO {
  finLe: string
}

/** Mention publique (`/tarifs`, landing) : suit la version active (`actif`). */
export interface EssaiPublicDTO {
  actif: boolean
  dureeJours: number
}
