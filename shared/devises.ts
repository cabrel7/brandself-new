import type { Devise } from './compte'

/** Nombre de décimales de l'unité mineure (ISO 4217). Les prix sont stockés en unité mineure, en entiers. */
export const DEVISE_DECIMALES: Record<Devise, number> = { XAF: 0, EUR: 2, USD: 2 }

export type DeviseAffichage = 'code' | 'symbol'

/** XAF s'écrit avec son code (« 15 000 XAF », comme les maquettes) ; EUR et USD avec leur symbole. */
export const DEVISE_AFFICHAGE: Record<Devise, DeviseAffichage> = { XAF: 'code', EUR: 'symbol', USD: 'symbol' }

export const PRIX_MAX_MINOR = 1_000_000_000

const LOCALE_PRIX = 'fr-FR'
const BASE_DECIMALE = 10
const SEPARATEUR_DECIMAL_SAISI = ','
const SEPARATEUR_DECIMAL_STANDARD = '.'
// `\s` couvre aussi les espaces insécables et fines insécables produits par Intl.
const ESPACES_SAISIE = /\s/g
const SAISIE_DECIMALE = /^\d+(\.\d+)?$/

function diviseur(devise: Devise): number {
  return BASE_DECIMALE ** DEVISE_DECIMALES[devise]
}

/** `1250, 'EUR'` -> `'12,50 €'` ; `15000, 'XAF'` -> `'15 000 XAF'` (espaces insécables d'Intl). */
export function formatPrix(minor: number, devise: Devise): string {
  const decimales = DEVISE_DECIMALES[devise]
  return new Intl.NumberFormat(LOCALE_PRIX, {
    style: 'currency',
    currency: devise,
    currencyDisplay: DEVISE_AFFICHAGE[devise],
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(minor / diviseur(devise))
}

/** Montant en unité majeure avec point décimal (JSON-LD) : `1250, 'EUR'` -> `'12.50'`. */
export function toMajorUnits(minor: number, devise: Devise): string {
  return (minor / diviseur(devise)).toFixed(DEVISE_DECIMALES[devise])
}

/**
 * Saisie utilisateur -> unité mineure. `'15 000'` (XAF) -> 15000 ; `'12,50'` (EUR) -> 1250.
 * `null` si vide, négatif, non numérique ou avec plus de décimales que la devise n'en permet.
 */
export function parsePrixSaisi(texte: string, devise: Devise): number | null {
  const nettoye = texte
    .replace(ESPACES_SAISIE, '')
    .replace(SEPARATEUR_DECIMAL_SAISI, SEPARATEUR_DECIMAL_STANDARD)
  if (!SAISIE_DECIMALE.test(nettoye)) return null
  const decimales = DEVISE_DECIMALES[devise]
  const [entier = '', fraction = ''] = nettoye.split(SEPARATEUR_DECIMAL_STANDARD)
  if (fraction.length > decimales) return null
  const minor = Number(entier + fraction.padEnd(decimales, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

/** Valeur initiale du champ de saisie : `1250, 'EUR'` -> `'12,50'` ; `15000, 'XAF'` -> `'15000'`. */
export function formatPrixSaisi(minor: number, devise: Devise): string {
  return toMajorUnits(minor, devise).replace(SEPARATEUR_DECIMAL_STANDARD, SEPARATEUR_DECIMAL_SAISI)
}
