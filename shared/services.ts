import type { Devise } from './compte'
import { formatPrix } from './devises'

export const SERVICE_TYPES = ['rdv', 'accompagnement', 'atelier', 'devis'] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]

export const TARIFS = ['gratuit', 'payant', 'devis'] as const
export type Tarif = (typeof TARIFS)[number]

export const PAIEMENT_MODES = ['en_ligne', 'sur_place', 'au_choix'] as const
export type PaiementMode = (typeof PAIEMENT_MODES)[number]

/** Modes proposés tant que PAIEMENT_EN_LIGNE est faux (PROJECT_CONTEXT §4.1). */
export const PAIEMENT_MODES_HORS_LIGNE: readonly PaiementMode[] = ['sur_place']

export const RYTHMES = ['hebdomadaire', 'bimensuel', 'mensuel', 'libre'] as const
export type Rythme = (typeof RYTHMES)[number]

// Listes recopiées dans les CHECK de la migration 0010 : les garder synchronisées.
export { VEDETTE_MAX } from './listes'
export const SERVICE_TITRE_MAX = 80
export const SERVICE_DESCRIPTION_MAX = 1000
export const PAIEMENT_INSTRUCTIONS_MAX = 500
export const INCLUS_MAX = 12
export const INCLUS_LIGNE_MAX = 160
export const DUREE_MIN_MIN = 5
export const DUREE_MIN_MAX = 1440
export const SEANCES_MIN = 2
export const SEANCES_MAX = 52
export const SERVICE_SLUG_MAX = 80
export const SERVICE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const AUTRES_SERVICES_MAX = 2
export const SERVICES_REORDER_MAX = 200

/** Seul le type `devis` peut se passer de durée. */
export const DUREE_REQUISE: Record<ServiceType, boolean> = {
  rdv: true,
  accompagnement: true,
  atelier: true,
  devis: false,
}

/** Pastille affichée sur les cartes et le détail public. */
export const SERVICE_TYPE_PASTILLES: Record<ServiceType, string> = {
  rdv: 'Rendez-vous',
  accompagnement: 'Accompagnement',
  atelier: 'Atelier',
  devis: 'Prestation',
}

/** Options du champ « Type de service » du formulaire studio. */
export const SERVICE_TYPE_LIBELLES: Record<ServiceType, string> = {
  rdv: 'Rendez-vous ponctuel',
  accompagnement: 'Accompagnement (plusieurs séances)',
  atelier: 'Atelier ou formation (groupe)',
  devis: 'Prestation sur devis',
}

export interface ServiceAction {
  court: string
  long: string
}

export const SERVICE_ACTIONS: Record<ServiceType, ServiceAction> = {
  rdv: { court: 'Réserver', long: 'Réserver' },
  accompagnement: { court: 'Réserver la 1re séance', long: 'Réserver la première séance' },
  atelier: { court: 'S’inscrire', long: 'S’inscrire' },
  devis: { court: 'Demander un devis', long: 'Demander un devis' },
}

export const TARIF_LIBELLES: Record<Tarif, string> = {
  gratuit: 'Gratuit',
  payant: 'Payant',
  devis: 'Sur devis',
}

export const RYTHME_LIBELLES: Record<Rythme, string> = {
  hebdomadaire: 'Une séance par semaine',
  bimensuel: 'Une séance toutes les deux semaines',
  mensuel: 'Une séance par mois',
  libre: 'À convenir ensemble',
}

export const RYTHME_PHRASES: Record<Rythme, string> = {
  hebdomadaire: 'une par semaine',
  bimensuel: 'une toutes les deux semaines',
  mensuel: 'une par mois',
  libre: 'à un rythme convenu ensemble',
}

export interface PaiementModeLibelle {
  titre: string
  description: string
}

