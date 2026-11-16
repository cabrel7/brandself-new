// A5 : contrats Zod STRICTS des versions de configuration (plans, prix, frais, moyens) et des versions de prompts
// (docs/specs/A5-catalogues-versions.md §3 D-A5-01 à D-A5-09, §5). Un schéma de VALEURS strict par type : pas de
// moteur générique de schémas. Les réponses sont construites champ par champ puis validées. Clé d'idempotence :
// en-tête `Idempotency-Key` (D-A5-16). Une version n'est jamais supprimée ni éditée : on en crée une nouvelle.
import { z } from 'zod'
import {
  ADMIN_CIBLE_ID_MAX,
  ADMIN_LISTE_LIMITE_MAX,
  ADMIN_VERSION_TYPES,
  VERSION_CLE_FORMAT,
  VERSION_MOYENS_MAX,
  VERSION_PLAN_LIMITE_MAX,
  VERSION_PROMPT_STATUTS,
  VERSION_STATUTS,
} from '../admin'
import { PRIX_MAX_MINOR } from '../devises'
import {
  IA_ERREUR_CODES,
  IA_TYPES,
  PROMPT_GABARIT_LONGUEUR_MAX,
  PROMPT_SYSTEME_LONGUEUR_MAX,
} from '../ia'
import {
  FOURNISSEUR_FORMAT,
  FRAIS_SUPPORTEURS,
  FRAIS_TAUX_PB_MAX,
  MOYEN_ID_FORMAT,
} from '../paiements'
import { PLAN_IDS } from '../plans'
import { STATISTIQUES_RETENTION_JOURS } from '../statistiques'
import { schemaMotifAdmin } from './admin'
import { schemaIdAdmin, schemaPaginationAdmin } from './admin-a2'
import { schemaPromptParametres } from './ia'

const schemaInstant = z.iso.datetime()
const schemaCompteur = z.number().int().nonnegative()
const schemaIdCourt = z.string().min(1).max(ADMIN_CIBLE_ID_MAX)
const schemaCleVersion = z.string().regex(VERSION_CLE_FORMAT)

/** Clé d'un barème de frais : `fournisseur:méthode` (formats de `FOURNISSEUR_FORMAT` et `METHODE_FORMAT`). */
export const FRAIS_CLE_FORMAT = /^[a-z0-9_-]{1,40}:[a-z_]{1,30}$/

// --- Valeurs par type (un schéma strict chacun) ---

/** Limite d'un plan : entier de 0 à 10 000, ou `null` = illimité (D-A5-05). */
const schemaLimitePlan = z.number().int().min(0).max(VERSION_PLAN_LIMITE_MAX).nullable()

/** Champs de `ConfigPlan` qui portent une limite chiffrée (le plan gratuit n'en laisse aucune illimitée). */
export const VERSION_PLAN_LIMITES_CLES = ['services', 'realisations', 'temoignages', 'reservationsParMois', 'generationsIaParMois'] as const
export type VersionPlanLimiteCle = (typeof VERSION_PLAN_LIMITES_CLES)[number]

/** Valeurs d'un plan : les clés de `ConfigPlan` (server/config/plans.ts) plus `capacites: { mcp }`. */
export const schemaValeursPlan = z.strictObject({
  services: schemaLimitePlan,
  realisations: schemaLimitePlan,
  temoignages: schemaLimitePlan,
  reservationsParMois: schemaLimitePlan,
  generationsIaParMois: schemaLimitePlan,
  badge: z.boolean(),
  statistiquesJours: z.number().int().min(1).max(STATISTIQUES_RETENTION_JOURS),
  statistiquesDetails: z.boolean(),
  capacites: z.strictObject({ mcp: z.boolean() }),
})
export type ValeursPlan = z.infer<typeof schemaValeursPlan>

/** Montant TTC d'une durée, en entier de l'unité mineure de la devise (jamais un flottant). */
const schemaMontantPrix = z.number().int().min(1).max(PRIX_MAX_MINOR)
/** Une grille par devise : durées de `PERIODES_MOIS` (1, 3 et 12 mois). */
const schemaGrillePrix = z.strictObject({ 1: schemaMontantPrix, 3: schemaMontantPrix, 12: schemaMontantPrix })
/** Valeurs d'une version de prix : la grille COMPLÈTE, 3 devises (`DEVISES`) x 3 durées (D-A5-07). */
export const schemaValeursPrix = z.strictObject({ XAF: schemaGrillePrix, EUR: schemaGrillePrix, USD: schemaGrillePrix })
export type ValeursPrix = z.infer<typeof schemaValeursPrix>

