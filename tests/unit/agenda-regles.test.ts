import { describe, expect, it } from 'vitest'
import { INDISPONIBILITE_PLAGE_MAX_JOURS } from '../../shared/agenda'
import { nombreJoursPlage } from '../../shared/agenda-plage'
import { schemaIndisponibiliteCreate } from '../../shared/schemas/agenda'
import { bornesJourLocal, dateEstPassee, dateLimitePurge, etendrePlage } from '../../server/services/agenda-regles'

const DOUALA = 'Africa/Douala' // UTC+1 toute l'année
const KIRITIMATI = 'Pacific/Kiritimati' // UTC+14
const PAGO_PAGO = 'Pacific/Pago_Pago' // UTC-11

describe('dateEstPassee', () => {
  it('should accept today in the vitrine timezone', () => {
    expect(dateEstPassee('2026-11-10', new Date('2026-11-10T12:00:00Z'), DOUALA)).toBe(false)
  })

  it('should refuse yesterday', () => {
    expect(dateEstPassee('2026-11-09', new Date('2026-11-10T12:00:00Z'), DOUALA)).toBe(true)
  })

  it('should accept a future date', () => {
    expect(dateEstPassee('2026-11-11', new Date('2026-11-10T12:00:00Z'), DOUALA)).toBe(false)
  })

  it('should switch day at local midnight, not at UTC midnight', () => {
    // 22:59:59Z = 23:59:59 à Douala : le 10 est encore « aujourd'hui », le 9 est passé.
    expect(dateEstPassee('2026-11-10', new Date('2026-11-10T22:59:59Z'), DOUALA)).toBe(false)
    // 23:00:00Z = 00:00:00 le 11 à Douala : le 10 devient passé.
    expect(dateEstPassee('2026-11-10', new Date('2026-11-10T23:00:00Z'), DOUALA)).toBe(true)
    expect(dateEstPassee('2026-11-11', new Date('2026-11-10T23:00:00Z'), DOUALA)).toBe(false)
  })

  it('should use a shifted timezone, ahead of UTC', () => {
    // 2026-11-10T11:00Z = 2026-11-11 01:00 à Kiritimati : le 10 est déjà passé alors qu'il est encore le 10 en UTC.
    expect(dateEstPassee('2026-11-10', new Date('2026-11-10T11:00:00Z'), KIRITIMATI)).toBe(true)
    expect(dateEstPassee('2026-11-11', new Date('2026-11-10T11:00:00Z'), KIRITIMATI)).toBe(false)
  })

  it('should use a shifted timezone, behind UTC', () => {
    // 2026-11-10T05:00Z = 2026-11-09 18:00 à Pago Pago : le 9 est encore aujourd'hui.
    expect(dateEstPassee('2026-11-09', new Date('2026-11-10T05:00:00Z'), PAGO_PAGO)).toBe(false)
    expect(dateEstPassee('2026-11-08', new Date('2026-11-10T05:00:00Z'), PAGO_PAGO)).toBe(true)
  })
})

