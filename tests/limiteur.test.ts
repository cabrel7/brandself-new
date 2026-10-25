import { describe, expect, it } from 'vitest'
import { checkOtpLimit } from '../shared/limiteur'

describe('checkOtpLimit (OTP resend guard)', () => {
  it('allows the first send', () => {
    expect(checkOtpLimit(1, 1)).toEqual({ allowed: true })
  })

  it('refuses a resend within 60 s for the same identifier', () => {
    const verdict = checkOtpLimit(3, 2)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.message).toContain("Un code vient d'être envoyé")
    }
  })

  it('refuses beyond the IP limit', () => {
    const verdict = checkOtpLimit(11, 1)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.message).toContain('Trop de tentatives')
    }
  })

  it('the identifier limit takes precedence over the IP limit', () => {
    const verdict = checkOtpLimit(11, 2)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.message).toContain("Un code vient d'être envoyé")
    }
  })
})
