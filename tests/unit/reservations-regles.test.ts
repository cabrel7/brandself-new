import { describe, expect, it } from 'vitest'
import {
  canTransitionReservation,
  getServiceFlow,
} from '../../server/services/reservations-regles'

// Les statuts des demandes ne sont pas definis par S7. Ce fichier ne leur invente
// donc pas un cycle : il verrouille leur aiguillage depuis le type de service.
//
// S7-bis (§4.3) : `refusee` est un nouveau statut terminal. `en_attente → refusee`
// est la seule entrée dans ce statut ; le refus ne redémarre rien et ne remplace
// jamais `annulee` (emails distincts, décision client du 2026-10-31).

describe('getServiceFlow', () => {
  it.each([
    ['rdv', 'reservation'],
    ['accompagnement', 'reservation'],
    ['atelier', 'demande'],
    ['devis', 'demande'],
  ] as const)('should route %s through the %s flow', (serviceType, expected) => {
    expect(getServiceFlow(serviceType)).toBe(expected)
  })
})

describe('canTransitionReservation', () => {
  it.each([
    ['en_attente', 'confirmee'],
    ['en_attente', 'annulee'],
    ['en_attente', 'refusee'],
    ['confirmee', 'annulee'],
  ] as const)('should allow the manual transition %s -> %s', (from, to) => {
    expect(canTransitionReservation(from, to)).toBe(true)
  })

  it.each([
    ['en_attente', 'en_attente'],
    ['en_attente', 'terminee'],
    ['confirmee', 'confirmee'],
    ['confirmee', 'refusee'],
    ['annulee', 'en_attente'],
    ['annulee', 'confirmee'],
    ['annulee', 'terminee'],
    ['annulee', 'refusee'],
    ['terminee', 'en_attente'],
    ['terminee', 'confirmee'],
    ['terminee', 'annulee'],
    ['terminee', 'refusee'],
    ['refusee', 'en_attente'],
    ['refusee', 'confirmee'],
    ['refusee', 'annulee'],
    ['refusee', 'terminee'],
    ['refusee', 'refusee'],
  ] as const)('should reject the transition %s -> %s', (from, to) => {
    expect(canTransitionReservation(from, to)).toBe(false)
  })

  it('should keep the refusal terminal even with an automatic completion context after the end', () => {
    const fin = new Date('2026-11-02T09:00:00.000Z')
    expect(canTransitionReservation('confirmee', 'refusee', {
      automatique: true,
      fin,
      maintenant: new Date('2026-11-03T09:00:00.000Z'),
    })).toBe(false)
    expect(canTransitionReservation('refusee', 'terminee', {
      automatique: true,
      fin,
      maintenant: new Date('2026-11-03T09:00:00.000Z'),
    })).toBe(false)
  })

  it('should allow confirmed -> completed automatically at the exact end instant', () => {
    const fin = new Date('2026-11-02T09:00:00.000Z')

    expect(canTransitionReservation('confirmee', 'terminee', {
      automatique: true,
      fin,
      maintenant: new Date('2026-11-02T09:00:00.000Z'),
    })).toBe(true)
  })

  it('should reject automatic completion before the reservation end', () => {
    expect(canTransitionReservation('confirmee', 'terminee', {
      automatique: true,
      fin: new Date('2026-11-02T09:00:00.000Z'),
      maintenant: new Date('2026-11-02T08:59:59.999Z'),
    })).toBe(false)
  })

  it('should reject manual completion even after the reservation end', () => {
    expect(canTransitionReservation('confirmee', 'terminee', {
      automatique: false,
      fin: new Date('2026-11-02T09:00:00.000Z'),
      maintenant: new Date('2026-11-02T10:00:00.000Z'),
    })).toBe(false)
    expect(canTransitionReservation('confirmee', 'terminee')).toBe(false)
  })

  it('should never complete a pending reservation directly, even automatically after its end', () => {
    expect(canTransitionReservation('en_attente', 'terminee', {
      automatique: true,
      fin: new Date('2026-11-02T09:00:00.000Z'),
      maintenant: new Date('2026-11-03T09:00:00.000Z'),
    })).toBe(false)
  })
})
