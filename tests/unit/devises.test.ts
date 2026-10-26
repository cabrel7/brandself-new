import { describe, expect, it } from 'vitest'
import { DEVISES } from '../../shared/compte'
import {
  DEVISE_AFFICHAGE,
  DEVISE_DECIMALES,
  PRIX_MAX_MINOR,
  formatPrix,
  formatPrixSaisi,
  parsePrixSaisi,
  toMajorUnits,
} from '../../shared/devises'

// U15 — prix en unité mineure (décisions #28 et #29). Intl insère des espaces insécables
// (U+00A0, U+202F) : on les normalise en espace simple avant de comparer.
const normaliser = (texte: string) => texte.replace(/[\u00a0\u202f]/g, ' ')

describe('constantes de devises (U15)', () => {
  it('should define decimals and display mode for every supported currency, and nothing else', () => {
    expect(Object.keys(DEVISE_DECIMALES).sort()).toEqual([...DEVISES].sort())
    expect(Object.keys(DEVISE_AFFICHAGE).sort()).toEqual([...DEVISES].sort())
    expect(DEVISE_DECIMALES).toEqual({ XAF: 0, EUR: 2, USD: 2 })
    expect(DEVISE_AFFICHAGE).toEqual({ XAF: 'code', EUR: 'symbol', USD: 'symbol' })
  })

  it('should cap prices at one billion minor units (the database CHECK)', () => {
    expect(PRIX_MAX_MINOR).toBe(1_000_000_000)
  })
})

describe('formatPrix (U15)', () => {
  it.each([
    [15000, 'XAF', '15 000 XAF'],
    [0, 'XAF', '0 XAF'],
    [999, 'XAF', '999 XAF'],
    [1_000_000_000, 'XAF', '1 000 000 000 XAF'],
    [1250, 'EUR', '12,50 €'],
    [100, 'EUR', '1,00 €'],
    [5, 'EUR', '0,05 €'],
    [123456, 'EUR', '1 234,56 €'],
  ] as const)('should format %i %s as %j', (minor, devise, attendu) => {
    expect(normaliser(formatPrix(minor, devise))).toBe(attendu)
  })

  it('should write dollars with two decimals and a dollar sign', () => {
    const texte = normaliser(formatPrix(1250, 'USD'))

    expect(texte).toMatch(/^12,50 (\$US|\$)$/)
  })

  it('should use a space (possibly non-breaking) as thousands separator and never a dot or comma', () => {
    expect(formatPrix(1_500_000, 'XAF')).toMatch(/^1[\s\u00a0\u202f]500[\s\u00a0\u202f]000[\s\u00a0\u202f]XAF$/)
  })
})

describe('toMajorUnits (U15)', () => {
  it.each([
    [15000, 'XAF', '15000'],
    [15000, 'EUR', '150.00'],
    [1250, 'EUR', '12.50'],
    [5, 'USD', '0.05'],
    [0, 'EUR', '0.00'],
    [1_000_000_000, 'EUR', '10000000.00'],
  ] as const)('should convert %i %s into %j (point decimal, no grouping)', (minor, devise, attendu) => {
    expect(toMajorUnits(minor, devise)).toBe(attendu)
  })
})

describe('parsePrixSaisi (U15)', () => {
  it.each([
    ['15 000', 'XAF', 15000],
    ['15000', 'XAF', 15000],
    ['15\u00a0000', 'XAF', 15000],
    ['15\u202f000', 'XAF', 15000],
    [' 2500 ', 'XAF', 2500],
    ['12,50', 'EUR', 1250],
    ['12.50', 'EUR', 1250],
    ['12,5', 'EUR', 1250],
    ['12', 'EUR', 1200],
    ['0,05', 'USD', 5],
    ['1 234,56', 'EUR', 123456],
    ['0', 'XAF', 0],
  ] as const)('should read %j in %s as %i minor units', (texte, devise, attendu) => {
    expect(parsePrixSaisi(texte, devise)).toBe(attendu)
  })

  it.each([
    ['12,505', 'EUR'],
    ['12,5', 'XAF'],
    ['12,0', 'XAF'],
    ['0,001', 'USD'],
    ['', 'XAF'],
    ['   ', 'EUR'],
    ['-5', 'XAF'],
    ['-12,50', 'EUR'],
    ['abc', 'XAF'],
    ['12 abc', 'XAF'],
    ['1e3', 'XAF'],
    ['12,50,3', 'EUR'],
    ['1.234,56', 'EUR'],
    [',50', 'EUR'],
    ['12,', 'EUR'],
    ['NaN', 'XAF'],
    ['Infinity', 'XAF'],
    ['99999999999999999999', 'XAF'],
  ] as const)('should reject %j in %s (null)', (texte, devise) => {
    expect(parsePrixSaisi(texte, devise)).toBeNull()
  })
})

describe('formatPrixSaisi (U15)', () => {
  it.each([
    [15000, 'XAF', '15000'],
    [1250, 'EUR', '12,50'],
    [1200, 'EUR', '12,00'],
    [5, 'USD', '0,05'],
  ] as const)('should give the initial field value %j for %i %s', (minor, devise, attendu) => {
    expect(formatPrixSaisi(minor, devise)).toBe(attendu)
  })

  it.each([
    [15000, 'XAF'],
    [1, 'XAF'],
    [1250, 'EUR'],
    [1, 'EUR'],
    [99, 'USD'],
    [PRIX_MAX_MINOR, 'EUR'],
  ] as const)('should round-trip %i %s through the input field', (minor, devise) => {
    expect(parsePrixSaisi(formatPrixSaisi(minor, devise), devise)).toBe(minor)
  })
})
