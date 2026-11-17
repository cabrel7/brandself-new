import { describe, expect, it } from 'vitest'
import { ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES, ABONNEMENT_RAPPELS_JOURS } from '../../../shared/plans'
import {
  analyserOccurrenceRappel,
  construireOccurrenceRappel,
  evaluerPertinence,
} from '../../../server/services/notifications/pertinence'
import type { EntreeRappelAbonnement } from '../../../server/services/notifications/pertinence'

// A3 R10 et D-A3-07 : `pertinence.ts` revalide chaque rappel d'abonnement juste avant l'envoi. A3 y ajoute l'occurrence d'un
// rappel MANUEL sans toucher aux rappels automatiques J-7, J-3 et J0 : la première partie est une NON-RÉGRESSION (elle doit
// rester verte), la seconde décrit le comportement nouveau.
//
// La forme de l'occurrence manuelle est `MANUEL:<ISO de la demande>` : la spec écrit `manuel:`, mais la contrainte
// `emails_transactionnels_occurrence_check` n'accepte que `[0-9A-Z:.-]` (31 caractères au plus 32). La forme minuscule ne peut
// donc pas exister en base ; ces tests utilisent la seule forme possible.

const EXPIRE = new Date('2026-12-03T23:00:00.000Z')
const PLANIFIE = new Date('2026-11-26T08:00:00.000Z')
const HEURE_MS = 3_600_000

function rappel(occurrence: string, surcharges: Partial<EntreeRappelAbonnement> = {}): EntreeRappelAbonnement {
  return { type: 'abonnement_rappel', occurrence, createdAt: PLANIFIE, abonnement: { expireLe: EXPIRE, destinataire: true }, ...surcharges }
}

describe('rappels automatiques J-7, J-3, J0 : non-régression (R10)', () => {
  it.each(ABONNEMENT_RAPPELS_JOURS)('should let the J%i reminder go out while the subscription still ends at the planned expiry', (jours) => {
    const occurrence = construireOccurrenceRappel(jours, EXPIRE)

    expect(evaluerPertinence(rappel(occurrence), new Date(PLANIFIE.getTime() + HEURE_MS))).toBeNull()
  })

  it.each(ABONNEMENT_RAPPELS_JOURS)('should build then parse the J%i occurrence without loss', (jours) => {
    const occurrence = construireOccurrenceRappel(jours, EXPIRE)

    expect(occurrence).toBe(`J${jours}:2026-12-03T23:00:00.000Z`)
    expect(analyserOccurrenceRappel(occurrence)).toEqual({ jours, expireLe: EXPIRE })
  })

  it('should cancel a reminder whose subscription was renewed since (another expiry): ABONNEMENT_RENOUVELE', () => {
    const renouvele = new Date('2027-01-03T23:00:00.000Z')

    expect(evaluerPertinence(rappel(construireOccurrenceRappel(7, EXPIRE), { abonnement: { expireLe: renouvele, destinataire: true } }), PLANIFIE)).toBe('ABONNEMENT_RENOUVELE')
  })

  it('should cancel a reminder once the expiry is reached or passed: RAPPEL_PERIME', () => {
    const occurrence = construireOccurrenceRappel(0, EXPIRE)

    expect(evaluerPertinence(rappel(occurrence), EXPIRE)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(rappel(occurrence), new Date(EXPIRE.getTime() + HEURE_MS))).toBe('RAPPEL_PERIME')
  })

  it(`should cancel a reminder planned more than ${ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES} hours ago: RAPPEL_PERIME`, () => {
    const occurrence = construireOccurrenceRappel(3, EXPIRE)

    expect(evaluerPertinence(rappel(occurrence), new Date(PLANIFIE.getTime() + (ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES - 1) * HEURE_MS))).toBeNull()
    expect(evaluerPertinence(rappel(occurrence), new Date(PLANIFIE.getTime() + (ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES + 1) * HEURE_MS))).toBe('RAPPEL_PERIME')
  })

  it('should cancel a reminder of a deleted subscription (ENTITE_INTROUVABLE) or without any recipient address (DESTINATAIRE_ABSENT)', () => {
    const occurrence = construireOccurrenceRappel(7, EXPIRE)

    expect(evaluerPertinence(rappel(occurrence, { abonnement: null }), PLANIFIE)).toBe('ENTITE_INTROUVABLE')
    expect(evaluerPertinence(rappel(occurrence, { abonnement: { expireLe: EXPIRE, destinataire: false } }), PLANIFIE)).toBe('DESTINATAIRE_ABSENT')
  })

  it.each([
    ['J5:2026-12-03T23:00:00.000Z', 'un nombre de jours inconnu'],
    ['J7:2026-12-03', 'une date sans heure'],
    ['J7:2026-12-03T23:00:00Z', 'une date sans millisecondes'],
    ['J7:2026-12-04T00:00:00.000+01:00', 'un fuseau explicite'],
    ['J7:pas-une-date', 'du texte'],
    ['', 'une occurrence vide'],
    ['7:2026-12-03T23:00:00.000Z', 'sans le J'],
  ])('should refuse the malformed occurrence %j (%s): RAPPEL_PERIME, never an exception', (occurrence) => {
    expect(analyserOccurrenceRappel(occurrence)).toBeNull()
    expect(evaluerPertinence(rappel(occurrence), PLANIFIE)).toBe('RAPPEL_PERIME')
  })

  it('should never cancel the historical types (no regression on S7 e-mails)', () => {
    expect(evaluerPertinence({ type: 'reservation_professionnel_nouvelle', occurrence: '', createdAt: PLANIFIE }, EXPIRE)).toBeNull()
  })
})

