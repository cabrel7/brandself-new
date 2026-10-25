import { describe, expect, it } from 'vitest'
import { chargerEnv } from '../shared/env'

describe('chargerEnv (validation de la configuration)', () => {
  const base = {
    NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
    REDIS_URL: 'redis://localhost:6379',
  }

  it('accepte une configuration complète', () => {
    const env = chargerEnv({
      ...base,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    })
    expect(env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db')
    expect(env.NODE_ENV).toBe('development')
  })

  it('échoue en nommant chaque variable manquante', () => {
    expect(() => chargerEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/)
  })

  it('échoue pour une URL invalide', () => {
    expect(() =>
      chargerEnv({ ...base, DATABASE_URL: 'pas-une-url' }),
    ).toThrow(/DATABASE_URL/)
  })

  it('accepte NODE_ENV=production', () => {
    const env = chargerEnv({
      ...base,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      RESEND_API_KEY: 're_x',
    })
    expect(env.NODE_ENV).toBe('production')
  })

  it('refuse un secret trop court', () => {
    expect(() =>
      chargerEnv({ ...base, NUXT_BETTER_AUTH_SECRET: 'court', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }),
    ).toThrow(/NUXT_BETTER_AUTH_SECRET/)
  })
})
