import { describe, expect, it } from 'vitest'
import { buildReservationIcs } from '../../server/services/agenda-ics'

// L'ICS est une piece jointe partageable : seules les donnees publiques du rendez-vous
// y entrent. Les coordonnees et le motif du visiteur ne doivent jamais fuir.

const RESERVATION_ID = '11111111-1111-4111-8111-111111111111'

type IcsInput = Parameters<typeof buildReservationIcs>[0]

const evenement: IcsInput = {
  reservationId: RESERVATION_ID,
  sequence: 2,
  method: 'REQUEST',
  generatedAt: new Date('2026-10-30T12:34:56.000Z'),
  debut: new Date('2026-11-02T08:00:00.000Z'),
  fin: new Date('2026-11-02T08:45:00.000Z'),
  serviceTitle: 'Consultation de cardiologie',
  location: 'Cabinet du Dr Cabrel, Douala',
  nom: 'PERSONNE-SECRETE',
  email: 'secret-personnel@example.com',
  telephone: '+237699999999',
  motif: 'MOTIF-MEDICAL-SECRET',
}

function lines(ics: string): string[] {
  return ics.split('\r\n').filter(Boolean)
}

function property(ics: string, name: string): string | undefined {
  return lines(ics).find((line) => line.startsWith(`${name}:`))
}

describe('buildReservationIcs', () => {
  it('should build one RFC 5545 calendar event with CRLF line endings', () => {
    const ics = buildReservationIcs(evenement)

    expect(lines(ics)).toEqual(expect.arrayContaining([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'END:VEVENT',
      'END:VCALENDAR',
    ]))
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replaceAll('\r\n', '')).not.toContain('\n')
    expect(lines(ics).filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1)
  })

  it('should expose a stable UID based on the reservation and the requested sequence', () => {
    const request = buildReservationIcs(evenement)
    const cancellation = buildReservationIcs({ ...evenement, method: 'CANCEL', sequence: 3 })
    const requestUid = property(request, 'UID')

    expect(requestUid).toBeDefined()
    expect(requestUid).toContain(RESERVATION_ID)
    expect(property(cancellation, 'UID')).toBe(requestUid)
    expect(property(request, 'SEQUENCE')).toBe('SEQUENCE:2')
    expect(property(cancellation, 'SEQUENCE')).toBe('SEQUENCE:3')
  })

  it('should write DTSTAMP, DTSTART and DTEND as UTC values only', () => {
    const ics = buildReservationIcs(evenement)

    expect(property(ics, 'DTSTAMP')).toBe('DTSTAMP:20261030T123456Z')
    expect(property(ics, 'DTSTART')).toBe('DTSTART:20261102T080000Z')
    expect(property(ics, 'DTEND')).toBe('DTEND:20261102T084500Z')
    expect(ics).not.toContain('TZID=')
    expect(lines(ics).filter((line) => /^(DTSTAMP|DTSTART|DTEND):/.test(line)).every((line) => line.endsWith('Z'))).toBe(true)
  })

  it('should put METHOD on the calendar and mark a cancellation', () => {
    const requestLines = lines(buildReservationIcs(evenement))
    const cancelled = buildReservationIcs({ ...evenement, method: 'CANCEL', sequence: 3 })

    expect(requestLines.indexOf('METHOD:REQUEST')).toBeLessThan(requestLines.indexOf('BEGIN:VEVENT'))
    expect(property(cancelled, 'METHOD')).toBe('METHOD:CANCEL')
    expect(property(cancelled, 'STATUS')).toBe('STATUS:CANCELLED')
  })

  it('should never include the visitor name, email, phone or reason', () => {
    const ics = buildReservationIcs(evenement)

    for (const secret of [evenement.nom, evenement.email, evenement.telephone, evenement.motif]) {
      expect(ics).not.toContain(secret)
    }
    expect(lines(ics).some((line) => /^(ATTENDEE|CONTACT|ORGANIZER):/i.test(line))).toBe(false)
  })

  it('should keep public service details without allowing calendar-property injection', () => {
    const injected = buildReservationIcs({
      ...evenement,
      serviceTitle: 'Consultation\r\nATTENDEE:mailto:voleur@example.com',
      location: 'Cabinet\r\nMETHOD:CANCEL',
    })

    expect(lines(injected).filter((line) => line.startsWith('ATTENDEE:'))).toEqual([])
    expect(lines(injected).filter((line) => line === 'METHOD:CANCEL')).toEqual([])
    expect(lines(injected).filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1)
  })
})
