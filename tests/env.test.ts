import { describe, expect, it } from 'vitest'
import { chargerEnv } from '../shared/env'

describe('chargerEnv (validation de la configuration)', () => {
  it('accepte une configuration complète', () => {
    const env = chargerEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    })
    expect(env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db')
    expect(env.NODE_ENV).toBe('development')
  })

  it('échoue en nommant chaque variable manquante', () => {
    expect(() => chargerEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/)
  })

  it('échoue pour une URL invalide', () => {
    expect(() =>
      chargerEnv({ DATABASE_URL: 'pas-une-url', REDIS_URL: 'redis://localhost:6379' }),
    ).toThrow(/DATABASE_URL/)
  })

  it('accepte NODE_ENV=production', () => {
    const env = chargerEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    })
    expect(env.NODE_ENV).toBe('production')
  })
})
