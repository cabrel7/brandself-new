import { describe, expect, it } from 'vitest'
import {
  schemaPaiementId,
  schemaPaiementInitier,
  schemaTarifsQuery,
  schemaWebhookFournisseur,
} from '../../shared/schemas/abonnement'

// S10 §3.5 : schémas stricts (champ inconnu = refus), jamais d'écho de la saisie.

const VALIDE = { periodeMois: 12, devise: 'XAF', moyen: 'kpay:MTN_MOMO_CMR', telephone: '653456789' }

describe('schemaPaiementInitier', () => {
  it('should accept a complete request', () => {
    expect(schemaPaiementInitier.parse(VALIDE)).toEqual(VALIDE)
  })

  it.each([1, 3, 12])('should accept the period of %i months', (periodeMois) => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, periodeMois }).success).toBe(true)
  })

  it.each([0, 2, 6, 24, -1, 12.5, '12', null])('should refuse the period %j', (periodeMois) => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, periodeMois }).success).toBe(false)
  })

  it.each(['xaf', 'XA', 'XAFF', 'X1F', '', ' XAF'])('should refuse the currency %j', (devise) => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, devise }).success).toBe(false)
  })

  it.each(['kpay:ORANGE_CMR', 'stripe:CARD', 'kpay-2:A1_B2'])('should accept the wallet %s (existence is checked by the service)', (moyen) => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, moyen }).success).toBe(true)
  })

  it.each(['MTN_MOMO_CMR', 'kpay:', 'KPAY:MTN', 'kpay:mtn', 'kpay:M', 'kpay:MTN MOMO', "kpay:MTN'; DROP TABLE paiements;--", ''])(
    'should refuse the wallet %j',
    (moyen) => {
      expect(schemaPaiementInitier.safeParse({ ...VALIDE, moyen }).success).toBe(false)
    },
  )

  it.each(['653 456 789', '+237653456789', '237 653 456 789', '  653456789  '])('should accept the phone number %j', (telephone) => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, telephone }).success).toBe(true)
  })

  it.each(['6534567', '6'.repeat(21), '65345678a', '(237) 653456789', '653-456-789', '+', '', '       '])(
    'should refuse the phone number %j',
    (telephone) => {
      expect(schemaPaiementInitier.safeParse({ ...VALIDE, telephone }).success).toBe(false)
    },
  )

  it('should refuse unknown fields (no mass assignment of amount or provider)', () => {
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, montant: 1 }).success).toBe(false)
    expect(schemaPaiementInitier.safeParse({ ...VALIDE, fournisseur: 'kpay' }).success).toBe(false)
  })

  it('should refuse a missing field', () => {
    const { telephone: _telephone, ...sansTelephone } = VALIDE

    expect(schemaPaiementInitier.safeParse(sansTelephone).success).toBe(false)
  })

  it('should not echo the phone number in the validation messages', () => {
    const resultat = schemaPaiementInitier.safeParse({ ...VALIDE, telephone: '65345678a' })

    expect(JSON.stringify(resultat.error?.issues)).not.toContain('65345678a')
  })
})

describe('schemaPaiementId', () => {
  it('should accept a UUID and refuse anything else', () => {
    expect(schemaPaiementId.safeParse({ id: '8f14e45f-ceea-4e7a-9d3b-0c1f2a3b4c5d' }).success).toBe(true)
    expect(schemaPaiementId.safeParse({ id: 'pas-un-uuid' }).success).toBe(false)
    expect(schemaPaiementId.safeParse({ id: '1; DROP TABLE paiements' }).success).toBe(false)
    expect(schemaPaiementId.safeParse({}).success).toBe(false)
    expect(schemaPaiementId.safeParse({ id: '8f14e45f-ceea-4e7a-9d3b-0c1f2a3b4c5d', autre: 1 }).success).toBe(false)
  })
})

describe('schemaTarifsQuery', () => {
  it('should accept no currency or an uppercase ISO code, and refuse the rest', () => {
    expect(schemaTarifsQuery.safeParse({}).success).toBe(true)
    expect(schemaTarifsQuery.safeParse({ devise: 'EUR' }).success).toBe(true)
    expect(schemaTarifsQuery.safeParse({ devise: 'eur' }).success).toBe(false)
    expect(schemaTarifsQuery.safeParse({ devise: 'EUR', x: '1' }).success).toBe(false)
  })
})

describe('schemaWebhookFournisseur', () => {
  it.each(['kpay', 'stripe', 'un_autre-2'])('should accept the provider name %s', (fournisseur) => {
    expect(schemaWebhookFournisseur.safeParse({ fournisseur }).success).toBe(true)
  })

  it.each(['KPay!', 'k pay', '../etc', '', 'a'.repeat(41)])('should refuse the provider name %j', (fournisseur) => {
    expect(schemaWebhookFournisseur.safeParse({ fournisseur }).success).toBe(false)
  })
})