/** Valeurs d'un barème de frais : taux en points de base (10 000 = 100 %, 50 % au plus) et qui les supporte. */
export const schemaValeursFrais = z.strictObject({
  tauxPointsBase: z.number().int().min(0).max(FRAIS_TAUX_PB_MAX),
  supporteur: z.enum(FRAIS_SUPPORTEURS),
})
export type ValeursFrais = z.infer<typeof schemaValeursFrais>

/** Valeurs d'une version de moyens : seuls les moyens ACTIFS (un moyen ne se crée pas depuis l'interface, D-A5-08). */
export const schemaValeursMoyens = z.strictObject({
  actifs: z
    .array(z.string().regex(MOYEN_ID_FORMAT))
    .max(VERSION_MOYENS_MAX)
    .refine((actifs) => new Set(actifs).size === actifs.length, { message: 'Un moyen ne peut figurer qu’une fois.' }),
})
export type ValeursMoyens = z.infer<typeof schemaValeursMoyens>

const nonVide = (texte: string): boolean => texte.trim().length > 0

/**
 * Contenu d'un prompt (D-A5-09) : `systeme`, `gabarit`, `parametres`. `variables` et `schema_sortie` ne viennent
 * JAMAIS du client (le serveur calcule les variables depuis le gabarit et refuse toute variable hors liste blanche :
 * `VARIABLE_INCONNUE`). Le texte n'est pas rogné (le contenu d'une version est figé tel qu'écrit).
 */
export const schemaValeursPrompt = z.strictObject({
  systeme: z.string().max(PROMPT_SYSTEME_LONGUEUR_MAX).refine(nonVide, { message: 'Le texte ne peut pas être vide.' }),
  gabarit: z.string().max(PROMPT_GABARIT_LONGUEUR_MAX).refine(nonVide, { message: 'Le texte ne peut pas être vide.' }),
  parametres: schemaPromptParametres,
})
export type ValeursPrompt = z.infer<typeof schemaValeursPrompt>

// --- Entrées ---

/** `[type]` de `/api/admin/versions/[type]`. */
export const schemaVersionTypeParam = z.strictObject({ type: z.enum(ADMIN_VERSION_TYPES) })
export type VersionTypeParam = z.infer<typeof schemaVersionTypeParam>

/** `[type]` et `[id]` de `/api/admin/versions/[type]/[id]/…`. */
export const schemaVersionEntreeParam = z.strictObject({ type: z.enum(ADMIN_VERSION_TYPES), id: schemaIdAdmin })
export type VersionEntreeParam = z.infer<typeof schemaVersionEntreeParam>

/** `GET /api/admin/versions/[type]?cle=&page=&limite=` : historique d'une clé (ou de toutes), pagination comme A2/A3. */
export const schemaHistoriqueVersionsQuery = schemaPaginationAdmin.extend({ cle: schemaCleVersion.optional() })
export type HistoriqueVersionsQuery = z.infer<typeof schemaHistoriqueVersionsQuery>

/** Limites finies obligatoires pour le plan gratuit (D-A5-05) : liste des champs encore `null` (illimités). */
function limitesIllimitees(valeurs: ValeursPlan): VersionPlanLimiteCle[] {
  return VERSION_PLAN_LIMITES_CLES.filter((cle) => valeurs[cle] === null)
}

const MESSAGE_GRATUIT_ILLIMITE = 'Le plan gratuit ne peut pas être illimité.'

/** Signale chaque limite laissée illimitée sur le plan gratuit (D-A5-05) ; sans effet sur le plan payant. */
function refuserGratuitIllimite(
  corps: { cle: (typeof PLAN_IDS)[number], valeurs: ValeursPlan },
  signaler: (cle: VersionPlanLimiteCle) => void,
): void {
  if (corps.cle !== 'gratuit') return
  for (const cle of limitesIllimitees(corps.valeurs)) signaler(cle)
}

/** `POST /api/admin/versions/plans` : un brouillon. La cohérence « limite du gratuit au plus égale à celle du payant » est contrôlée par le service (elle lit l'autre plan). */
export const schemaCreerVersionPlan = z
  .strictObject({ cle: z.enum(PLAN_IDS), valeurs: schemaValeursPlan, motif: schemaMotifAdmin })
  .superRefine((corps, contexte) =>
    refuserGratuitIllimite(corps, (cle) =>
      contexte.addIssue({ code: 'custom', path: ['valeurs', cle], message: MESSAGE_GRATUIT_ILLIMITE }),
    ),
  )
export type CreerVersionPlan = z.infer<typeof schemaCreerVersionPlan>

