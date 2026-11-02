import { describe, expect, it } from 'vitest'
import { computeCreneaux } from '../../server/services/creneaux'

// Contrat S7 du moteur pur :
// - `du` et `au` sont des dates locales inclusives dans `fuseau` ;
// - l'horloge est la fonction `clock`, obligatoire et injectee ;
// - les creneaux retournes contiennent `debut` et `fin` en Date (instants UTC) ;
// - un horizon de N jours finit a la date locale courante + N, incluse.

type CreneauxInput = Parameters<typeof computeCreneaux>[0]
type Creneaux = ReturnType<typeof computeCreneaux>

const MONDAY = { jourSemaine: 1, debut: '09:00', fin: '12:00' }

function input(overrides: Partial<CreneauxInput> = {}): CreneauxInput {
  return {
    du: '2026-11-02',
    au: '2026-11-02',
    fuseau: 'Africa/Douala',
    pasCreneauMin: 30,
    dureeMin: 60,
    preavisHeures: 0,
    horizonJours: 60,
    disponibilites: [MONDAY],
    indisponibilites: [],
    reservations: [],
    clock: () => new Date('2026-10-30T12:00:00.000Z'),
    ...overrides,
  }
}

function isoDebuts(creneaux: Creneaux): string[] {
  return creneaux.map((creneau) => creneau.debut.toISOString())
}

function isoPlages(creneaux: Creneaux): string[] {
  return creneaux.map((creneau) => `${creneau.debut.toISOString()}/${creneau.fin.toISOString()}`)
}

