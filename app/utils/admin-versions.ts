// A5 (UI) : fonctions pures de l'administration des versions (plans, prix, frais, moyens, prompts IA). Aucune dépendance
// Vue ni Nuxt : testable seule. Elles préparent l'affichage et le corps des requêtes ; le serveur valide et décide.
// Libellés au vocabulaire du produit (CLAUDE.md §2), vouvoiement.
import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_VERSION_TYPES, VERSION_PLAN_LIMITE_MAX } from '#shared/admin'
import type { AdminAction, AdminCible, AdminVersionType, VersionPromptStatut, VersionStatut } from '#shared/admin'
import { DEVISES } from '#shared/compte'
import type { Devise } from '#shared/compte'
import { formatPrixSaisi, parsePrixSaisi, PRIX_MAX_MINOR } from '#shared/devises'
import { IA_TYPES, PROMPT_MAX_TOKENS_MAX, PROMPT_MAX_TOKENS_MIN, PROMPT_TEMPERATURE_MAX, PROMPT_TEMPERATURE_MIN } from '#shared/ia'
import { FRAIS_SUPPORTEURS, FRAIS_TAUX_PB_MAX, POINTS_BASE_TOTAL } from '#shared/paiements'
import type { FraisSupporteur } from '#shared/paiements'
import { PERIODES_MOIS, PLAN_IDS } from '#shared/plans'
import type { PlanId } from '#shared/plans'
import { STATISTIQUES_RETENTION_JOURS } from '#shared/statistiques'
import { VERSION_PLAN_LIMITES_CLES } from '#shared/schemas/admin-versions'
import type {
  ImpactPlan,
  ValeursFrais,
  ValeursMoyens,
  ValeursPlan,
  ValeursPrix,
  ValeursPrompt,
  VersionDto,
  VersionPlanLimiteCle,
} from '#shared/schemas/admin-versions'
import { formaterMontantAdmin } from './admin-paiements'

export interface TypeVersion {
  valeur: AdminVersionType
  libelle: string
  aide: string
}

export const TYPES_VERSION: readonly TypeVersion[] = [
  { valeur: 'plans', libelle: 'Plans', aide: 'Limites et droits des plans gratuit et payant.' },
  { valeur: 'prix', libelle: 'Prix', aide: 'Grille de prix du plan payant : trois devises, trois durées.' },
  { valeur: 'frais', libelle: 'Frais', aide: 'Frais du fournisseur de paiement et qui les supporte.' },
  { valeur: 'moyens', libelle: 'Moyens', aide: 'Moyens de paiement ouverts aux clients.' },
  { valeur: 'prompts', libelle: 'Prompts IA', aide: 'Consignes données à l’IA. Modifier un prompt crée une nouvelle version.' },
]

export const TYPE_VERSION_DEFAUT: AdminVersionType = 'plans'

export function lireTypeVersion(valeur: unknown): AdminVersionType {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return ADMIN_VERSION_TYPES.find((type) => type === brut) ?? TYPE_VERSION_DEFAUT
}

const LIBELLES_CLE: Record<string, string> = {
  gratuit: 'Plan gratuit',
  payant: 'Plan payant',
  onboarding_vitrine: 'Création de la vitrine',
  ameliorer_texte: 'Amélioration d’un texte',
  seo_vitrine: 'Référencement de la vitrine',
  kpay: 'K-PAY',
  'kpay:mobile_money': 'K-PAY · Mobile Money',
}

export function libelleCleVersion(cle: string): string {
  return LIBELLES_CLE[cle] ?? cle
}

/** Clés d'un type qui se choisissent dans une liste ; vide : les clés viennent de l'historique (frais, moyens). */
export function clesDuTypeVersion(type: AdminVersionType): readonly string[] {
  if (type === 'plans') return PLAN_IDS
  if (type === 'prix') return ['payant']
  if (type === 'prompts') return IA_TYPES
  return []
}

// --- Statuts et actions ---

type StatutVersion = VersionStatut | VersionPromptStatut

const LIBELLES_STATUT_VERSION: Record<StatutVersion, string> = {
  brouillon: 'Brouillon',
  programmee: 'Programmée',
  active: 'Active',
  remplacee: 'Remplacée',
  inactive: 'Inactive',
}

export function libelleStatutVersion(statut: StatutVersion): string {
  return LIBELLES_STATUT_VERSION[statut]
}