/** `POST /api/admin/versions/prix` : la clé est celle du plan vendu (`payant`). */
export const schemaCreerVersionPrix = z.strictObject({
  cle: z.enum(PLAN_IDS).extract(['payant']),
  valeurs: schemaValeursPrix,
  motif: schemaMotifAdmin,
})
export type CreerVersionPrix = z.infer<typeof schemaCreerVersionPrix>

/** `POST /api/admin/versions/frais` : clé `fournisseur:méthode`. */
export const schemaCreerVersionFrais = z.strictObject({
  cle: z.string().regex(FRAIS_CLE_FORMAT),
  valeurs: schemaValeursFrais,
  motif: schemaMotifAdmin,
})
export type CreerVersionFrais = z.infer<typeof schemaCreerVersionFrais>

/** `POST /api/admin/versions/moyens` : clé = fournisseur. */
export const schemaCreerVersionMoyens = z.strictObject({
  cle: z.string().regex(FOURNISSEUR_FORMAT),
  valeurs: schemaValeursMoyens,
  motif: schemaMotifAdmin,
})
export type CreerVersionMoyens = z.infer<typeof schemaCreerVersionMoyens>

/** `POST /api/admin/versions/prompts` : une nouvelle ligne `prompts_ia` inactive ; `cle` = type de prompt. */
export const schemaCreerVersionPrompt = z.strictObject({
  cle: z.enum(IA_TYPES),
  valeurs: schemaValeursPrompt,
  motif: schemaMotifAdmin,
})
export type CreerVersionPrompt = z.infer<typeof schemaCreerVersionPrompt>

/** Schéma de création par `[type]` de la route : le handler prend `schemasCreationVersion[type]`. */
export const schemasCreationVersion = {
  plans: schemaCreerVersionPlan,
  prix: schemaCreerVersionPrix,
  frais: schemaCreerVersionFrais,
  moyens: schemaCreerVersionMoyens,
  prompts: schemaCreerVersionPrompt,
} as const

/**
 * Impact d'une limite de plan (D-A5-06) : par ressource, comptes concernés. Services, réalisations et témoignages
 * masquent l'excédent (jamais supprimé) : `elementsMasques` ; réservations et IA ne masquent rien (comptes dont l'usage
 * du mois atteint déjà la limite).
 */
const schemaImpactMasquage = z.strictObject({ comptes: schemaCompteur, elementsMasques: schemaCompteur })
const schemaImpactUsage = z.strictObject({ comptes: schemaCompteur })
export const schemaImpactPlan = z.strictObject({
  services: schemaImpactMasquage,
  realisations: schemaImpactMasquage,
  temoignages: schemaImpactMasquage,
  reservationsMois: schemaImpactUsage,
  generationsIaMois: schemaImpactUsage,
})
export type ImpactPlan = z.infer<typeof schemaImpactPlan>

/** `POST /api/admin/versions/plans/impact` (lecture seule) : valeurs candidates d'un plan. */
export const schemaImpactPlanRequete = z
  .strictObject({ cle: z.enum(PLAN_IDS), valeurs: schemaValeursPlan })
  .superRefine((corps, contexte) =>
    refuserGratuitIllimite(corps, (cle) =>
      contexte.addIssue({ code: 'custom', path: ['valeurs', cle], message: MESSAGE_GRATUIT_ILLIMITE }),
    ),
  )
export type ImpactPlanRequete = z.infer<typeof schemaImpactPlanRequete>

export const schemaImpactPlanDto = z.strictObject({
  impact: schemaImpactPlan,
  /** Précision sur l'approximation de la grâce (R7). */
  mention: z.string().min(1),
  genereLe: schemaInstant,
})
export type ImpactPlanDto = z.infer<typeof schemaImpactPlanDto>

/**
 * `POST …/[type]/[id]/activer` (réauthentification `version.activer`). `programmeePour` `null` = immédiat ; une date =
 * programmation (le job applique la version à l'échéance, 60 s au plus de retard ; refusée pour les prompts). Une
 * baisse de limite exige `impactAcquitte` égal au calcul au moment de l'activation, sinon 409 `IMPACT_CHANGE`.
 */
export const schemaActiverVersion = z.strictObject({
  programmeePour: schemaInstant.nullable(),
  impactAcquitte: schemaImpactPlan.optional(),
  motif: schemaMotifAdmin,
})
export type ActiverVersion = z.infer<typeof schemaActiverVersion>

/** `POST …/[type]/[id]/retour` (réauthentification `version.retour`) et `POST …/prix/[id]/valider` (`version.valider_prix`). */
export const schemaRetourVersion = z.strictObject({ motif: schemaMotifAdmin })
export const schemaValiderPrix = z.strictObject({ motif: schemaMotifAdmin })
export type RetourVersion = z.infer<typeof schemaRetourVersion>
export type ValiderPrix = z.infer<typeof schemaValiderPrix>

