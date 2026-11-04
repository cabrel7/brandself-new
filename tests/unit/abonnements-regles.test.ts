import { describe, expect, it } from 'vitest'
import { iso, moduleAbonnementsRegles } from './support/s10'

// S10 §1 #119 et #120, CA60 à CA62 : prolongation d'un abonnement. `expire_le` est EXCLUSIF et aligné sur le minuit
// local suivant le dernier jour payé. Fonctions pures :
//   calculerNouvelleEcheance(base: Date, mois: number, fuseau: string): Date   (base = max(now, expire_le), choisie par l'appelant)
//   minuitLocalSuivant(instant: Date, fuseau: string): Date                    (l'instant lui-même s'il est déjà minuit local)
// Fuseau Africa/Douala = UTC+1 toute l'année.

const DOUALA = 'Africa/Douala'
const PARIS = 'Europe/Paris'

async function echeance(base: string, mois: number, fuseau = DOUALA): Promise<string> {
  const { calculerNouvelleEcheance } = await moduleAbonnementsRegles()
  return calculerNouvelleEcheance(new Date(base), mois, fuseau).toISOString()
}

async function minuit(instant: string, fuseau = DOUALA): Promise<string> {
  const { minuitLocalSuivant } = await moduleAbonnementsRegles()
  return minuitLocalSuivant(new Date(instant), fuseau).toISOString()
}

describe('calculerNouvelleEcheance : cas de la spec', () => {
  it('should restart from the current expiry when the subscription is still active: +3 months (CA60)', async () => {
    // Actif jusqu'au 2026-12-03T23:00Z, renouvellement le 2026-11-20 : la base est l'échéance, pas « maintenant ».
    expect(await echeance('2026-12-03T23:00:00.000Z', 3)).toBe('2027-03-03T23:00:00.000Z')
  })

  it('should restart from now when the subscription is in its grace period, which is not billed (CA61)', async () => {
    // 2026-12-06T10:00Z = 11:00 locale ; +1 mois = 2027-01-06 11:00 ; minuit suivant = 2027-01-07 00:00 locale.
    expect(await echeance('2026-12-06T10:00:00.000Z', 1)).toBe('2027-01-06T23:00:00.000Z')
  })

  it('should clamp the end of the month (31 January + 1 month = 28 February) before rounding to midnight (CA62)', async () => {
    expect(await echeance('2027-01-31T09:00:00.000Z', 1)).toBe('2027-02-28T23:00:00.000Z')
  })

  it('should follow the summer time of the user time zone (Europe/Paris, 10 March + 1 month) (CA62)', async () => {
    expect(await echeance('2027-03-10T11:00:00.000Z', 1, PARIS)).toBe('2027-04-10T22:00:00.000Z')
  })
})

describe('calculerNouvelleEcheance : mois civils et calendrier', () => {
  it('should add calendar months, not 30 days (12 months from a Douala midnight = same day next year)', async () => {
    expect(await echeance('2026-11-03T23:00:00.000Z', 12)).toBe('2027-11-03T23:00:00.000Z')
  })

  it('should handle the 29 February of a leap year (+12 months lands on 28 February, last paid day, then midnight)', async () => {
    // 2028-02-29 10:00 locale + 12 mois = 2029-02-28 10:00 (constrain) -> minuit suivant = 2029-03-01 00:00 locale.
    expect(await echeance('2028-02-29T09:00:00.000Z', 12)).toBe('2029-02-28T23:00:00.000Z')
  })

  it('should clamp 30 November + 3 months to 28 February (non leap year)', async () => {
    expect(await echeance('2026-11-30T09:00:00.000Z', 3)).toBe('2027-02-28T23:00:00.000Z')
  })

  it('should cross the new year (December + 1 month)', async () => {
    expect(await echeance('2026-12-15T09:00:00.000Z', 1)).toBe('2027-01-15T23:00:00.000Z')
  })

  it('should keep a base that already is a local midnight on a local midnight (no extra day)', async () => {
    expect(await echeance('2026-12-03T23:00:00.000Z', 1)).toBe('2027-01-03T23:00:00.000Z')
  })

  it('should handle a base falling in a spring forward gap of the user time zone (Paris, 28 March 2027 02:30 does not exist)', async () => {
    // 2027-02-28 02:30 locale (CET) + 1 mois = 2027-03-28 02:30 : heure inexistante -> 03:30 CEST ; minuit suivant = 29 mars 00:00 CEST.
    expect(await echeance('2027-02-28T01:30:00.000Z', 1, PARIS)).toBe('2027-03-28T22:00:00.000Z')
  })

  it('should return an instant strictly after the base and exactly on a local midnight, for any month count and many bases', async () => {
    const { calculerNouvelleEcheance } = await moduleAbonnementsRegles()
    const formateur = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const debut = Date.parse('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < 150; i += 1) {
      const base = new Date(debut + i * 2_731_000_000 + i * 7_919)
      for (const mois of [1, 3, 12]) {
        const resultat = calculerNouvelleEcheance(base, mois, PARIS)
        expect(resultat.getTime()).toBeGreaterThan(base.getTime())
        expect(formateur.format(resultat)).toBe('00:00:00')
      }
    }
  })
})

describe('minuitLocalSuivant', () => {
  it('should return the instant itself when it already is a local midnight', async () => {
    expect(await minuit('2026-12-03T23:00:00.000Z')).toBe('2026-12-03T23:00:00.000Z')
  })

  it('should round the last millisecond before midnight up to that midnight', async () => {
    expect(await minuit('2026-12-03T22:59:59.999Z')).toBe('2026-12-03T23:00:00.000Z')
  })

  it('should move to the next day one millisecond after a local midnight', async () => {
    expect(await minuit('2026-12-03T23:00:00.001Z')).toBe('2026-12-04T23:00:00.000Z')
  })

  it('should round noon to the following local midnight', async () => {
    expect(await minuit('2026-11-03T13:00:00.000Z')).toBe('2026-11-03T23:00:00.000Z')
  })

  it('should give a 23 h day on the spring forward night and a 25 h day on the fall back night (Paris)', async () => {
    // 2027-03-28 : passage à l'heure d'été (CET -> CEST) à 01:00Z ; 2027-10-31 : retour à l'heure d'hiver à 01:00Z.
    expect(await minuit('2027-03-27T23:00:00.001Z', PARIS)).toBe('2027-03-28T22:00:00.000Z')
    expect(await minuit('2027-10-30T22:00:00.001Z', PARIS)).toBe('2027-10-31T23:00:00.000Z')
  })

  it('should work for a zone ahead of UTC+12 and a zone behind UTC-10', async () => {
    expect(iso(await minuit('2026-11-03T13:00:00.000Z', 'Pacific/Kiritimati'))).toBe('2026-11-04T10:00:00.000Z')
    expect(iso(await minuit('2026-11-03T13:00:00.000Z', 'Pacific/Pago_Pago'))).toBe('2026-11-04T11:00:00.000Z')
  })
})
