import { z } from 'zod'
import { SERVICES_PROPOSES } from '../../shared/ia'
import { ONBOARDING_MANQUANTS } from '../../shared/onboarding'
import type { OnboardingEtape, OnboardingManquant } from '../../shared/onboarding'
import { isReserved } from '../../shared/reserved'
import { SERVICE_TYPES } from '../../shared/services'
import { hasValidUsernameFormat, USERNAME_MAX_LENGTH } from '../utils/username'
import { slugFromText } from './listes-regles'

// S8 §0 #68 et §6 : règles pures de l'inscription guidée (aucune base, aucun réseau). L'étape de reprise
// n'est JAMAIS stockée : elle se déduit des données, donc ne peut pas dériver du contenu réel.

/** Identité saisie à l'étape 1 : toutes les colonnes sont nulles tant que l'étape n'est pas enregistrée. */
export interface IdentiteProgression {
  titre: string | null
  prenom: string | null
  nom: string | null
  metier: string | null
  ville: string | null
  pays: string | null
}

/** Ce que les règles lisent d'une ligne de progression (une ligne complète convient). */
export interface ProgressionEtat extends IdentiteProgression {
  photoMediaId: string | null
  propositionValideeLe: Date | null
}

/** Champs d'identité sans lesquels la vitrine n'est ni publiable ni générable (le titre est facultatif). */
const CHAMPS_IDENTITE_REQUIS = ['prenom', 'nom', 'metier', 'ville', 'pays'] as const

const ETAPE_IDENTITE: OnboardingEtape = 1
const ETAPE_PHOTO: OnboardingEtape = 2
const ETAPE_PROPOSITION: OnboardingEtape = 3
const ETAPE_ADRESSE: OnboardingEtape = 4

function renseigne(valeur: string | null): boolean {
  return valeur !== null && valeur.trim() !== ''
}

export function identiteComplete(ligne: IdentiteProgression): boolean {
  return CHAMPS_IDENTITE_REQUIS.every((champ) => renseigne(ligne[champ]))
}

/** Identité incomplète → 1 ; pas de photo → 2 ; proposition non validée → 3 ; sinon 4. */
export function computeEtapeReprise(ligne: ProgressionEtat): OnboardingEtape {
  if (!identiteComplete(ligne)) return ETAPE_IDENTITE
  if (ligne.photoMediaId === null) return ETAPE_PHOTO
  if (ligne.propositionValideeLe === null) return ETAPE_PROPOSITION
  return ETAPE_ADRESSE
}

/** Parties encore manquantes avant la publication, dans l'ordre canonique. Une progression absente manque de tout. */
export function computeManquants(ligne: ProgressionEtat | null): OnboardingManquant[] {
  if (ligne === null) return [...ONBOARDING_MANQUANTS]
  const manquants: Record<OnboardingManquant, boolean> = {
    identite: !identiteComplete(ligne),
    photo: ligne.photoMediaId === null,
    proposition: ligne.propositionValideeLe === null,
  }
  return ONBOARDING_MANQUANTS.filter((partie) => manquants[partie])
}

/** Vrai si le titre, le métier, la ville ou le pays change : seules ces valeurs atteignent le fournisseur d'IA. */
export function identiteIaModifiee(avant: IdentiteProgression, apres: IdentiteProgression): boolean {
  return (
    avant.titre !== apres.titre
    || avant.metier !== apres.metier
    || avant.ville !== apres.ville
    || avant.pays !== apres.pays
  )
}

/** Longueur de travail d'un candidat avant de savoir s'il tient dans l'adresse (30 caractères) sans être coupé. */
const LONGUEUR_CANDIDAT_MAX = 200

/**
 * Candidats d'adresse, du plus complet au plus court : « dr-cabrel-nguesso » (titre, prénom, nom), puis
 * « cabrel-nguesso », « dr-cabrel » et « cabrel ». Sans titre, le premier et le deuxième sont identiques.
 */
function candidatsAdresse(identite: IdentiteProgression): string[] {
  const prenom = identite.prenom ?? ''
  const nom = identite.nom ?? ''
  const titre = identite.titre ?? ''
  return [`${titre} ${prenom} ${nom}`, `${prenom} ${nom}`, `${titre} ${prenom}`, prenom]
}

/**
 * Adresse proposée à l'étape 4 : titre, prénom et nom (« dr-cabrel-nguesso »). Vide si l'identité est incomplète ;
 * jamais une adresse que le studio refuserait (format, longueur, mot réservé). On prend le premier candidat qui tient
 * en entier dans la limite, sans être coupé en plein mot ; à défaut, le premier candidat valide une fois coupé.
 */
export function computeUsernameSuggere(identite: IdentiteProgression): string {
  if (!identiteComplete(identite)) return ''
  const candidats = candidatsAdresse(identite)
  for (const candidat of candidats) {
    const adresse = slugFromText(candidat, { max: LONGUEUR_CANDIDAT_MAX, repli: '' })
    if (adresse.length <= USERNAME_MAX_LENGTH && hasValidUsernameFormat(adresse) && !isReserved(adresse)) return adresse
  }
  for (const candidat of candidats) {
    const adresse = slugFromText(candidat, { max: USERNAME_MAX_LENGTH, repli: '' })
    if (hasValidUsernameFormat(adresse) && !isReserved(adresse)) return adresse
  }
  return ''
}

/** Un service du brouillon validé à l'étape 3 (colonne JSONB `services_proposes`, relue à chaque lecture). */
export const schemaServiceBrouillon = z.strictObject({
  titre: z.string(),
  description: z.string(),
  type: z.enum(SERVICE_TYPES),
  dureeMin: z.int().nullable(),
  nbSeances: z.int().nullable(),
  actif: z.boolean(),
})

export const schemaServicesBrouillon = z.array(schemaServiceBrouillon).max(SERVICES_PROPOSES)

export type ServiceBrouillon = z.infer<typeof schemaServiceBrouillon>
