import { describe, expect, it } from 'vitest'
import { verdictLimiteOtp } from '../shared/limiteur'

describe('verdictLimiteOtp (garde-fou des renvois OTP)', () => {
  it('autorise le premier envoi', () => {
    expect(verdictLimiteOtp(1, 1)).toEqual({ autorise: true })
  })

  it("refuse un renvoi avant 60 s pour le même identifiant", () => {
    const verdict = verdictLimiteOtp(3, 2)
    expect(verdict.autorise).toBe(false)
    if (!verdict.autorise) {
      expect(verdict.message).toContain("Un code vient d'être envoyé")
    }
  })

  it("refuse au-delà de la limite par IP", () => {
    const verdict = verdictLimiteOtp(11, 1)
    expect(verdict.autorise).toBe(false)
    if (!verdict.autorise) {
      expect(verdict.message).toContain('Trop de tentatives')
    }
  })

  it("la limite par identifiant prime sur celle par IP", () => {
    const verdict = verdictLimiteOtp(11, 2)
    expect(verdict.autorise).toBe(false)
    if (!verdict.autorise) {
      expect(verdict.message).toContain("Un code vient d'être envoyé")
    }
  })
})
