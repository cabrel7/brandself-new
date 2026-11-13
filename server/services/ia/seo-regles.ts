import { createHash } from 'node:crypto'
import type { SeoIaProposition } from '../../../shared/seo'

// Décision #24 : règles PURES du SEO IA (aucune base, aucun réseau). La signature des entrées décide si le texte
// généré est « frais » : elle ne couvre que ce que le modèle lit (métier, ville, pays, accroche), jamais le nom,
// la bio ni les textes saisis.

/** Un changement de cette version invalide d'un coup toutes les propositions stockées. */
export const SEO_SIGNATURE_VERSION = 'v1'

/** Séparateur de champs (U+001F) : le texte d'un champ ne peut pas « glisser » dans le suivant. */
const SEPARATEUR_CHAMPS = '\u001f'
const ESPACES = /\s+/g

export interface EntreesSignatureSeo {
  metier: string
  ville: string | null
  pays: string | null
  accroche: string | null
}

/** Ce que `seoIaFraiche` lit d'une ligne de vitrine (le reste de la ligne est ignoré). */
export interface LigneSeoIa extends EntreesSignatureSeo {
  seoIaTitre: string | null
  seoIaDescription: string | null
  seoIaSignature: string | null
}

/** NFC, rognage, espaces multiples (retours et tabulations compris) réduits à un, minuscules françaises. */
function normaliser(texte: string | null | undefined): string {
  return (texte ?? '').normalize('NFC').trim().replace(ESPACES, ' ').toLocaleLowerCase('fr')
}

/**
 * sha256 hexadécimal de [version, métier, ville, pays, accroche] joints par U+001F. Casse et espacement ne comptent
 * pas (changer « Douala » en « douala » ne justifie pas de repayer un appel) ; les accents, eux, comptent. Le pays
 * est un code (« CM »), pris tel quel.
 */
export function signatureEntreesSeo(entrees: EntreesSignatureSeo): string {
  const morceaux = [
    SEO_SIGNATURE_VERSION,
    normaliser(entrees.metier),
    normaliser(entrees.ville),
    entrees.pays ?? '',
    normaliser(entrees.accroche),
  ]
  return createHash('sha256').update(morceaux.join(SEPARATEUR_CHAMPS)).digest('hex')
}

/**
 * Proposition stockée SI elle correspond aux valeurs ACTUELLES (même signature) et est complète ; sinon `null`
 * (jamais une demi-proposition). Ne modifie pas la ligne.
 */
export function seoIaFraiche(ligne: LigneSeoIa): SeoIaProposition | null {
  if (ligne.seoIaSignature === null || ligne.seoIaTitre === null || ligne.seoIaDescription === null) return null
  if (ligne.seoIaSignature !== signatureEntreesSeo(ligne)) return null
  return { titre: ligne.seoIaTitre, description: ligne.seoIaDescription }
}

/** Ce que `seoIaARegenerer` lit d'une ligne de vitrine. */
export interface LigneSeoARegenerer extends LigneSeoIa {
  publieeLe: Date | null
  seoTitre: string | null
  seoDescription: string | null
}

/** Vrai si le professionnel a saisi lui-même ce texte Google (une chaîne vide ou d'espaces n'est pas une saisie). */
export function texteGoogleSaisi(texte: string | null): boolean {
  return texte !== null && texte.trim() !== ''
}

/** Vrai s'il reste au moins un texte Google que l'IA peut écrire (les deux saisis : rien à générer). */
export function resteUnTexteAutomatique(ligne: Pick<LigneSeoARegenerer, 'seoTitre' | 'seoDescription'>): boolean {
  return !(texteGoogleSaisi(ligne.seoTitre) && texteGoogleSaisi(ligne.seoDescription))
}

/** Vitrine publiée, avec du texte à générer, dont la proposition est absente ou périmée : à (re)générer. */
export function seoIaARegenerer(ligne: LigneSeoARegenerer): boolean {
  return ligne.publieeLe !== null && resteUnTexteAutomatique(ligne) && seoIaFraiche(ligne) === null
}
