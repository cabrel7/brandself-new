import slugify from '@sindresorhus/slugify'
import { SERVICE_SLUG_MAX, SERVICE_SLUG_REGEX } from '../../shared/services'

// Règles pures des services (aucune base, aucun réseau) : testées par tests/unit/services-regles.test.ts.
// Les colonnes texte restent des `string` ici : les CHECK de la base garantissent les listes fermées.

/** Partie de l'état d'un service concernée par les règles de cohérence (R1 à R6). */
export interface ServiceState {
  type: string
  nbSeances: number | null
  rythme: string | null
  dureeMin: number | null
  tarif: string
  prixMontant: number | null
  prixDevise: string | null
  paiementMode: string | null
  paiementInstructions: string | null
  actif: boolean
  enVedette: boolean
}

const TYPE_ACCOMPAGNEMENT = 'accompagnement'
const TYPE_DEVIS = 'devis'
const TARIF_PAYANT = 'payant'
const TARIF_DEVIS = 'devis'
const PAIEMENT_PAR_DEFAUT = 'sur_place'
const SLUG_PAR_DEFAUT = 'service'
const SLUG_SEPARATEUR = '-'
const SLUG_SUFFIXE_MIN = 2
const TRAILING_DASHES = /-+$/

const MSG_DUREE = 'La durée est requise pour ce type de service.'
const MSG_SEANCES = 'Le nombre de séances est requis pour un accompagnement.'
const MSG_TARIF_DEVIS = 'Une prestation sur devis a le tarif « Sur devis ».'
const MSG_PRIX = 'Le prix est requis pour un service payant.'
const MSG_DEVISE = 'La devise est requise pour un service payant.'
const MSG_VEDETTE_MASQUE = 'Un service masqué ne peut pas être en vedette.'

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

/** Fusionne le patch sur l'état (les `undefined` sont ignorés) puis applique la normalisation R5. */
export function normalizeServiceState<E extends ServiceState>(etat: E, patch: Partial<E>): E {
  const merged = { ...etat, ...omitUndefined(patch) }
  const champs: ServiceState = { ...merged }

  if (champs.type !== TYPE_ACCOMPAGNEMENT) {
    champs.nbSeances = null
    champs.rythme = null
  }
  if (champs.tarif !== TARIF_PAYANT) {
    champs.prixMontant = null
    champs.prixDevise = null
    champs.paiementMode = null
    champs.paiementInstructions = null
  } else if (champs.paiementMode === null) {
    champs.paiementMode = PAIEMENT_PAR_DEFAUT
  }
  // Masquer retire la vedette, sauf demande explicite contraire (signalée ensuite par la cohérence, R6).
  if (patch.actif === false && patch.enVedette === undefined) {
    champs.enVedette = false
  }
  return { ...merged, ...champs }
}

/** Erreurs de cohérence par champ (R1 à R4 et R6) ; objet vide si l'état est cohérent. */
export function checkServiceCoherence(etat: ServiceState): Record<string, string[]> {
  const erreurs: Record<string, string[]> = {}
  const add = (champ: string, message: string) => {
    erreurs[champ] = [...(erreurs[champ] ?? []), message]
  }

  if (etat.type !== TYPE_DEVIS && etat.dureeMin === null) add('dureeMin', MSG_DUREE)
  if (etat.type === TYPE_ACCOMPAGNEMENT && etat.nbSeances === null) add('nbSeances', MSG_SEANCES)
  if (etat.type === TYPE_DEVIS && etat.tarif !== TARIF_DEVIS) add('tarif', MSG_TARIF_DEVIS)
  if (etat.tarif === TARIF_PAYANT) {
    if (etat.prixMontant === null) add('prixMontant', MSG_PRIX)
    if (etat.prixDevise === null) add('prixDevise', MSG_DEVISE)
  }
  if (!etat.actif && etat.enVedette) add('enVedette', MSG_VEDETTE_MASQUE)
  return erreurs
}

export interface ResolveEnVedetteInput {
  /** `undefined` = automatique. */
  demande: boolean | undefined
  actif: boolean
  autresEnVedette: number
  max: number
}

/** R7 : décide la vedette d'un service ; `'COMPLET'` si une vedette explicite dépasse le plafond. */
export function resolveEnVedette({ demande, actif, autresEnVedette, max }: ResolveEnVedetteInput): boolean | 'COMPLET' {
  const place = autresEnVedette < max
  if (demande === false) return false
  if (demande === true) return place ? true : 'COMPLET'
  return actif && place
}

/** R11 : les vedettes visibles, sinon les `max` premiers visibles. Jamais plus de `max`. Mêmes objets. */
export function computeALaUne<T extends { enVedette: boolean }>(visibles: readonly T[], max: number): T[] {
  const vedettes = visibles.filter((ligne) => ligne.enVedette)
  return (vedettes.length > 0 ? vedettes : visibles).slice(0, max)
}

export interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

export function computeCompteurs(lignes: readonly { actif: boolean, enVedette: boolean }[], max: number): Compteurs {
  return {
    total: lignes.length,
    visibles: lignes.filter((ligne) => ligne.actif).length,
    enVedette: lignes.filter((ligne) => ligne.enVedette).length,
    vedetteMax: max,
  }
}

function cutSlug(slug: string, max: number): string {
  return slug.slice(0, max).replace(TRAILING_DASHES, '')
}

/** Slug d'un titre : accents et ligatures translittérés, « & » -> « et », 80 caractères au plus, repli `service`. */
export function slugFromTitle(titre: string): string {
  const slug = cutSlug(slugify(titre, { customReplacements: [['&', ' et ']], decamelize: false }), SERVICE_SLUG_MAX)
  return SERVICE_SLUG_REGEX.test(slug) ? slug : SLUG_PAR_DEFAUT
}

/** `base`, sinon `base-2`, `base-3`… (premier numéro libre), toujours dans la limite de 80 caractères. */
export function pickAvailableSlug(base: string, existants: ReadonlySet<string>): string {
  if (!existants.has(base)) return base
  for (let numero = SLUG_SUFFIXE_MIN; ; numero += 1) {
    const suffixe = `${SLUG_SEPARATEUR}${numero}`
    const candidat = `${cutSlug(base, SERVICE_SLUG_MAX - suffixe.length)}${suffixe}`
    if (!existants.has(candidat)) return candidat
  }
}
