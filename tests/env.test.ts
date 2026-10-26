import { describe, expect, it } from 'vitest'
import { loadEnv } from '../shared/env'

describe('loadEnv (configuration validation)', () => {
  const base = {
    NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
    REDIS_URL: 'redis://localhost:6379',
  }

  it('accepts a complete configuration', () => {
    const env = loadEnv({
      ...base,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    })
    expect(env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db')
    expect(env.NODE_ENV).toBe('development')
  })

  it('fails naming each missing variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/)
  })

  it('fails for an invalid URL', () => {
    expect(() =>
      loadEnv({ ...base, DATABASE_URL: 'pas-une-url' }),
    ).toThrow(/DATABASE_URL/)
  })

  it('accepts NODE_ENV=production', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      RESEND_API_KEY: 're_x',
    })
    expect(env.NODE_ENV).toBe('production')
  })

  it('refuses a secret that is too short', () => {
    expect(() =>
      loadEnv({ ...base, NUXT_BETTER_AUTH_SECRET: 'court', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }),
    ).toThrow(/NUXT_BETTER_AUTH_SECRET/)
  })

  describe('PAIEMENT_EN_LIGNE (S3)', () => {
    const complet = { ...base, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }

    it('vaut false par défaut', () => {
      expect(loadEnv(complet).PAIEMENT_EN_LIGNE).toBe(false)
    })

    it("vaut true avec 'true' et false avec 'false'", () => {
      expect(loadEnv({ ...complet, PAIEMENT_EN_LIGNE: 'true' }).PAIEMENT_EN_LIGNE).toBe(true)
      expect(loadEnv({ ...complet, PAIEMENT_EN_LIGNE: 'false' }).PAIEMENT_EN_LIGNE).toBe(false)
    })

    it.each([['peut-etre'], ['2']])('échoue en nommant la variable pour la valeur invalide %j', (valeur) => {
      expect(() => loadEnv({ ...complet, PAIEMENT_EN_LIGNE: valeur })).toThrow(/PAIEMENT_EN_LIGNE/)
    })
  })
})
