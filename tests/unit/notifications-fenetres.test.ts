import { Temporal } from '@js-temporal/polyfill'
import { describe, expect, it } from 'vitest'
import {
  RAPPEL_JOURNEE_HEURE_LOCALE,
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RESUME_HEURE_LOCALE,
  RESUME_JOUR_ISO,
  RESUME_PERIODE_JOURS,
  RESUME_RATTRAPAGE_HEURES,
} from '../../shared/notifications'

// S9 §4.3 / CA18, CA20, CA21, CA30, CA34 : fonctions pures de fenêtres horaires LOCALES (Temporal), horloge
// injectée. `server/services/notifications/fenetres.ts` n'existe pas encore (phase RED : module introuvable).

const fenetres = () => import('../../server/services/notifications/fenetres')

const HEURE_MS = 3_600_000

function local(instantIso: string, fuseau: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(instantIso).toZonedDateTimeISO(fuseau)
}

function ms(instant: Temporal.Instant): number {
  return instant.epochMilliseconds
}

function dureeHeures(debut: Temporal.Instant, fin: Temporal.Instant): number {
  return (ms(fin) - ms(debut)) / HEURE_MS
}

describe('dansFenetre', () => {
  it.each([
    ['06:59', '2026-11-10T05:59:00Z', false],
    ['07:00', '2026-11-10T06:00:00Z', true],
    ['07:00:00.001 (début inclus)', '2026-11-10T06:00:00.001Z', true],
    ['09:59:59', '2026-11-10T08:59:59Z', true],
    ['10:00 (fin exclue)', '2026-11-10T09:00:00Z', false],
    ['23:59', '2026-11-10T22:59:00Z', false],
    ['minuit', '2026-11-09T23:00:00Z', false],
  ])('should answer for the rendez-vous du jour window at %s local time (Douala, UTC+1)', async (_libelle, instant, attendu) => {
    const { dansFenetre } = await fenetres()

    expect(dansFenetre(local(instant, 'Africa/Douala'), RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)).toBe(attendu)
  })

  it.each([
    ['07:59', '2026-11-02T06:59:00Z', false],
    ['08:00', '2026-11-02T07:00:00Z', true],
    ['13:59', '2026-11-02T12:59:00Z', true],
    ['14:00 (fin exclue)', '2026-11-02T13:00:00Z', false],
  ])('should answer for the résumé window at %s local time (Douala)', async (_libelle, instant, attendu) => {
    const { dansFenetre } = await fenetres()

    expect(dansFenetre(local(instant, 'Africa/Douala'), RESUME_HEURE_LOCALE, RESUME_RATTRAPAGE_HEURES)).toBe(attendu)
  })

  it('should read the WALL CLOCK, not the elapsed time since midnight, on the spring-forward day (Paris 2027-03-28)', async () => {
    const { dansFenetre } = await fenetres()
    // 02:00 → 03:00 n'existe pas : 07:00 sur le mur n'est que la 6e heure écoulée depuis minuit.
    const septHeures = local('2027-03-28T05:00:00Z', 'Europe/Paris')
    const sixHeures59 = local('2027-03-28T04:59:00Z', 'Europe/Paris')

    expect(septHeures.hour).toBe(7)
    expect(dansFenetre(septHeures, RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)).toBe(true)
    expect(dansFenetre(sixHeures59, RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)).toBe(false)
  })

  it('should read the WALL CLOCK on the fall-back day (Paris 2026-10-25, 25 hours long)', async () => {
    const { dansFenetre } = await fenetres()
    const septHeures = local('2026-10-25T06:00:00Z', 'Europe/Paris')
    const sixHeures59 = local('2026-10-25T05:59:00Z', 'Europe/Paris')

    expect(septHeures.hour).toBe(7)
    expect(dansFenetre(septHeures, RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)).toBe(true)
    expect(dansFenetre(sixHeures59, RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)).toBe(false)
  })

  it('should follow the zone offset: the same instant is 07:00 in Douala, 08:00 in Helsinki and 01:00 in New York', async () => {
    const { dansFenetre } = await fenetres()
    const instant = '2026-11-10T06:00:00Z'

    expect(dansFenetre(local(instant, 'Africa/Douala'), 7, 1)).toBe(true)
    expect(dansFenetre(local(instant, 'Europe/Helsinki'), 7, 1)).toBe(false)
    expect(dansFenetre(local(instant, 'America/New_York'), 7, 1)).toBe(false)
  })

  it('should handle extreme offsets (UTC+14 Kiritimati, UTC-11 Pago Pago) without day confusion', async () => {
    const { dansFenetre } = await fenetres()
    // 2026-11-02T18:00Z : Kiritimati = mardi 3 novembre 08:00 ; Pago Pago = lundi 2 novembre 07:00.
    const instant = '2026-11-02T18:00:00Z'

    expect(local(instant, 'Pacific/Kiritimati').dayOfWeek).toBe(2)
    expect(local(instant, 'Pacific/Pago_Pago').dayOfWeek).toBe(1)
    expect(dansFenetre(local(instant, 'Pacific/Kiritimati'), RESUME_HEURE_LOCALE, RESUME_RATTRAPAGE_HEURES)).toBe(true)
    expect(dansFenetre(local(instant, 'Pacific/Pago_Pago'), RESUME_HEURE_LOCALE, RESUME_RATTRAPAGE_HEURES)).toBe(false)
  })
})

