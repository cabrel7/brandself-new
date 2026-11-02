import { describe, expect, it } from 'vitest'
import { resolveClientIp } from '../../server/utils/client-ip'

describe('resolveClientIp', () => {
  it('should ignore a spoofed forwarded header from a non-loopback peer', () => {
    expect(resolveClientIp('198.51.100.18', '203.0.113.42')).toBe('198.51.100.18')
  })

  it.each([
    ['127.0.0.1', '203.0.113.42'],
    ['127.0.0.1', '2001:db8::42'],
    ['::1', '203.0.113.42'],
    ['::1', '2001:db8::42'],
    ['::ffff:127.0.0.1', '203.0.113.42'],
    ['::ffff:127.0.0.1', '2001:db8::42'],
  ])('should accept the single valid forwarded IP %s -> %s', (socketIp, forwardedFor) => {
    expect(resolveClientIp(socketIp, forwardedFor)).toBe(forwardedFor)
  })

  it('should reject a comma-separated forwarded chain', () => {
    expect(resolveClientIp('127.0.0.1', '203.0.113.42, 198.51.100.18')).toBe('127.0.0.1')
  })

  it('should reject multiple forwarded header values', () => {
    expect(resolveClientIp('::ffff:127.0.0.1', ['203.0.113.42', '2001:db8::42'])).toBe('::ffff:127.0.0.1')
  })

  it('should reject an invalid forwarded value', () => {
    expect(resolveClientIp('::1', 'not-an-ip')).toBe('::1')
  })

  it('should fall back to a valid socket IP when the header is absent', () => {
    expect(resolveClientIp('2001:db8::18', undefined)).toBe('2001:db8::18')
  })

  it.each([undefined, '', 'not-an-ip'])('should return inconnue without a valid socket peer (%s)', (socketIp) => {
    expect(resolveClientIp(socketIp, '203.0.113.42')).toBe('inconnue')
  })
})
