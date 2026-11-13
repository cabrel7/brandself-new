import { describe, expect, it } from 'vitest'
import { env } from '../../shared/env'
import { isoDansFuseau, lienAbsolu } from '../../server/mcp/format'

describe('isoDansFuseau', () => {
  it('should give the local ISO time with its offset in the vitrine timezone', () => {
    expect(isoDansFuseau(new Date('2026-11-04T09:00:00.000Z'), 'Africa/Douala')).toBe('2026-11-04T10:00:00+01:00')
  })

  it('should follow daylight saving time', () => {
    expect(isoDansFuseau(new Date('2026-07-01T10:00:00.000Z'), 'Europe/Paris')).toBe('2026-07-01T12:00:00+02:00')
    expect(isoDansFuseau(new Date('2026-12-01T10:00:00.000Z'), 'Europe/Paris')).toBe('2026-12-01T11:00:00+01:00')
  })

  it('should drop the milliseconds', () => {
    expect(isoDansFuseau(new Date('2026-11-04T09:00:00.789Z'), 'UTC')).toBe('2026-11-04T09:00:00+00:00')
  })
})

describe('lienAbsolu', () => {
  it('should prefix the path with the configured site URL', () => {
    expect(lienAbsolu('/studio')).toBe(`${env.NUXT_PUBLIC_SITE_URL}/studio`)
  })
})