export function couleurStatutVersion(statut: StatutVersion): 'primary' | 'neutral' {
  return statut === 'active' ? 'primary' : 'neutral'
}

export type ActionVersion = 'activer' | 'programmer' | 'retour' | 'valider'

/**
 * Actions proposées sur une version (le serveur reste l'autorité). Un prompt n'a pas de date d'effet. Retour arrière :
 * sur la version ACTIVE, qui cède sa place à la précédente (⚠️ à confirmer avec le backend : sinon `id` = la précédente).
 */
export function actionsVersion(version: VersionDto): ActionVersion[] {
  if (version.type === 'prompts') {
    if (version.statut === 'inactive') return ['activer']
    return version.numero > 1 ? ['retour'] : []
  }
  if (version.statut === 'brouillon') return ['activer', 'programmer']
  if (version.statut !== 'active') return []
  const actions: ActionVersion[] = []
  if (version.type === 'prix' && version.valideeLe === null) actions.push('valider')
  if (version.numero > 1) actions.push('retour')
  return actions
}

export interface DefinitionActionVersion {
  libelle: string
  titre: string
  action: AdminAction
  icone: string
  destructive: boolean
}

export const DEFINITIONS_ACTION_VERSION: Record<ActionVersion, DefinitionActionVersion> = {
  activer: { libelle: 'Activer', titre: 'Activer cette version', action: ADMIN_ACTIONS.versionActiver, icone: 'i-ph-check-circle', destructive: false },
  programmer: { libelle: 'Programmer', titre: 'Programmer cette version', action: ADMIN_ACTIONS.versionActiver, icone: 'i-ph-calendar-check', destructive: false },
  retour: { libelle: 'Retour arrière', titre: 'Revenir à la version précédente', action: ADMIN_ACTIONS.versionRetour, icone: 'i-ph-arrow-counter-clockwise', destructive: true },
  valider: { libelle: 'Valider les prix', titre: 'Valider cette grille de prix', action: ADMIN_ACTIONS.versionValiderPrix, icone: 'i-ph-seal-check', destructive: false },
}

/** Cible du code de réauthentification : l'identifiant de la version (à confirmer avec le backend). */
export function cibleReauthVersion(action: AdminAction, versionId: string): { action: AdminAction, cibleType: AdminCible, cibleId: string } {
  return { action, cibleType: ADMIN_CIBLES.version, cibleId: versionId }
}

/** Chemin de l'écriture d'une action sur une version. */
export function cheminActionVersion(type: AdminVersionType, id: string, action: ActionVersion): string {
  const segment = action === 'programmer' || action === 'activer' ? 'activer' : action
  return `/api/admin/versions/${type}/${encodeURIComponent(id)}/${segment}`
}

// --- Dates d'effet ---

const DIX_MINUTES_MS = 600_000