/**
 * `POST /api/admin/versions/prompts/essai` (lecture seule, aucune ligne persistée, 10 essais par heure et par
 * administrateur : 429 `ESSAI_LIMITE`). Les entrées sont des fixtures synthétiques FIXÉES dans le code : le corps ne
 * porte QUE le contenu du prompt, jamais une donnée utilisateur (schéma strict, CA10).
 */
export const schemaEssaiPrompt = z.strictObject({ cle: z.enum(IA_TYPES), valeurs: schemaValeursPrompt })
export type EssaiPrompt = z.infer<typeof schemaEssaiPrompt>

export const schemaEssaiPromptDto = z.strictObject({
  /** Vrai si la sortie du fournisseur respecte le schéma de sortie du type. */
  valide: z.boolean(),
  /** Sortie obtenue sur les fixtures synthétiques (jamais une donnée utilisateur). */
  sortie: z.json().nullable(),
  erreurCode: z.enum(IA_ERREUR_CODES).nullable(),
  dureeMs: schemaCompteur.nullable(),
  /** Essais restants dans l'heure en cours. */
  essaisRestants: schemaCompteur,
})
export type EssaiPromptDto = z.infer<typeof schemaEssaiPromptDto>

// --- Sorties ---

const baseVersionConfiguration = {
  id: schemaIdCourt,
  cle: schemaCleVersion,
  numero: z.number().int().min(1),
  statut: z.enum(VERSION_STATUTS),
  /** `null` pour un brouillon seulement. */
  effectiveA: schemaInstant.nullable(),
  /** Seule une grille de prix se valide ; `null` tant qu'elle ne l'est pas (la production reste verrouillée). */
  valideeLe: schemaInstant.nullable(),
  motif: z.string().min(1),
  /** Identifiant d'administrateur, ou `systeme` pour la version seedée. */
  creePar: schemaIdCourt,
  creeLe: schemaInstant,
}

function schemaVersionConfiguration<T extends 'plans' | 'prix' | 'frais' | 'moyens', V extends z.ZodType>(type: T, valeurs: V) {
  return z.strictObject({ type: z.literal(type), ...baseVersionConfiguration, valeurs })
}

/**
 * Une version de prompt (`prompts_ia`) : pas de date d'effet ni de validation, seulement active ou inactive.
 * `variables` et `schemaSortie` sont en LECTURE SEULE (calculés par le serveur / imposés par le type).
 */
export const schemaVersionPromptDto = z.strictObject({
  type: z.literal('prompts'),
  id: schemaIdCourt,
  cle: z.enum(IA_TYPES),
  numero: z.number().int().min(1),
  statut: z.enum(VERSION_PROMPT_STATUTS),
  motif: z.string().nullable(),
  creePar: schemaIdCourt.nullable(),
  creeLe: schemaInstant,
  valeurs: z.strictObject({
    systeme: z.string(),
    gabarit: z.string(),
    variables: z.array(z.string().regex(/^\w+$/)),
    /** Tolérant : une ligne historique peut avoir des réglages partiels ; le chargement d'un prompt les revalide. */
    parametres: schemaPromptParametres.partial(),
    schemaSortie: z.string().regex(/^[a-z0-9_]{1,60}$/),
  }),
})

/** Une version, discriminée par `type` : le schéma de `valeurs` dépend du type. */
export const schemaVersionDto = z.discriminatedUnion('type', [
  schemaVersionConfiguration('plans', schemaValeursPlan),
  schemaVersionConfiguration('prix', schemaValeursPrix),
  schemaVersionConfiguration('frais', schemaValeursFrais),
  schemaVersionConfiguration('moyens', schemaValeursMoyens),
  schemaVersionPromptDto,
])
export type VersionDto = z.infer<typeof schemaVersionDto>

/** `GET /api/admin/versions/[type]` : historique, plus récent d'abord. */
export const schemaListeVersionsDto = z.strictObject({
  type: z.enum(ADMIN_VERSION_TYPES),
  elements: z.array(schemaVersionDto).max(ADMIN_LISTE_LIMITE_MAX),
  total: schemaCompteur,
  page: z.number().int().min(1),
  limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
})
export type ListeVersionsDto = z.infer<typeof schemaListeVersionsDto>

/** Réponse de création, d'activation, de programmation, de retour et de validation : la version résultante. */
export const schemaVersionReponse = z.strictObject({ version: schemaVersionDto, rejoue: z.boolean() })
export type VersionReponse = z.infer<typeof schemaVersionReponse>