function localLabel(date: Date, fuseau: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`
}

describe('computeCreneaux - dates locales, pas et duree', () => {
  it('should generate Douala slots from a local Monday and return UTC instants', () => {
    expect(isoPlages(computeCreneaux(input()))).toEqual([
      '2026-11-02T08:00:00.000Z/2026-11-02T09:00:00.000Z',
      '2026-11-02T08:30:00.000Z/2026-11-02T09:30:00.000Z',
      '2026-11-02T09:00:00.000Z/2026-11-02T10:00:00.000Z',
      '2026-11-02T09:30:00.000Z/2026-11-02T10:30:00.000Z',
      '2026-11-02T10:00:00.000Z/2026-11-02T11:00:00.000Z',
    ])
  })

  it.each([
    [15, ['08:00', '08:15', '08:30', '08:45']],
    [30, ['08:00', '08:30']],
    [60, ['08:00']],
  ] as const)('should use the supported step %i minutes', (pasCreneauMin, utcTimes) => {
    const result = computeCreneaux(input({
      pasCreneauMin,
      dureeMin: 15,
      disponibilites: [{ jourSemaine: 1, debut: '09:00', fin: '10:00' }],
    }))

    expect(isoDebuts(result).map((iso) => iso.slice(11, 16))).toEqual(utcTimes)
  })

  it('should keep only starts whose full service duration fits in the availability', () => {
    const result = computeCreneaux(input({
      dureeMin: 45,
      disponibilites: [{ jourSemaine: 1, debut: '09:00', fin: '11:00' }],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T08:30:00.000Z',
      '2026-11-02T09:00:00.000Z',
    ])
  })

  it('should include both local bounds du and au and use ISO weekdays 1..7', () => {
    const result = computeCreneaux(input({
      du: '2026-11-02',
      au: '2026-11-08',
      dureeMin: 30,
      disponibilites: [
        { jourSemaine: 1, debut: '09:00', fin: '09:30' },
        { jourSemaine: 7, debut: '10:00', fin: '10:30' },
      ],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-08T09:00:00.000Z',
    ])
  })
})

describe('computeCreneaux - preavis, horizon et indisponibilites', () => {
  it('should use the injected clock and remove starts inside the notice period', () => {
    const result = computeCreneaux(input({
      preavisHeures: 2,
      clock: () => new Date('2026-11-02T07:15:00.000Z'), // 08:15 a Douala, limite 10:15 locale.
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T09:30:00.000Z',
      '2026-11-02T10:00:00.000Z',
    ])
  })

  it('should include the local horizon date and remove every later date', () => {
    const result = computeCreneaux(input({
      du: '2026-11-02',
      au: '2026-11-05',
      horizonJours: 1,
      dureeMin: 30,
      disponibilites: [1, 2, 3, 4].map((jourSemaine) => ({ jourSemaine, debut: '09:00', fin: '09:30' })),
      clock: () => new Date('2026-11-01T23:00:00.000Z'), // Minuit le 2 novembre a Douala.
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
    ])
  })

  it('should remove an unavailable local date without shifting it through UTC', () => {
    const result = computeCreneaux(input({
      du: '2026-11-02',
      au: '2026-11-03',
      dureeMin: 30,
      disponibilites: [
        { jourSemaine: 1, debut: '09:00', fin: '10:00' },
        { jourSemaine: 2, debut: '09:00', fin: '10:00' },
      ],
      indisponibilites: [{ date: '2026-11-03' }],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T08:30:00.000Z',
    ])
  })
})

describe('computeCreneaux - reservations and half-open overlap [)', () => {
  it.each(['en_attente', 'confirmee'] as const)('should block an active %s reservation but keep touching slots', (statut) => {
    const result = computeCreneaux(input({
      pasCreneauMin: 60,
      disponibilites: [{ jourSemaine: 1, debut: '09:00', fin: '13:00' }],
      reservations: [{
        debut: new Date('2026-11-02T09:00:00.000Z'), // 10:00 locale.
        fin: new Date('2026-11-02T10:00:00.000Z'),
        statut,
      }],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z', // Finit exactement au debut de la reservation.
      '2026-11-02T10:00:00.000Z', // Commence exactement a sa fin.
      '2026-11-02T11:00:00.000Z',
    ])
  })

  it('should remove every slot with even a partial overlap', () => {
    const result = computeCreneaux(input({
      pasCreneauMin: 60,
      disponibilites: [{ jourSemaine: 1, debut: '09:00', fin: '13:00' }],
      reservations: [{
        debut: new Date('2026-11-02T09:45:00.000Z'),
        fin: new Date('2026-11-02T10:15:00.000Z'),
        statut: 'confirmee',
      }],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T11:00:00.000Z',
    ])
  })

  it.each(['annulee', 'terminee'] as const)('should not block a %s reservation', (statut) => {
    const result = computeCreneaux(input({
      pasCreneauMin: 60,
      disponibilites: [{ jourSemaine: 1, debut: '09:00', fin: '11:00' }],
      reservations: [{
        debut: new Date('2026-11-02T08:00:00.000Z'),
        fin: new Date('2026-11-02T09:00:00.000Z'),
        statut,
      }],
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T09:00:00.000Z',
    ])
  })
})

describe('computeCreneaux - Europe/Paris DST 2026', () => {
  it('should omit the nonexistent 02:00 hour on 2026-03-29 without duplicating 03:00', () => {
    const result = computeCreneaux(input({
      du: '2026-03-29',
      au: '2026-03-29',
      fuseau: 'Europe/Paris',
      dureeMin: 30,
      disponibilites: [{ jourSemaine: 7, debut: '01:30', fin: '04:00' }],
      clock: () => new Date('2026-03-20T00:00:00.000Z'),
    }))

    expect(isoDebuts(result)).toEqual([
      '2026-03-29T00:30:00.000Z', // 01:30 CET.
      '2026-03-29T01:00:00.000Z', // 03:00 CEST.
      '2026-03-29T01:30:00.000Z', // 03:30 CEST.
    ])
    expect(result.map((slot) => localLabel(slot.debut, 'Europe/Paris'))).toEqual([
      '2026-03-29 01:30',
      '2026-03-29 03:00',
      '2026-03-29 03:30',
    ])
  })

  it('should emit each ambiguous local time once on 2026-10-25 and preserve real duration', () => {
    const result = computeCreneaux(input({
      du: '2026-10-25',
      au: '2026-10-25',
      fuseau: 'Europe/Paris',
      dureeMin: 30,
      disponibilites: [{ jourSemaine: 7, debut: '01:30', fin: '04:00' }],
      clock: () => new Date('2026-10-20T00:00:00.000Z'),
    }))
    const labels = result.map((slot) => localLabel(slot.debut, 'Europe/Paris'))

    expect(labels).toEqual([
      '2026-10-25 01:30',
      '2026-10-25 02:00',
      '2026-10-25 02:30',
      '2026-10-25 03:00',
      '2026-10-25 03:30',
    ])
    expect(new Set(labels).size).toBe(labels.length)
    expect(result.every((slot) => slot.fin.getTime() - slot.debut.getTime() === 30 * 60_000)).toBe(true)
  })
})
