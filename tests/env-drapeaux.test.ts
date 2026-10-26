import { describe, expect, it } from 'vitest'
import { loadDrapeauxPublics } from '../shared/env'

const valide = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}

describe('loadDrapeauxPublics', () => {
  it('échoue en dev/build si une variable manque', () => {
    expect(() => loadDrapeauxPublics({}, ['node', 'nuxt', 'build'])).toThrow(/DATABASE_URL/)
  })
  it('dérive googleActif et boiteOtpDev de la configuration validée', () => {
    expect(loadDrapeauxPublics(valide, ['dev'])).toEqual({ googleActif: false, boiteOtpDev: true })
    expect(
      loadDrapeauxPublics({ ...valide, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', NODE_ENV: 'production', RESEND_API_KEY: 're_x' }, ['build']),
    ).toEqual({ googleActif: true, boiteOtpDev: false })
  })
  it('tolère un environnement vide pour prepare et typecheck', () => {
    expect(loadDrapeauxPublics({}, ['node', 'nuxt', 'prepare'])).toEqual({ googleActif: false, boiteOtpDev: true })
    expect(() => loadDrapeauxPublics({}, ['typecheck'])).not.toThrow()
  })
})
