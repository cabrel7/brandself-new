// A4 (docs/specs/A4-supervision-reglages.md §1, §2) : registre PUR des réglages d'exploitation que le superadmin
// peut piloter à chaud. Aucune valeur d'environnement, aucun secret, aucune URL ici (D-A4-04) : le repli « valeur du
// code » vit dans `server/config/reglages-code.ts`, seul lecteur de `env` pour les réglages. Les limites anti-abus
// qui ne sont pas listées ci-dessous restent dans `shared/limites.ts` (D-A4-21).
// La base ne garantit que la forme (`reglages.valeur` : nombre, booléen ou texte) ; les bornes et la validation
// croisée vivent ici et sont appliquées par `Reglages.ecrire` et par `schemaValeurReglage` (shared/schemas/admin-a4.ts).
import { HORIZON_JOURS_MAX, INDISPONIBILITE_RETENTION_JOURS, PREAVIS_HEURES_MAX } from './agenda'
import { IA_RETENTION_JOURS } from './ia'
import { IA_GLOBAL_LIMIT, IA_UTILISATEUR_LIMIT, SEO_IA_VITRINE_LIMIT } from './limites'
import { OAUTH_CLIENT_ORPHELIN_JOURS } from './mcp'
import { ONBOARDING_ABANDON_RETENTION_JOURS } from './onboarding'
import { ABONNEMENT_GRACE_JOURS } from './plans'

export const REGLAGE_TYPES = ['entier', 'booleen', 'texte'] as const
export type ReglageType = (typeof REGLAGE_TYPES)[number]

/** Format d'une clé (CHECK `reglages_cle_check`). */
export const REGLAGE_CLE_FORMAT = /^[a-z][a-z0-9_.]{2,63}$/
/**
 * Garde anti-secret (D-A4-04, CA06) : AUCUNE clé du registre ne contient l'un de ces mots (secret, clé, jeton, mot de
 * passe, adresse). Vérifié par un test sur `REGLAGE_CLES_LISTE`.
 */
export const REGLAGE_CLE_SECRETE_MOTIF = /secret|key|token|password|url|cle/i

/** Texte d'un réglage : brut, sans caractère de contrôle ni marque de sens d'écriture (pas de mise en forme, pas de HTML interprété). */
export const REGLAGE_TEXTE_FORMAT = /^[^\p{Cc}‪-‮⁦-⁩]*$/u
/** D-A4-08 : message de maintenance, 280 caractères au plus. */
export const MAINTENANCE_MESSAGE_LONGUEUR_MAX = 280

export const REGLAGE_CLES = {
  iaLimiteUtilisateurHeure: 'ia.limite_utilisateur_heure',
  iaPlafondGlobalJour: 'ia.plafond_global_jour',
  seoLimiteVitrineJour: 'seo.limite_vitrine_jour',
  iaActive: 'ia.active',
  seoRegenerationActive: 'seo.regeneration_active',
  inscriptionsOuvertes: 'inscriptions.ouvertes',
  maintenanceActive: 'maintenance.active',
  maintenanceMessage: 'maintenance.message',
  mcpActif: 'mcp.actif',
  paiementEnLigne: 'paiement.en_ligne',
  abonnementGraceJours: 'abonnement.grace_jours',
  retentionIaJours: 'retention.ia_jours',
  retentionInscriptionsAbandonneesJours: 'retention.inscriptions_abandonnees_jours',
  retentionIndisponibilitesJours: 'retention.indisponibilites_jours',
  retentionOauthOrphelinsJours: 'retention.oauth_orphelins_jours',
  agendaPreavisDefautHeures: 'agenda.preavis_defaut_heures',
  agendaHorizonDefautJours: 'agenda.horizon_defaut_jours',
  supervisionSeuilEchecs15Min: 'supervision.seuil_echecs_15_min',
  supervisionDisqueAlertePct: 'supervision.disque_alerte_pct',
} as const
export type ReglageCle = (typeof REGLAGE_CLES)[keyof typeof REGLAGE_CLES]
export const REGLAGE_CLES_LISTE = Object.values(REGLAGE_CLES) as [ReglageCle, ...ReglageCle[]]

/** Catégories d'affichage (une seule page de réglages, filtrée par catégorie). */
export const REGLAGE_CATEGORIES = ['acces', 'ia', 'abonnement', 'retention', 'agenda', 'supervision'] as const
export type ReglageCategorie = (typeof REGLAGE_CATEGORIES)[number]
export const REGLAGE_CATEGORIE_LIBELLES: Record<ReglageCategorie, string> = {
  acces: 'Accès et maintenance',
  ia: 'IA et référencement',
  abonnement: 'Abonnements',
  retention: 'Conservation des données',
  agenda: 'Agenda',
  supervision: 'Supervision',
}