/** `datetime-local` (heure locale du navigateur) -> instant ISO ; `null` si vide ou illisible. */
export function instantDepuisSaisie(saisie: string): string | null {
  if (saisie === '') return null
  const date = new Date(saisie)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Une programmation doit viser le futur (au moins quelques minutes : le job s'exécute toutes les 60 s). */
export function programmationValide(saisie: string, maintenant: Date): boolean {
  const iso = instantDepuisSaisie(saisie)
  return iso !== null && new Date(iso).getTime() > maintenant.getTime() + DIX_MINUTES_MS
}

// --- Impact d'un plan ---

const LIBELLES_IMPACT: ReadonlyArray<{ cle: keyof ImpactPlan, libelle: string, masque: boolean }> = [
  { cle: 'services', libelle: 'Services', masque: true },
  { cle: 'realisations', libelle: 'Réalisations', masque: true },
  { cle: 'temoignages', libelle: 'Témoignages', masque: true },
  { cle: 'reservationsMois', libelle: 'Réservations ce mois-ci', masque: false },
  { cle: 'generationsIaMois', libelle: 'Propositions de l’IA ce mois-ci', masque: false },
]

export interface LigneImpact {
  cle: keyof ImpactPlan
  libelle: string
  comptes: number
  /** `null` : cette ressource ne masque rien (réservations, IA). */
  elementsMasques: number | null
}

export function lignesImpact(impact: ImpactPlan): LigneImpact[] {
  return LIBELLES_IMPACT.map(({ cle, libelle, masque }) => {
    const valeur = impact[cle]
    return { cle, libelle, comptes: valeur.comptes, elementsMasques: masque && 'elementsMasques' in valeur ? valeur.elementsMasques : null }
  })
}

/** Vrai si au moins un compte est touché : l'activation exige alors un acquittement explicite. */
export function impactNonNul(impact: ImpactPlan): boolean {
  return lignesImpact(impact).some((ligne) => ligne.comptes > 0)
}

/**
 * Corps d'un retour arrière : le motif, plus l'impact acquitté une fois que le serveur l'a présenté (409 `IMPACT_CHANGE`,
 * le retour rétablit une version qui baisse des limites). Sans impact présenté, le corps ne contient que le motif.
 */
export function corpsRetourVersion(motif: string, impactAcquitte: ImpactPlan | null): { motif: string, impactAcquitte?: ImpactPlan } {
  return impactAcquitte === null ? { motif } : { impactAcquitte, motif }
}

export function phraseImpact(ligne: LigneImpact): string {
  const comptes = `${ligne.comptes} ${ligne.comptes > 1 ? 'comptes' : 'compte'}`
  if (ligne.elementsMasques === null) return comptes
  return `${comptes}, ${ligne.elementsMasques} ${ligne.elementsMasques > 1 ? 'éléments masqués' : 'élément masqué'}`
}

// --- Plans ---

export const LIBELLES_LIMITES_PLAN: Record<VersionPlanLimiteCle, string> = {
  services: 'Services',
  realisations: 'Réalisations',
  temoignages: 'Témoignages',
  reservationsParMois: 'Réservations par mois',
  generationsIaParMois: 'Propositions de l’IA par mois',
}

export interface FormPlan {
  limites: Record<VersionPlanLimiteCle, { illimite: boolean, valeur: number }>
  badge: boolean
  statistiquesJours: number
  statistiquesDetails: boolean
  mcp: boolean
}

export function formPlanDepuis(valeurs: ValeursPlan): FormPlan {
  const limites = {} as FormPlan['limites']
  for (const cle of VERSION_PLAN_LIMITES_CLES) {
    const brut = valeurs[cle]
    limites[cle] = { illimite: brut === null, valeur: brut ?? 0 }
  }
  return {
    limites,
    badge: valeurs.badge,
    statistiquesJours: valeurs.statistiquesJours,
    statistiquesDetails: valeurs.statistiquesDetails,
    mcp: valeurs.capacites.mcp,
  }
}

export function valeursPlanDepuis(form: FormPlan): ValeursPlan {
  const limite = (cle: VersionPlanLimiteCle): number | null => (form.limites[cle].illimite ? null : form.limites[cle].valeur)
  return {
    services: limite('services'),
    realisations: limite('realisations'),
    temoignages: limite('temoignages'),
    reservationsParMois: limite('reservationsParMois'),
    generationsIaParMois: limite('generationsIaParMois'),
    badge: form.badge,
    statistiquesJours: form.statistiquesJours,
    statistiquesDetails: form.statistiquesDetails,
    capacites: { mcp: form.mcp },
  }
}

const entierDans = (valeur: number, min: number, max: number): boolean => Number.isInteger(valeur) && valeur >= min && valeur <= max

/** Erreurs de saisie d'un plan, par champ (`limites.services`, `statistiquesJours`). Le serveur revalide, y compris le lien gratuit/payant. */
export function erreursPlan(cle: PlanId, form: FormPlan): Record<string, string> {
  const erreurs: Record<string, string> = {}
  for (const nom of VERSION_PLAN_LIMITES_CLES) {
    const limite = form.limites[nom]
    if (cle === 'gratuit' && limite.illimite) erreurs[`limites.${nom}`] = 'Le plan gratuit ne peut pas être illimité.'
    else if (!limite.illimite && !entierDans(limite.valeur, 0, VERSION_PLAN_LIMITE_MAX)) erreurs[`limites.${nom}`] = `Indiquez un nombre de 0 à ${VERSION_PLAN_LIMITE_MAX}.`
  }
  if (!entierDans(form.statistiquesJours, 1, STATISTIQUES_RETENTION_JOURS)) erreurs.statistiquesJours = `Indiquez un nombre de jours de 1 à ${STATISTIQUES_RETENTION_JOURS}.`
  return erreurs
}

// --- Prix ---

export type FormPrix = Record<Devise, Record<string, string>>

export function formPrixDepuis(valeurs: ValeursPrix): FormPrix {
  const form = {} as FormPrix
  for (const devise of DEVISES) {
    form[devise] = {}
    for (const mois of PERIODES_MOIS) form[devise][String(mois)] = formatPrixSaisi(valeurs[devise][mois], devise)
  }
  return form
}

function montantSaisi(texte: string, devise: Devise): number | null {
  const minor = parsePrixSaisi(texte, devise)
  return minor !== null && minor >= 1 && minor <= PRIX_MAX_MINOR ? minor : null
}

/** Erreurs par champ (`XAF.1`) ; vide : la grille est complète et chaque montant est un entier d'unité mineure. */
export function erreursPrix(form: FormPrix): Record<string, string> {
  const erreurs: Record<string, string> = {}
  for (const devise of DEVISES) {
    for (const mois of PERIODES_MOIS) {
      if (montantSaisi(form[devise][String(mois)] ?? '', devise) === null) erreurs[`${devise}.${mois}`] = 'Indiquez un montant valide.'
    }
  }
  return erreurs
}

/** Grille complète, ou `null` si un montant est invalide (voir `erreursPrix`). */
export function valeursPrixDepuis(form: FormPrix): ValeursPrix | null {
  if (Object.keys(erreursPrix(form)).length > 0) return null
  const grille = (devise: Devise): ValeursPrix[Devise] => {
    const montant = (mois: number): number => montantSaisi(form[devise][String(mois)] ?? '', devise) ?? 0
    return { 1: montant(1), 3: montant(3), 12: montant(12) }
  }
  return { XAF: grille('XAF'), EUR: grille('EUR'), USD: grille('USD') }
}

// --- Frais ---

export interface FormFrais {
  taux: number
  supporteur: FraisSupporteur
}

export const LIBELLES_SUPPORTEUR: Record<FraisSupporteur, string> = {
  marchand: 'Nous (le prix affiché ne change pas)',
  client: 'Le client (ajoutés au prix affiché)',
}
export const OPTIONS_SUPPORTEUR = FRAIS_SUPPORTEURS.map((valeur) => ({ value: valeur, label: LIBELLES_SUPPORTEUR[valeur] }))

/** Points de base -> pourcentage lisible (500 -> « 5 % », 125 -> « 1,25 % »). */
export function pourcentageDepuisPointsBase(pointsBase: number): string {
  const pourcent = (pointsBase * 100) / POINTS_BASE_TOTAL
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(pourcent)} %`
}

export const formFraisDepuis = (valeurs: ValeursFrais): FormFrais => ({ taux: valeurs.tauxPointsBase, supporteur: valeurs.supporteur })
export const valeursFraisDepuis = (form: FormFrais): ValeursFrais => ({ tauxPointsBase: form.taux, supporteur: form.supporteur })
export const MESSAGE_TAUX = `Indiquez un taux entier de 0 à ${FRAIS_TAUX_PB_MAX} points de base (100 points = 1 %).`
export const erreurTaux = (taux: number): string => (entierDans(taux, 0, FRAIS_TAUX_PB_MAX) ? '' : MESSAGE_TAUX)

// --- Moyens ---

export type FormMoyens = Record<string, boolean>

/** Un interrupteur par moyen connu (actif dans une version de l'historique) ; seul le drapeau `actif` se règle. */
export function formMoyensDepuis(valeurs: ValeursMoyens, connus: readonly string[]): FormMoyens {
  const form: FormMoyens = {}
  for (const id of [...new Set([...valeurs.actifs, ...connus])].sort()) form[id] = valeurs.actifs.includes(id)
  return form
}

export const valeursMoyensDepuis = (form: FormMoyens): ValeursMoyens => ({ actifs: Object.keys(form).filter((id) => form[id]) })

// --- Prompts ---

export interface FormPrompt {
  systeme: string
  gabarit: string
  temperature: number
  maxTokens: number
}

export function formPromptDepuis(version: Extract<VersionDto, { type: 'prompts' }> | null): FormPrompt {
  return {
    systeme: version?.valeurs.systeme ?? '',
    gabarit: version?.valeurs.gabarit ?? '',
    temperature: version?.valeurs.parametres.temperature ?? PROMPT_TEMPERATURE_MAX / 2,
    maxTokens: version?.valeurs.parametres.maxTokens ?? PROMPT_MAX_TOKENS_MIN * 10,
  }
}

export const valeursPromptDepuis = (form: FormPrompt): ValeursPrompt => ({
  systeme: form.systeme,
  gabarit: form.gabarit,
  parametres: { temperature: form.temperature, maxTokens: form.maxTokens },
})

export function erreursPrompt(form: FormPrompt): Record<string, string> {
  const erreurs: Record<string, string> = {}
  if (form.systeme.trim() === '') erreurs.systeme = 'Le texte ne peut pas être vide.'
  if (form.gabarit.trim() === '') erreurs.gabarit = 'Le texte ne peut pas être vide.'
  if (!(form.temperature >= PROMPT_TEMPERATURE_MIN && form.temperature <= PROMPT_TEMPERATURE_MAX)) erreurs.temperature = `Indiquez une valeur de ${PROMPT_TEMPERATURE_MIN} à ${PROMPT_TEMPERATURE_MAX}.`
  if (!entierDans(form.maxTokens, PROMPT_MAX_TOKENS_MIN, PROMPT_MAX_TOKENS_MAX)) erreurs.maxTokens = `Indiquez un nombre de ${PROMPT_MAX_TOKENS_MIN} à ${PROMPT_MAX_TOKENS_MAX}.`
  return erreurs
}

const VARIABLE_GABARIT = /\{\{(\w+)\}\}/g

/** Variables `{{nom}}` d'un gabarit, pour information (le serveur calcule les siennes et refuse les inconnues). */
export function variablesDuGabarit(gabarit: string): string[] {
  return [...new Set([...gabarit.matchAll(VARIABLE_GABARIT)].map((m) => m[1] ?? ''))].sort()
}

export const LIBELLES_ERREUR_ESSAI: Record<string, string> = {
  delai: 'Le fournisseur n’a pas répondu à temps.',
  fournisseur: 'Le fournisseur a renvoyé une erreur.',
  reponse_vide: 'La réponse est vide.',
  sortie_invalide: 'La réponse ne respecte pas le format attendu.',
  faits_inventes: 'La réponse contient des faits inventés.',
  accents_manquants: 'La réponse est écrite sans accents.',
  formulation_interdite: 'La réponse contient une formulation interdite.',
}

// --- Résumé d'une version ---

export interface LigneValeur {
  libelle: string
  valeur: string
}

const NON_LIMITE = 'Illimité'
const oui = (v: boolean): string => (v ? 'Oui' : 'Non')

/** Valeurs d'une version, lisibles ligne à ligne (détail repliable de l'historique). */
export function lignesValeursVersion(version: VersionDto): LigneValeur[] {
  switch (version.type) {
    case 'plans':
      return [
        ...VERSION_PLAN_LIMITES_CLES.map((cle) => ({ libelle: LIBELLES_LIMITES_PLAN[cle], valeur: version.valeurs[cle] === null ? NON_LIMITE : String(version.valeurs[cle]) })),
        { libelle: 'Badge de la marque sur la vitrine', valeur: oui(version.valeurs.badge) },
        { libelle: 'Statistiques', valeur: `${version.valeurs.statistiquesJours} jours` },
        { libelle: 'Statistiques détaillées', valeur: oui(version.valeurs.statistiquesDetails) },
        { libelle: 'Connexion d’un assistant', valeur: oui(version.valeurs.capacites.mcp) },
      ]
    case 'prix':
      return DEVISES.map((devise) => ({
        libelle: devise,
        valeur: PERIODES_MOIS.map((mois) => `${mois} mois : ${formaterMontantAdmin(version.valeurs[devise][mois], devise)}`).join(' · '),
      }))
    case 'frais':
      return [
        { libelle: 'Taux', valeur: pourcentageDepuisPointsBase(version.valeurs.tauxPointsBase) },
        { libelle: 'Frais supportés par', valeur: LIBELLES_SUPPORTEUR[version.valeurs.supporteur] },
      ]
    case 'moyens':
      return [{ libelle: 'Moyens ouverts', valeur: version.valeurs.actifs.length > 0 ? version.valeurs.actifs.join(', ') : 'Aucun' }]
    case 'prompts':
      return [
        { libelle: 'Température', valeur: String(version.valeurs.parametres.temperature ?? '—') },
        { libelle: 'Longueur maximale', valeur: String(version.valeurs.parametres.maxTokens ?? '—') },
        { libelle: 'Variables', valeur: version.valeurs.variables.length > 0 ? version.valeurs.variables.join(', ') : 'Aucune' },
        { libelle: 'Format de sortie', valeur: version.valeurs.schemaSortie },
      ]
  }
}