describe('periodeResume', () => {
  it('should cover the 7 previous local days for Douala and label them with the ISO week (CA26)', async () => {
    const { periodeResume } = await fenetres()

    const periode = periodeResume(local('2026-11-02T07:00:00Z', 'Africa/Douala'))

    expect(periode.fin.toString()).toBe('2026-11-01T23:00:00Z')
    expect(periode.debut.toString()).toBe('2026-10-25T23:00:00Z')
    expect(periode.label).toBe('2026-W44')
    expect(dureeHeures(periode.debut, periode.fin)).toBe(RESUME_PERIODE_JOURS * 24)
  })

  it('should end at the start of the local Monday, whatever the time of day the tick runs', async () => {
    const { periodeResume } = await fenetres()

    const matin = periodeResume(local('2026-11-02T07:00:00Z', 'Africa/Douala'))
    const apresMidi = periodeResume(local('2026-11-02T12:59:59Z', 'Africa/Douala'))

    expect(apresMidi.debut.toString()).toBe(matin.debut.toString())
    expect(apresMidi.fin.toString()).toBe(matin.fin.toString())
    expect(apresMidi.label).toBe(matin.label)
  })

  it('should be 168 h for Paris when the whole week is in winter time (Oct 26 to Nov 1 2026, CA34)', async () => {
    const { periodeResume } = await fenetres()

    const periode = periodeResume(local('2026-11-02T07:00:00Z', 'Europe/Paris'))

    expect(periode.debut.toString()).toBe('2026-10-25T23:00:00Z')
    expect(periode.fin.toString()).toBe('2026-11-01T23:00:00Z')
    expect(dureeHeures(periode.debut, periode.fin)).toBe(168)
    expect(periode.label).toBe('2026-W44')
  })

  it('should be 167 h for Paris on the spring-forward week (Mar 22 to Mar 28 2027): local midnights, not 7 x 24 h (CA34)', async () => {
    const { periodeResume } = await fenetres()

    // Lundi 2027-03-29 08:00 CEST. Écart spec : CA34 écrit « 2027-03-22T23:00Z », or c'est mardi 23 mars 00:00 CET
    // (143 h) ; les 167 h annoncés correspondent à lundi 22 mars 00:00 CET = 2027-03-21T23:00Z.
    const periode = periodeResume(local('2027-03-29T06:00:00Z', 'Europe/Paris'))

    expect(periode.debut.toString()).toBe('2027-03-21T23:00:00Z')
    expect(periode.fin.toString()).toBe('2027-03-28T22:00:00Z')
    expect(dureeHeures(periode.debut, periode.fin)).toBe(167)
    expect(periode.label).toBe('2027-W12')
  })

  it('should be 169 h for Paris on the fall-back week (Oct 19 to Oct 25 2026)', async () => {
    const { periodeResume } = await fenetres()

    const periode = periodeResume(local('2026-10-26T07:00:00Z', 'Europe/Paris'))

    expect(periode.debut.toString()).toBe('2026-10-18T22:00:00Z')
    expect(periode.fin.toString()).toBe('2026-10-25T23:00:00Z')
    expect(dureeHeures(periode.debut, periode.fin)).toBe(169)
    expect(periode.label).toBe('2026-W43')
  })

  it('should be 169 h for New York on the week of the end of daylight saving time (Oct 26 to Nov 1 2026)', async () => {
    const { periodeResume } = await fenetres()

    const periode = periodeResume(local('2026-11-02T13:00:00Z', 'America/New_York'))

    expect(periode.debut.toString()).toBe('2026-10-26T04:00:00Z')
    expect(periode.fin.toString()).toBe('2026-11-02T05:00:00Z')
    expect(dureeHeures(periode.debut, periode.fin)).toBe(169)
  })

  it('should use the ISO week-year, not the calendar year, around New Year (W53 of 2026, W01 of 2026 starting in 2025)', async () => {
    const { periodeResume } = await fenetres()

    // Lundi 2027-01-04 : période du 28 décembre 2026 au 3 janvier 2027 = semaine 53 de 2026.
    expect(periodeResume(local('2027-01-04T07:00:00Z', 'Africa/Douala')).label).toBe('2026-W53')
    // Lundi 2026-01-05 : période du 29 décembre 2025 au 4 janvier 2026 = semaine 1 de 2026.
    expect(periodeResume(local('2026-01-05T07:00:00Z', 'Africa/Douala')).label).toBe('2026-W01')
  })

  it('should zero-pad the week number (W01 to W09) and respect the 32-character occurrence budget', async () => {
    const { periodeResume } = await fenetres()

    const label = periodeResume(local('2026-02-16T07:00:00Z', 'Africa/Douala')).label

    expect(label).toBe('2026-W07')
    expect(label).toMatch(/^\d{4}-W\d{2}$/)
    expect(label.length).toBeLessThanOrEqual(32)
  })

  it('should work at UTC+14 and UTC-11 (a Monday morning there is still the right local Monday)', async () => {
    const { periodeResume } = await fenetres()

    // Lundi 2026-11-02 08:00 à Kiritimati (UTC+14) = 2026-11-01T18:00Z.
    const kiritimati = periodeResume(local('2026-11-01T18:00:00Z', 'Pacific/Kiritimati'))
    // Lundi 2026-11-02 08:00 à Pago Pago (UTC-11) = 2026-11-02T19:00Z.
    const pago = periodeResume(local('2026-11-02T19:00:00Z', 'Pacific/Pago_Pago'))

    expect(kiritimati.fin.toString()).toBe('2026-11-01T10:00:00Z')
    expect(pago.fin.toString()).toBe('2026-11-02T11:00:00Z')
    expect(kiritimati.label).toBe('2026-W44')
    expect(pago.label).toBe('2026-W44')
  })
})