describe('etendrePlage', () => {
  it('should return a single date for a one-day range', () => {
    expect(etendrePlage('2026-11-10', '2026-11-10', INDISPONIBILITE_PLAGE_MAX_JOURS)).toEqual(['2026-11-10'])
  })

  it('should include both bounds in order', () => {
    expect(etendrePlage('2026-11-10', '2026-11-13', INDISPONIBILITE_PLAGE_MAX_JOURS)).toEqual([
      '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
    ])
  })

  it('should cross a month and a year boundary', () => {
    expect(etendrePlage('2026-12-30', '2027-01-02', INDISPONIBILITE_PLAGE_MAX_JOURS)).toEqual([
      '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ])
    expect(etendrePlage('2028-02-28', '2028-03-01', INDISPONIBILITE_PLAGE_MAX_JOURS)).toEqual([
      '2028-02-28', '2028-02-29', '2028-03-01',
    ])
  })

  it('should accept exactly the maximum number of days', () => {
    const dates = etendrePlage('2026-11-01', '2026-12-30', INDISPONIBILITE_PLAGE_MAX_JOURS)
    expect(dates).toHaveLength(INDISPONIBILITE_PLAGE_MAX_JOURS)
    expect(dates.at(-1)).toBe('2026-12-30')
  })

  it('should refuse one day more than the maximum', () => {
    expect(() => etendrePlage('2026-11-01', '2026-12-31', INDISPONIBILITE_PLAGE_MAX_JOURS)).toThrow(RangeError)
  })

  it('should refuse an end before the start', () => {
    expect(() => etendrePlage('2026-11-10', '2026-11-09', INDISPONIBILITE_PLAGE_MAX_JOURS)).toThrow(RangeError)
  })
})

describe('nombreJoursPlage', () => {
  it('should count both bounds', () => {
    expect(nombreJoursPlage('2026-11-10', '2026-11-10')).toBe(1)
    expect(nombreJoursPlage('2026-10-30', '2026-11-02')).toBe(4)
    expect(nombreJoursPlage('2026-11-10', '2026-11-09')).toBe(0)
  })
})

describe('bornesJourLocal', () => {
  it('should convert local midnight bounds to UTC instants', () => {
    const { debut, fin } = bornesJourLocal('2026-11-10', DOUALA)
    expect(debut.toISOString()).toBe('2026-11-09T23:00:00.000Z')
    expect(fin.toISOString()).toBe('2026-11-10T23:00:00.000Z')
  })

  it('should follow a 23-hour day on a DST change', () => {
    // Europe/Paris, passage à l'heure d'été le 2027-03-28 : le jour local ne dure que 23 h.
    const { debut, fin } = bornesJourLocal('2027-03-28', 'Europe/Paris')
    expect(debut.toISOString()).toBe('2027-03-27T23:00:00.000Z')
    expect(fin.toISOString()).toBe('2027-03-28T22:00:00.000Z')
  })
})

describe('dateLimitePurge', () => {
  it('should be the UTC date minus the retention', () => {
    expect(dateLimitePurge(new Date('2026-11-09T04:00:00Z'), 90)).toBe('2026-08-11')
  })
})

describe('schemaIndisponibiliteCreate', () => {
  it('should keep the single-date shape', () => {
    expect(schemaIndisponibiliteCreate.parse({ date: '2026-11-10' })).toEqual({ date: '2026-11-10', raison: null })
    expect(schemaIndisponibiliteCreate.parse({ date: '2026-11-10', raison: ' Congé ' })).toEqual({ date: '2026-11-10', raison: 'Congé' })
  })

  it('should accept a range', () => {
    expect(schemaIndisponibiliteCreate.parse({ debut: '2026-11-10', fin: '2026-11-12', raison: 'Vacances' })).toEqual({
      debut: '2026-11-10', fin: '2026-11-12', raison: 'Vacances',
    })
  })

  it('should accept a range of exactly 60 days and refuse 61', () => {
    expect(schemaIndisponibiliteCreate.safeParse({ debut: '2026-11-01', fin: '2026-12-30' }).success).toBe(true)
    const trop = schemaIndisponibiliteCreate.safeParse({ debut: '2026-11-01', fin: '2026-12-31' })
    expect(trop.success).toBe(false)
  })

  it('should refuse an end before the start', () => {
    expect(schemaIndisponibiliteCreate.safeParse({ debut: '2026-11-10', fin: '2026-11-09' }).success).toBe(false)
  })

  it('should refuse mixed, partial, empty and unknown shapes', () => {
    expect(schemaIndisponibiliteCreate.safeParse({ date: '2026-11-10', debut: '2026-11-10', fin: '2026-11-11' }).success).toBe(false)
    expect(schemaIndisponibiliteCreate.safeParse({ debut: '2026-11-10' }).success).toBe(false)
    expect(schemaIndisponibiliteCreate.safeParse({ fin: '2026-11-10' }).success).toBe(false)
    expect(schemaIndisponibiliteCreate.safeParse({}).success).toBe(false)
    expect(schemaIndisponibiliteCreate.safeParse({ date: '2026-11-10', extra: 1 }).success).toBe(false)
    expect(schemaIndisponibiliteCreate.safeParse({ debut: '2026-13-01', fin: '2026-13-02' }).success).toBe(false)
  })
})
