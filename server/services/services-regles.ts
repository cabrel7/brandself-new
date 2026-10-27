import { SERVICE_SLUG_MAX } from '../../shared/services'
import { pickAvailableSlug as pickAvailableListSlug, slugFromText } from './listes-regles'

// Règles pures des services (aucune base, aucun réseau) : testées par tests/unit/services-regles.test.ts.
// Les colonnes texte restent des `string` ici : les CHECK de la base garantissent les listes fermées.
// Vedette, « à la une », compteurs et slugs sont communs à toutes les listes : ils vivent dans
// listes-regles.ts (décision #58) et sont ré-exportés ici, mêmes références.

export { computeALaUne, computeCompteurs, resolveEnVedette } from './listes-regles'
export type { Compteurs, ResolveEnVedetteInput } from './listes-regles'

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

/** Slug d'un titre de service : 80 caractères au plus, repli `service`. */
export function slugFromTitle(titre: string): string {
  return slugFromText(titre, { max: SERVICE_SLUG_MAX, repli: SLUG_PAR_DEFAUT })
}

/** `base`, sinon `base-2`, `base-3`… dans la limite de 80 caractères. */
export function pickAvailableSlug(base: string, existants: ReadonlySet<string>): string {
  return pickAvailableListSlug(base, existants, SERVICE_SLUG_MAX)
}