describe('journeeLocale', () => {
  it('should cover the local day of Douala and label it AAAA-MM-JJ (CA18)', async () => {
    const { journeeLocale } = await fenetres()

    const journee = journeeLocale(local('2026-11-10T06:00:00Z', 'Africa/Douala'))

    expect(journee.debut.toString()).toBe('2026-11-09T23:00:00Z')
    expect(journee.fin.toString()).toBe('2026-11-10T23:00:00Z')
    expect(journee.label).toBe('2026-11-10')
  })

  it('should put 23:30 of the day before in the previous local day (CA20)', async () => {
    const { journeeLocale } = await fenetres()

    // Un rendez-vous à 23:30 locale la veille (22:30Z le 9) n'appartient pas à la journée du 10.
    const journee = journeeLocale(local('2026-11-10T06:00:00Z', 'Africa/Douala'))
    const veille2330 = Date.parse('2026-11-09T22:30:00Z')

    expect(veille2330).toBeLessThan(ms(journee.debut))
  })

  it('should be 23 h on the spring-forward day and 25 h on the fall-back day (Paris)', async () => {
    const { journeeLocale } = await fenetres()

    const printemps = journeeLocale(local('2027-03-28T05:00:00Z', 'Europe/Paris'))
    const automne = journeeLocale(local('2026-10-25T06:00:00Z', 'Europe/Paris'))

    expect(dureeHeures(printemps.debut, printemps.fin)).toBe(23)
    expect(dureeHeures(automne.debut, automne.fin)).toBe(25)
    expect(printemps.label).toBe('2027-03-28')
    expect(automne.label).toBe('2026-10-25')
  })

  it('should give the same label for two instants of the same local day, and a new one after local midnight', async () => {
    const { journeeLocale } = await fenetres()

    const matin = journeeLocale(local('2026-11-10T06:00:00Z', 'Africa/Douala')).label
    const soir = journeeLocale(local('2026-11-10T22:59:59Z', 'Africa/Douala')).label
    const lendemain = journeeLocale(local('2026-11-10T23:00:00Z', 'Africa/Douala')).label

    expect(soir).toBe(matin)
    expect(lendemain).toBe('2026-11-11')
  })

  it('should label the day in the user zone, not in UTC (UTC-11 at 2026-11-10T05:00Z is still November 9)', async () => {
    const { journeeLocale } = await fenetres()

    expect(journeeLocale(local('2026-11-10T05:00:00Z', 'Pacific/Pago_Pago')).label).toBe('2026-11-09')
    expect(journeeLocale(local('2026-11-09T12:00:00Z', 'Pacific/Kiritimati')).label).toBe('2026-11-10')
  })

  it('should keep the label identical after a zone change inside the same civil date (CA25 premise)', async () => {
    const { journeeLocale } = await fenetres()

    // 07:00 à Douala et 07:00 à New York le même jour civil : même étiquette, donc même ligne d'outbox.
    expect(journeeLocale(local('2026-11-10T06:00:00Z', 'Africa/Douala')).label)
      .toBe(journeeLocale(local('2026-11-10T12:00:00Z', 'America/New_York')).label)
  })
})

