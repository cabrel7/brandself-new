export type IcsMethod = 'REQUEST' | 'CANCEL'

export interface ReservationIcsInput {
  reservationId: string
  sequence: number
  method: IcsMethod
  generatedAt: Date
  debut: Date
  fin: Date
  serviceTitle: string
  location: string
  // Acceptés uniquement par les tests de non-régression : ces champs sont volontairement ignorés.
  nom?: string
  email?: string
  telephone?: string
  motif?: string
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
}

function foldLine(line: string): string {
  const chunks: string[] = []
  let current = ''
  let maxBytes = 75
  for (const character of line) {
    if (current !== '' && Buffer.byteLength(current + character, 'utf8') > maxBytes) {
      chunks.push(current)
      current = character
      maxBytes = 74 // La ligne physique suivante commence par une espace de continuation.
    }
    else {
      current += character
    }
  }
  chunks.push(current)
  return chunks.join('\r\n ')
}

export function buildReservationIcs(input: ReservationIcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Brandself//Agenda//FR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.reservationId}@brandself`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${formatUtc(input.generatedAt)}`,
    `DTSTART:${formatUtc(input.debut)}`,
    `DTEND:${formatUtc(input.fin)}`,
    `SUMMARY:${escapeText(input.serviceTitle)}`,
    `LOCATION:${escapeText(input.location)}`,
  ]
  if (input.method === 'CANCEL') lines.push('STATUS:CANCELLED')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}
