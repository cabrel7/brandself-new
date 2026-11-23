import { describe, expect, it } from 'vitest'
import { getMoyenPaiement, MOYENS_PAIEMENT } from '../../server/config/paiements'
import { masquer, normaliserNumero } from '../../server/services/paiements/telephone'
import { MERCY_OPERATEUR_PAYS_FORMAT } from '../../server/services/paiements/fournisseurs/mercypay/constantes'
import { MOYEN_ID_FORMAT } from '../../shared/paiements'

// P1-bis : zone XAF de Mercy Pay (Congo, Gabon). Mêmes devise et prix que le Cameroun : aucune conversion. Les formats
// nationaux ne sont pas confirmés : validation souple, Mercy Pay tranche (`invalid_phone_number`).

const OPERATEURS_XAF = [
  { id: 'mercypay:MTN_MOMO_COG', pays: 'COG', indicatif: '242' },
  { id: 'mercypay:AIRTEL_COG', pays: 'COG', indicatif: '242' },
  { id: 'mercypay:AIRTEL_GAB', pays: 'GAB', indicatif: '241' },
  { id: 'mercypay:MOOV_GAB', pays: 'GAB', indicatif: '241' },
] as const

describe('zone XAF de Mercy Pay (Congo, Gabon)', () => {
  it.each(OPERATEURS_XAF)('should declare $id as an active XAF Mercy Pay wallet', ({ id, pays, indicatif }) => {
    const moyen = getMoyenPaiement(id)

    expect(moyen).toMatchObject({ fournisseur: 'mercypay', methode: 'mobile_money', pays, indicatif, devise: 'XAF', actif: true })
    expect(id).toMatch(MOYEN_ID_FORMAT)
    expect(moyen?.operateur).toMatch(MERCY_OPERATEUR_PAYS_FORMAT)
    expect(moyen?.operateur.match(MERCY_OPERATEUR_PAYS_FORMAT)?.[1]).toBe(pays)
    expect(id).toBe(`${moyen?.fournisseur}:${moyen?.operateur}`)
  })

  it('should keep every moyen id unique', () => {
    const ids = MOYENS_PAIEMENT.map((moyen) => moyen.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(OPERATEURS_XAF)('should normalise a national and an international number for $id', ({ id, indicatif }) => {
    const moyen = getMoyenPaiement(id)
    if (!moyen) throw new Error(`moyen absent : ${id}`)

    expect(normaliserNumero('06 123 4567', moyen)).toBe(`${indicatif}061234567`)
    expect(normaliserNumero(`+${indicatif} 06 123 4567`, moyen)).toBe(`${indicatif}061234567`)
  })

  it.each(OPERATEURS_XAF)('should refuse letters and too short or too long numbers for $id', ({ id }) => {
    const moyen = getMoyenPaiement(id)
    if (!moyen) throw new Error(`moyen absent : ${id}`)

    for (const saisie of ['abc', '1234567', '12345678901', '']) {
      expect(() => normaliserNumero(saisie, moyen)).toThrow()
    }
  })

  it('should mask a Congo and a Gabon number with their own prefix, never in clear', () => {
    const indicatifs = [...new Set(MOYENS_PAIEMENT.filter((moyen) => moyen.actif).map((moyen) => moyen.indicatif))]

    expect(masquer('242061234567', indicatifs)).toMatch(/^\+242 0••/)
    expect(masquer('24106123456', indicatifs)).toMatch(/^\+241 0••/)
    expect(masquer('242061234567', indicatifs)).not.toContain('1234')
  })
})