export type ReglageValeur = number | boolean | string
/** Lecture d'un autre réglage pendant une validation croisée (valeur candidate ou valeur en vigueur, au choix de l'appelant). */
export type LireReglage = (cle: ReglageCle) => ReglageValeur

/**
 * Variables d'environnement qui fournissent la valeur du CODE de trois réglages (D-A4-07) : `reglages-code.ts` les
 * lit quand la table n'a pas de ligne. Le registre ne contient que leur NOM, jamais leur valeur.
 */
export type ReglageVariableEnv = 'MCP_ACTIF' | 'PAIEMENT_EN_LIGNE' | 'SEO_IA_REGENERATION_ACTIVE'

interface ReglageCommun {
  cle: ReglageCle
  /** Libellé sobre affiché dans la page des réglages. */
  libelle: string
  /** Une phrase d'aide sous le libellé. */
  aide: string
  categorie: ReglageCategorie
  /** Vrai : l'écriture exige une réauthentification (D-A4-19). */
  reauth: boolean
  /** Faux : lecture seule, l'écriture répond 422 `REGLAGE_LECTURE_SEULE` (D-A4-07). */
  modifiable: boolean
  /** Variable d'environnement qui donne la valeur du code (absente : la valeur du code est `defaut`). */
  variableEnv?: ReglageVariableEnv
  /** Validation croisée : message d'erreur sobre (sans la valeur), ou `null` si la valeur est acceptable. */
  valider?: (valeur: ReglageValeur, lire: LireReglage) => string | null
}

export interface ReglageEntier extends ReglageCommun {
  type: 'entier'
  defaut: number
  min: number
  max: number
  securite: false
}

export interface ReglageBooleenOrdinaire extends ReglageCommun {
  type: 'booleen'
  defaut: boolean
  securite: false
}

/**
 * Drapeau de sécurité (D-A4-06) : quand la table est illisible ou la valeur invalide, `Reglages.lire` renvoie
 * `repliFerme` (la valeur RESTRICTIVE : fermé, coupé), jamais la valeur du code, qui pourrait ouvrir une fonction.
 */
export interface ReglageBooleenSecurite extends ReglageCommun {
  type: 'booleen'
  defaut: boolean
  securite: true
  repliFerme: boolean
}

export interface ReglageTexte extends ReglageCommun {
  type: 'texte'
  defaut: string
  longueurMax: number
  securite: false
}

export type ReglageDefinition = ReglageEntier | ReglageBooleenOrdinaire | ReglageBooleenSecurite | ReglageTexte

const MESSAGE_SEO_AU_PLUS_PLAFOND = 'La limite par vitrine ne peut pas dépasser le plafond global quotidien.'
const MESSAGE_PLAFOND_AU_MOINS_SEO = 'Le plafond global quotidien ne peut pas être inférieur à la limite par vitrine.'
const MESSAGE_MAINTENANCE_SANS_TEXTE = 'Saisissez d’abord un message de maintenance.'
const MESSAGE_TEXTE_VIDE_EN_MAINTENANCE = 'Le message ne peut pas être vide tant que la maintenance est active.'

const estTexteVide = (valeur: ReglageValeur): boolean => typeof valeur === 'string' && valeur.trim() === ''

