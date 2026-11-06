import { describe, expect, it } from 'vitest'
import { loadEnv, loadSiteConfig } from '../../shared/env'
import { SITE_URL_DEV_DEFAUT } from '../../shared/notifications'

const valide = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}

const production = {
  ...valide,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_x',
  EMAIL_EXPEDITEUR: 'Brandself <bonjour@brandself.io>',
  NUXT_PUBLIC_SITE_URL: 'https://brandself.io/',
}

describe('NUXT_PUBLIC_SITE_ENV (S12 #137)', () => {
  it.each(['production', 'staging', 'development'])('accepte %s', (valeur) => {
    expect(loadEnv({ ...valide, NUXT_PUBLIC_SITE_ENV: valeur }).NUXT_PUBLIC_SITE_ENV).toBe(valeur)
  })

  it('est facultative : absente, vide ou espaces = non définie', () => {
    expect(loadEnv(valide).NUXT_PUBLIC_SITE_ENV).toBeUndefined()
    expect(loadEnv({ ...valide, NUXT_PUBLIC_SITE_ENV: '' }).NUXT_PUBLIC_SITE_ENV).toBeUndefined()
    expect(loadEnv({ ...valide, NUXT_PUBLIC_SITE_ENV: '  ' }).NUXT_PUBLIC_SITE_ENV).toBeUndefined()
  })

  it('refuse une valeur inconnue en nommant la variable', () => {
    expect(() => loadEnv({ ...valide, NUXT_PUBLIC_SITE_ENV: 'prod' })).toThrow(/NUXT_PUBLIC_SITE_ENV/)
  })

  it('n\'est jamais obligatoire en production', () => {
    expect(() => loadEnv(production)).not.toThrow()
  })
})

describe('loadSiteConfig (S12 #137)', () => {
  it('dérive url (sans barre finale) et env de la configuration validée', () => {
    expect(loadSiteConfig({ ...production, NUXT_PUBLIC_SITE_ENV: 'staging' }, ['build'])).toEqual({
      url: 'https://brandself.io',
      env: 'staging',
    })
  })

  it('hors production : URL locale par défaut, env non définie', () => {
    expect(loadSiteConfig(valide, ['dev'])).toEqual({ url: SITE_URL_DEV_DEFAUT, env: undefined })
  })

  it('échoue en dev/build si la configuration est invalide', () => {
    expect(() => loadSiteConfig({}, ['build'])).toThrow(/DATABASE_URL/)
    expect(() => loadSiteConfig({ ...valide, NUXT_PUBLIC_SITE_ENV: 'x' }, ['dev'])).toThrow(/NUXT_PUBLIC_SITE_ENV/)
  })

  it('tolère un environnement vide pour prepare et typecheck', () => {
    expect(loadSiteConfig({}, ['node', 'nuxt', 'prepare'])).toEqual({ url: SITE_URL_DEV_DEFAUT, env: undefined })
    expect(() => loadSiteConfig({}, ['typecheck'])).not.toThrow()
  })

  it('prepare/typecheck ignorent une valeur invalide au lieu de lever', () => {
    expect(
      loadSiteConfig({ NUXT_PUBLIC_SITE_URL: 'pas-une-url', NUXT_PUBLIC_SITE_ENV: 'x' }, ['prepare']),
    ).toEqual({ url: SITE_URL_DEV_DEFAUT, env: undefined })
    expect(
      loadSiteConfig({ NUXT_PUBLIC_SITE_URL: 'https://brandself.io/', NUXT_PUBLIC_SITE_ENV: 'staging' }, ['typecheck']),
    ).toEqual({ url: 'https://brandself.io', env: 'staging' })
  })
})