export const PAIEMENT_MODE_LIBELLES: Record<PaiementMode, PaiementModeLibelle> = {
  en_ligne: { titre: 'En ligne', description: 'Le client règle en ligne au moment de la réservation.' },
  sur_place: { titre: 'Sur place, à la séance', description: 'Le client règle directement auprès de vous.' },
  au_choix: { titre: 'Au choix du client', description: 'Le client choisit de régler en ligne ou sur place.' },
}

const SEPARATEUR_META = ' · '
const SUFFIXE_MASQUE = 'Masqué'
const PREFIXE_FORFAIT = 'Forfait '
const INITIALE_PAR_DEFAUT = 'S'
const LOCALE_INITIALE = 'fr'

export function formatDureeCourte(min: number): string {
  return `${min} min`
}

export function formatDureeLongue(min: number): string {
  return `${min} minutes`
}

function libelleSeances(nb: number): string {
  return `${nb} séances`
}

/** `6, 30` -> `'6 séances · 30 min'` (durée omise si inconnue). */
export function resumeSeancesCourt(nb: number, duree: number | null): string {
  return duree === null ? libelleSeances(nb) : `${libelleSeances(nb)}${SEPARATEUR_META}${formatDureeCourte(duree)}`
}

/** `6, 30, 'hebdomadaire'` -> `'6 séances de 30 minutes, une par semaine'`. */
export function resumeSeancesLong(nb: number, duree: number | null, rythme: Rythme | null): string {
  const base = duree === null ? libelleSeances(nb) : `${libelleSeances(nb)} de ${formatDureeLongue(duree)}`
  return rythme === null ? base : `${base}, ${RYTHME_PHRASES[rythme]}`
}

export interface ServiceMetaSource {
  type: ServiceType
  tarif: Tarif
  nbSeances: number | null
  dureeMin: number | null
  actif: boolean
}

/** Ligne de méta de la liste studio : `'Rendez-vous · 45 min · Payant'`, suffixée de `· Masqué`. */
export function metaStudio(s: ServiceMetaSource): string {
  const parts: string[] = []
  if (s.type === 'devis') {
    parts.push(TARIF_LIBELLES.devis)
  }
  else {
    parts.push(SERVICE_TYPE_PASTILLES[s.type])
    if (s.type === 'accompagnement' && s.nbSeances !== null) parts.push(libelleSeances(s.nbSeances))
    else if (s.dureeMin !== null) parts.push(formatDureeCourte(s.dureeMin))
    parts.push(TARIF_LIBELLES[s.tarif])
  }
  if (!s.actif) parts.push(SUFFIXE_MASQUE)
  return parts.join(SEPARATEUR_META)
}

export interface ServicePrixSource {
  type: ServiceType
  tarif: Tarif
  prixMontant: number | null
  prixDevise: Devise | null
}

/** `'Gratuit'` | `'Sur devis'` | prix formaté (préfixé `Forfait ` pour un accompagnement). */
export function libellePrix(s: ServicePrixSource): string {
  if (s.tarif === 'gratuit') return TARIF_LIBELLES.gratuit
  if (s.tarif === 'devis' || s.prixMontant === null || s.prixDevise === null) return TARIF_LIBELLES.devis
  const prix = formatPrix(s.prixMontant, s.prixDevise)
  return s.type === 'accompagnement' ? `${PREFIXE_FORFAIT}${prix}` : prix
}

/** Première lettre en majuscule, accent conservé (`'Échographie'` -> `'É'`). */
export function initialeDuTitre(titre: string): string {
  const [premier] = Array.from(titre.trim())
  return premier === undefined ? INITIALE_PAR_DEFAUT : premier.toLocaleUpperCase(LOCALE_INITIALE)
}

export function serviceDetailHref(username: string, slug: string): string {
  return `/${username}/services/${slug}`
}

/** Cible du bouton d'action d'un service : l'agenda de la vitrine, service présélectionné. */
export function serviceActionHref(username: string, slug: string): string {
  return `/${username}/agenda?service=${slug}`
}
