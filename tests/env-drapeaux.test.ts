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
    expect(loadDrapeauxPublics(valide, ['dev'])).toEqual({ googleActif: false, boiteOtpDev: true, paiementEnLigne: false })
    expect(
      loadDrapeauxPublics({ ...valide, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', NODE_ENV: 'production', RESEND_API_KEY: 're_x' }, ['build']),
    ).toEqual({ googleActif: true, boiteOtpDev: false, paiementEnLigne: false })
  })
  it('tolère un environnement vide pour prepare et typecheck', () => {
    expect(loadDrapeauxPublics({}, ['node', 'nuxt', 'prepare'])).toEqual({ googleActif: false, boiteOtpDev: true, paiementEnLigne: false })
    expect(() => loadDrapeauxPublics({}, ['typecheck'])).not.toThrow()
  })
})

describe('loadDrapeauxPublics : paiementEnLigne (PAIEMENT_EN_LIGNE, S3)', () => {
  it('est faux par défaut quand la variable est absente', () => {
    expect(loadDrapeauxPublics(valide, ['dev']).paiementEnLigne).toBe(false)
  })

  it.each([['true'], ['1'], ['yes'], ['on']])('devient vrai avec PAIEMENT_EN_LIGNE=%s', (valeur) => {
    expect(loadDrapeauxPublics({ ...valide, PAIEMENT_EN_LIGNE: valeur }, ['dev']).paiementEnLigne).toBe(true)
  })

  it.each([['false'], ['0'], ['no'], ['off']])('reste faux avec PAIEMENT_EN_LIGNE=%s', (valeur) => {
    expect(loadDrapeauxPublics({ ...valide, PAIEMENT_EN_LIGNE: valeur }, ['dev']).paiementEnLigne).toBe(false)
  })

  it('échoue en dev/build avec un message qui nomme PAIEMENT_EN_LIGNE quand la valeur est invalide', () => {
    expect(() => loadDrapeauxPublics({ ...valide, PAIEMENT_EN_LIGNE: 'peut-etre' }, ['build'])).toThrow(/PAIEMENT_EN_LIGNE/)
  })

  it('lit aussi la variable pour prepare et typecheck, et retombe sur faux (sûr) si elle est invalide', () => {
    expect(loadDrapeauxPublics({ PAIEMENT_EN_LIGNE: 'true' }, ['node', 'nuxt', 'prepare']).paiementEnLigne).toBe(true)
    expect(loadDrapeauxPublics({ PAIEMENT_EN_LIGNE: 'peut-etre' }, ['typecheck']).paiementEnLigne).toBe(false)
    expect(loadDrapeauxPublics({}, ['typecheck']).paiementEnLigne).toBe(false)
  })

  it('ne dépend pas des autres drapeaux (Google, boîte OTP)', () => {
    const drapeaux = loadDrapeauxPublics({ ...valide, PAIEMENT_EN_LIGNE: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }, ['dev'])

    expect(drapeaux).toEqual({ googleActif: true, boiteOtpDev: true, paiementEnLigne: true })
  })
})
