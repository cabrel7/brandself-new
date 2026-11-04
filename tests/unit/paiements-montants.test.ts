import { describe, expect, it } from 'vitest'
import { FRAIS_TAUX_PB_MAX, POINTS_BASE_TOTAL } from '../../shared/paiements'
import { calculerMontants, ceilDiv, prixPeriodes } from '../../shared/paiements-montants'

// S10 CA09, CA10, CA11, CA13 : calcul des montants en entiers (jamais de flottant), arrondi au supérieur.

const TAUX_KPAY_PB = 500
const PRIX_MIN = 100
const PRIX_MAX = 10_000_000
const PAS_ECHANTILLON = 9_973

describe('ceilDiv', () => {
  it.each([
    [10, 5, 2],
    [11, 5, 3],
    [1, 10_000, 1],
    [0, 7, 0],
  ])('should divide %i by %i rounding up to %i', (n, d, attendu) => {
    expect(ceilDiv(n, d)).toBe(attendu)
  })

  it.each([[-1, 3], [1, 0], [1.5, 2], [Number.NaN, 2]])('should refuse %s / %s', (n, d) => {
    expect(() => ceilDiv(n, d)).toThrow(RangeError)
  })
})

describe('calculerMontants : frais supportés par le marchand (CA09)', () => {
  it.each([
    [5_000, 5_000, 250, 4_750],
    [4_999, 4_999, 250, 4_749],
    [13_500, 13_500, 675, 12_825],
    [48_000, 48_000, 2_400, 45_600],
  ])('should charge %i and estimate fees %i / net %i', (prix, montant, frais, net) => {
    expect(calculerMontants({ prixPlan: prix, tauxPb: TAUX_KPAY_PB, supporteur: 'marchand' })).toEqual({ montant, frais, net })
  })

  it('should estimate no fees at a zero rate', () => {
    expect(calculerMontants({ prixPlan: 5_000, tauxPb: 0, supporteur: 'marchand' })).toEqual({ montant: 5_000, frais: 0, net: 5_000 })
  })
})

describe('calculerMontants : frais supportés par le client (CA10)', () => {
  it('should raise 5000 at 5 % to 5264 with 264 of fees and a net of 5000', () => {
    expect(calculerMontants({ prixPlan: 5_000, tauxPb: TAUX_KPAY_PB, supporteur: 'client' })).toEqual({ montant: 5_264, frais: 264, net: 5_000 })
  })

  it('should keep net >= plan price and montant - frais = net over a sample of prices and rates', () => {
    for (const tauxPb of [0, 1, 250, TAUX_KPAY_PB, 999, FRAIS_TAUX_PB_MAX]) {
      for (let prix = PRIX_MIN; prix <= PRIX_MAX; prix += PAS_ECHANTILLON) {
        const { montant, frais, net } = calculerMontants({ prixPlan: prix, tauxPb, supporteur: 'client' })
        expect(net).toBeGreaterThanOrEqual(prix)
        expect(montant - frais).toBe(net)
        expect(montant).toBeGreaterThanOrEqual(prix)
        expect(Number.isInteger(montant) && Number.isInteger(frais)).toBe(true)
      }
    }
  })

  it('should leave the price unchanged at a zero rate', () => {
    expect(calculerMontants({ prixPlan: 5_000, tauxPb: 0, supporteur: 'client' })).toEqual({ montant: 5_000, frais: 0, net: 5_000 })
  })
})

describe('calculerMontants : entrées invalides (CA11)', () => {
  it.each([0, -1, 12.5, Number.NaN, 1_000_000_001])('should refuse the price %s', (prixPlan) => {
    expect(() => calculerMontants({ prixPlan, tauxPb: TAUX_KPAY_PB, supporteur: 'marchand' })).toThrow(RangeError)
  })

  it.each([-1, FRAIS_TAUX_PB_MAX + 1, 1.5, POINTS_BASE_TOTAL])('should refuse the rate %s', (tauxPb) => {
    expect(() => calculerMontants({ prixPlan: 5_000, tauxPb, supporteur: 'client' })).toThrow(RangeError)
  })

  it('should refuse a surcharged amount above the maximum', () => {
    expect(() => calculerMontants({ prixPlan: 1_000_000_000, tauxPb: TAUX_KPAY_PB, supporteur: 'client' })).toThrow(RangeError)
  })
})

describe('prixPeriodes (CA13)', () => {
  const XAF = { 1: 5_000, 3: 13_500, 12: 48_000 } as const

  it('should compute 10 % and 20 % discounts from the monthly price, and highlight 12 months only', () => {
    expect(prixPeriodes(XAF)).toEqual([
      { periodeMois: 1, montant: 5_000, montantParMois: 5_000, remisePct: 0, miseEnAvant: false },
      { periodeMois: 3, montant: 13_500, montantParMois: 4_500, remisePct: 10, miseEnAvant: false },
      { periodeMois: 12, montant: 48_000, montantParMois: 4_000, remisePct: 20, miseEnAvant: true },
    ])
  })

  it('should omit the periods that have no price and never discount below zero', () => {
    const resultat = prixPeriodes({ 1: 5_000, 3: 16_000 })

    expect(resultat.map((p) => p.periodeMois)).toEqual([1, 3])
    expect(resultat[1]?.remisePct).toBe(0)
  })

  it('should round the monthly equivalent to an integer', () => {
    expect(prixPeriodes({ 1: 800, 3: 2_200 })[1]?.montantParMois).toBe(733)
  })
})