describe('rappel manuel (D-A3-07) : MANUEL:<ISO de la demande>', () => {
  const DEMANDE = new Date('2026-11-30T10:15:00.000Z')
  const OCCURRENCE = `MANUEL:${DEMANDE.toISOString()}`

  it('should fit the database constraint: 32 characters at most, only [0-9A-Z:.-]', () => {
    expect(OCCURRENCE.length).toBeLessThanOrEqual(32)
    expect(OCCURRENCE).toMatch(/^[0-9A-Z:.-]*$/)
  })

  it('should let the reminder go out while the subscription is active, even though the occurrence is NOT the expiry (never ABONNEMENT_RENOUVELE)', () => {
    const entree = rappel(OCCURRENCE, { createdAt: DEMANDE })

    expect(evaluerPertinence(entree, new Date(DEMANDE.getTime() + 60_000))).toBeNull()
  })

  it('should let it go out whatever the planned J-7/J-3/J0 days are: the days left are computed at sending', () => {
    for (const [maintenant, expire] of [['2026-11-26T10:00:00.000Z', EXPIRE], ['2026-12-03T08:00:00.000Z', EXPIRE], ['2026-11-01T10:00:00.000Z', EXPIRE]] as const) {
      const demande = new Date(maintenant)
      const entree = rappel(`MANUEL:${demande.toISOString()}`, { createdAt: demande, abonnement: { expireLe: expire, destinataire: true } })

      expect(evaluerPertinence(entree, new Date(demande.getTime() + 60_000)), maintenant).toBeNull()
    }
  })

  it('should cancel it when the subscription expired before the e-mail went out: RAPPEL_PERIME', () => {
    const entree = rappel(OCCURRENCE, { createdAt: DEMANDE })

    expect(evaluerPertinence(entree, EXPIRE)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree, new Date(EXPIRE.getTime() + 2 * 24 * HEURE_MS))).toBe('RAPPEL_PERIME')
  })

  it('should cancel it for a deleted subscription or without any recipient address', () => {
    expect(evaluerPertinence(rappel(OCCURRENCE, { createdAt: DEMANDE, abonnement: null }), DEMANDE)).toBe('ENTITE_INTROUVABLE')
    expect(evaluerPertinence(rappel(OCCURRENCE, { createdAt: DEMANDE, abonnement: { expireLe: EXPIRE, destinataire: false } }), DEMANDE)).toBe('DESTINATAIRE_ABSENT')
  })

  it.each([
    ['MANUEL:pas-une-date'],
    ['MANUEL:2026-11-30'],
    ['MANUEL:2026-11-30T10:15:00Z'],
    ['MANUEL:'],
    ['MANUEL'],
    ['MANUEL:2026-13-45T99:99:99.000Z'],
  ])('should refuse the malformed manual occurrence %j without throwing', (occurrence) => {
    expect(evaluerPertinence(rappel(occurrence, { createdAt: DEMANDE }), DEMANDE)).toBe('RAPPEL_PERIME')
  })
})
