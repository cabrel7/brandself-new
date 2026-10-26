import { describe, expect, it } from 'vitest'
import { isValidTimeZone } from '../../shared/fuseau'

// U7 — isValidTimeZone

describe('isValidTimeZone (U7)', () => {
  it.each(['Africa/Douala', 'Europe/Paris', 'America/Montreal', 'UTC', 'Africa/Lagos'])('should accept %s', (fuseau) => {
    expect(isValidTimeZone(fuseau)).toBe(true)
  })

  it.each([
    ['Mars/Olympus'],
    [''],
    [' '],
    ['Africa/Douala '],
    ['Douala'],
    ['Africa/'],
    ['../../etc/passwd'],
    ['x'.repeat(500)],
    ['<script>alert(1)</script>'],
  ])('should refuse %j', (fuseau) => {
    expect(isValidTimeZone(fuseau)).toBe(false)
  })

  it('should never throw, whatever the input', () => {
    expect(() => isValidTimeZone('\u0000')).not.toThrow()
    expect(() => isValidTimeZone('Africa/Douala\nEurope/Paris')).not.toThrow()
  })
})