export const REGLAGES = {
  [REGLAGE_CLES.iaLimiteUtilisateurHeure]: {
    cle: REGLAGE_CLES.iaLimiteUtilisateurHeure,
    type: 'entier',
    libelle: 'Demandes d’IA par utilisateur et par heure',
    aide: 'Nombre de propositions que chaque compte peut demander en une heure.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: IA_UTILISATEUR_LIMIT.limit,
    min: 1,
    max: 100,
  },
  [REGLAGE_CLES.iaPlafondGlobalJour]: {
    cle: REGLAGE_CLES.iaPlafondGlobalJour,
    type: 'entier',
    libelle: 'Plafond quotidien de demandes d’IA',
    aide: 'Au-delà, les propositions sont servies sans appel au fournisseur, jusqu’au lendemain.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: IA_GLOBAL_LIMIT.limit,
    min: 10,
    max: 100_000,
    valider: (valeur, lire) =>
      typeof valeur === 'number' && valeur < Number(lire(REGLAGE_CLES.seoLimiteVitrineJour)) ? MESSAGE_PLAFOND_AU_MOINS_SEO : null,
  },
  [REGLAGE_CLES.seoLimiteVitrineJour]: {
    cle: REGLAGE_CLES.seoLimiteVitrineJour,
    type: 'entier',
    libelle: 'Régénérations du référencement par vitrine et par jour',
    aide: 'Nombre de régénérations automatiques acceptées pour une même vitrine en 24 heures.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: SEO_IA_VITRINE_LIMIT.limit,
    min: 0,
    max: 20,
    valider: (valeur, lire) =>
      typeof valeur === 'number' && valeur > Number(lire(REGLAGE_CLES.iaPlafondGlobalJour)) ? MESSAGE_SEO_AU_PLUS_PLAFOND : null,
  },
  [REGLAGE_CLES.iaActive]: {
    cle: REGLAGE_CLES.iaActive,
    type: 'booleen',
    libelle: 'IA activée',
    aide: 'Désactivée, toutes les propositions sont servies sans appel au fournisseur.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: true,
    defaut: true,
    repliFerme: false,
  },
  [REGLAGE_CLES.seoRegenerationActive]: {
    cle: REGLAGE_CLES.seoRegenerationActive,
    type: 'booleen',
    libelle: 'Régénération automatique du référencement',
    aide: 'Désactivée, les modifications d’une vitrine ne relancent plus la proposition de référencement.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: true,
    variableEnv: 'SEO_IA_REGENERATION_ACTIVE',
  },
  [REGLAGE_CLES.inscriptionsOuvertes]: {
    cle: REGLAGE_CLES.inscriptionsOuvertes,
    type: 'booleen',
    libelle: 'Inscriptions ouvertes',
    aide: 'Fermées, aucun nouveau compte ne peut être créé ; les comptes existants se connectent normalement.',
    categorie: 'acces',
    reauth: true,
    modifiable: true,
    securite: true,
    defaut: true,
    repliFerme: false,
  },
  [REGLAGE_CLES.maintenanceActive]: {
    cle: REGLAGE_CLES.maintenanceActive,
    type: 'booleen',
    libelle: 'Maintenance en cours',
    aide: 'Active, le studio et la connexion sont suspendus ; les vitrines publiques et l’administration restent ouvertes.',
    categorie: 'acces',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: false,
    valider: (valeur, lire) =>
      valeur === true && estTexteVide(lire(REGLAGE_CLES.maintenanceMessage)) ? MESSAGE_MAINTENANCE_SANS_TEXTE : null,
  },
  [REGLAGE_CLES.maintenanceMessage]: {
    cle: REGLAGE_CLES.maintenanceMessage,
    type: 'texte',
    libelle: 'Message de maintenance',
    aide: 'Texte brut affiché dans le studio pendant la maintenance (280 caractères au plus).',
    categorie: 'acces',
    reauth: false,
    modifiable: true,
    securite: false,
    defaut: '',
    longueurMax: MAINTENANCE_MESSAGE_LONGUEUR_MAX,
    valider: (valeur, lire) =>
      estTexteVide(valeur) && lire(REGLAGE_CLES.maintenanceActive) === true ? MESSAGE_TEXTE_VIDE_EN_MAINTENANCE : null,
  },
  [REGLAGE_CLES.mcpActif]: {
    cle: REGLAGE_CLES.mcpActif,
    type: 'booleen',
    libelle: 'Connexion des assistants (MCP)',
    aide: 'Désactivée, plus aucun assistant ne peut se connecter ; la capacité de chaque compte reste lue ensuite.',
    categorie: 'acces',
    reauth: true,
    modifiable: true,
    securite: true,
    defaut: false,
    repliFerme: false,
    variableEnv: 'MCP_ACTIF',
  },
  [REGLAGE_CLES.paiementEnLigne]: {
    cle: REGLAGE_CLES.paiementEnLigne,
    type: 'booleen',
    libelle: 'Paiement en ligne',
    aide: 'Lecture seule : il dépend des clés du fournisseur de paiement, configurées au déploiement.',
    categorie: 'acces',
    reauth: false,
    modifiable: false,
    securite: true,
    defaut: false,
    repliFerme: false,
    variableEnv: 'PAIEMENT_EN_LIGNE',
  },
  [REGLAGE_CLES.abonnementGraceJours]: {
    cle: REGLAGE_CLES.abonnementGraceJours,
    type: 'entier',
    libelle: 'Jours de grâce après l’échéance',
    aide: 'Jours pendant lesquels un abonnement échu garde les droits du plan payant.',
    categorie: 'abonnement',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: ABONNEMENT_GRACE_JOURS,
    min: 0,
    max: 30,
  },
  [REGLAGE_CLES.retentionIaJours]: {
    cle: REGLAGE_CLES.retentionIaJours,
    type: 'entier',
    libelle: 'Conservation du contenu des propositions d’IA (jours)',
    aide: 'Au-delà, l’entrée et la sortie d’une proposition sont effacées ; les statistiques restent.',
    categorie: 'retention',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: IA_RETENTION_JOURS,
    min: 7,
    max: 365,
  },
  [REGLAGE_CLES.retentionInscriptionsAbandonneesJours]: {
    cle: REGLAGE_CLES.retentionInscriptionsAbandonneesJours,
    type: 'entier',
    libelle: 'Conservation des inscriptions abandonnées (jours)',
    aide: 'Au-delà, la progression d’une inscription non terminée est supprimée.',
    categorie: 'retention',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: ONBOARDING_ABANDON_RETENTION_JOURS,
    min: 7,
    max: 365,
  },
  [REGLAGE_CLES.retentionIndisponibilitesJours]: {
    cle: REGLAGE_CLES.retentionIndisponibilitesJours,
    type: 'entier',
    libelle: 'Conservation des indisponibilités passées (jours)',
    aide: 'Au-delà, les indisponibilités déjà écoulées sont supprimées de l’agenda.',
    categorie: 'retention',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: INDISPONIBILITE_RETENTION_JOURS,
    min: 30,
    max: 365,
  },
  [REGLAGE_CLES.retentionOauthOrphelinsJours]: {
    cle: REGLAGE_CLES.retentionOauthOrphelinsJours,
    type: 'entier',
    libelle: 'Conservation des assistants jamais utilisés (jours)',
    aide: 'Au-delà, un assistant enregistré mais jamais utilisé est supprimé.',
    categorie: 'retention',
    reauth: true,
    modifiable: true,
    securite: false,
    defaut: OAUTH_CLIENT_ORPHELIN_JOURS,
    min: 1,
    max: 90,
  },
  [REGLAGE_CLES.agendaPreavisDefautHeures]: {
    cle: REGLAGE_CLES.agendaPreavisDefautHeures,
    type: 'entier',
    libelle: 'Préavis de réservation par défaut (heures)',
    aide: 'Appliqué aux nouvelles vitrines seulement ; les vitrines existantes ne changent pas.',
    categorie: 'agenda',
    reauth: false,
    modifiable: true,
    securite: false,
    defaut: 2,
    min: 0,
    max: PREAVIS_HEURES_MAX,
  },
  [REGLAGE_CLES.agendaHorizonDefautJours]: {
    cle: REGLAGE_CLES.agendaHorizonDefautJours,
    type: 'entier',
    libelle: 'Horizon de réservation par défaut (jours)',
    aide: 'Appliqué aux nouvelles vitrines seulement ; les vitrines existantes ne changent pas.',
    categorie: 'agenda',
    reauth: false,
    modifiable: true,
    securite: false,
    defaut: 60,
    min: 1,
    max: HORIZON_JOURS_MAX,
  },
  [REGLAGE_CLES.supervisionSeuilEchecs15Min]: {
    cle: REGLAGE_CLES.supervisionSeuilEchecs15Min,
    type: 'entier',
    libelle: 'Seuil d’alerte : échecs de tâches en 15 minutes',
    aide: 'Au-delà de ce nombre d’échecs définitifs dans une même file, une alerte est envoyée (au plus une par heure).',
    categorie: 'supervision',
    reauth: false,
    modifiable: true,
    securite: false,
    defaut: 20,
    min: 1,
    max: 10_000,
  },
  [REGLAGE_CLES.supervisionDisqueAlertePct]: {
    cle: REGLAGE_CLES.supervisionDisqueAlertePct,
    type: 'entier',
    libelle: 'Seuil d’alerte : stockage libre (%)',
    aide: 'En dessous de ce pourcentage de stockage libre, la santé du disque est signalée comme dégradée.',
    categorie: 'supervision',
    reauth: false,
    modifiable: true,
    securite: false,
    defaut: 15,
    min: 5,
    max: 50,
  },
} as const satisfies Record<ReglageCle, ReglageDefinition>

export type ReglageValeurDe<K extends ReglageCle> = (typeof REGLAGES)[K] extends { type: 'entier' }
  ? number
  : (typeof REGLAGES)[K] extends { type: 'booleen' }
    ? boolean
    : string

/** Registre sous forme de liste, dans l'ordre d'affichage. */
export const REGLAGES_LISTE: readonly ReglageDefinition[] = REGLAGE_CLES_LISTE.map((cle) => REGLAGES[cle])

/** Vrai si `cle` est une clé du registre (toute autre clé, secret compris, répond 404 `REGLAGE_INCONNUE`). */
export function estCleReglage(cle: string): cle is ReglageCle {
  return Object.hasOwn(REGLAGES, cle)
}