describe('debutSemaineIso', () => {
  it('should return the local Monday 00:00 of the ISO week, for every day of the week', async () => {
    const { debutSemaineIso } = await fenetres()

    const lundiMinuit = '2026-11-01T23:00:00Z'
    for (const jour of ['2026-11-02T07:00:00Z', '2026-11-04T12:00:00Z', '2026-11-08T22:59:59Z']) {
      expect(debutSemaineIso(local(jour, 'Africa/Douala')).toString(), jour).toBe(lundiMinuit)
    }
  })

  it('should treat Sunday 23:59 local as the END of the week, and Monday 00:00 local as the start of the next', async () => {
    const { debutSemaineIso } = await fenetres()

    expect(debutSemaineIso(local('2026-11-08T22:59:59Z', 'Africa/Douala')).toString()).toBe('2026-11-01T23:00:00Z')
    expect(debutSemaineIso(local('2026-11-08T23:00:00Z', 'Africa/Douala')).toString()).toBe('2026-11-08T23:00:00Z')
  })

  it('should return a local midnight even when the week contains a DST change (Paris, week of 2027-03-22)', async () => {
    const { debutSemaineIso } = await fenetres()

    // Lundi 22 mars 00:00 CET = 21 mars 23:00Z, même quand on part du dimanche 28 (CEST).
    expect(debutSemaineIso(local('2027-03-28T10:00:00Z', 'Europe/Paris')).toString()).toBe('2027-03-21T23:00:00Z')
  })

  it('should be independent of the weekday constant: RESUME_JOUR_ISO is Monday', () => {
    expect(RESUME_JOUR_ISO).toBe(1)
  })
})
