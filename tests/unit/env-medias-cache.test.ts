import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../shared/env'
import {
  MEDIAS_CACHE_REFRESH_ENTETE,
  MEDIAS_CACHE_REFRESH_SECRET_LONGUEUR_MIN,
  mediasCacheRefreshJobDataSchema,
} from '../../shared/medias-cache'

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
  NUXT_PUBLIC_SITE_URL: 'https://brandself.io',
  ADMIN_HOST: 'admin.brandself.io',
  // E1 (D4) : secret dédié de l'empreinte d'essai, obligatoire en production (32 caractères au moins).
  ESSAI_EMPREINTE_SECRET: 'secret-de-test-empreinte-essai-0123456789',
}

const SECRET = 'a'.repeat(MEDIAS_CACHE_REFRESH_SECRET_LONGUEUR_MIN)

function messageDe(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source)
  } catch (erreur) {
    return (erreur as Error).message
  }
  return ''
}

describe('MEDIAS_CACHE_REFRESH_SECRET (éviction du cache nginx des images)', () => {
  it('should be required in production', () => {
    expect(messageDe(production)).toContain('MEDIAS_CACHE_REFRESH_SECRET')
    expect(messageDe({ ...production, MEDIAS_CACHE_REFRESH_SECRET: '   ' })).toContain('MEDIAS_CACHE_REFRESH_SECRET')
  })

  it('should accept a long enough secret in production and trim it', () => {
    expect(loadEnv({ ...production, MEDIAS_CACHE_REFRESH_SECRET: ` ${SECRET} ` }).MEDIAS_CACHE_REFRESH_SECRET).toBe(SECRET)
  })

  it('should be optional outside production', () => {
    expect(loadEnv(valide).MEDIAS_CACHE_REFRESH_SECRET).toBeUndefined()
    expect(loadEnv({ ...valide, NODE_ENV: 'test', MEDIAS_CACHE_REFRESH_SECRET: '' }).MEDIAS_CACHE_REFRESH_SECRET).toBeUndefined()
  })

  it('should refuse a secret that is too short, even outside production, without echoing its value', () => {
    const court = 'courtSecretX'
    const message = messageDe({ ...valide, MEDIAS_CACHE_REFRESH_SECRET: court })
    expect(message).toContain('MEDIAS_CACHE_REFRESH_SECRET')
    expect(message).not.toContain(court)
  })

  it('should refuse a secret with a space or a non-ASCII character (it travels in an HTTP header)', () => {
    expect(messageDe({ ...valide, MEDIAS_CACHE_REFRESH_SECRET: `${SECRET} espace` })).toContain('MEDIAS_CACHE_REFRESH_SECRET')
    expect(messageDe({ ...valide, MEDIAS_CACHE_REFRESH_SECRET: `${SECRET}é` })).toContain('MEDIAS_CACHE_REFRESH_SECRET')
  })
})

describe('contrat du job rafraichirCacheMedias', () => {
  it('should name the header in lower case', () => {
    expect(MEDIAS_CACHE_REFRESH_ENTETE).toBe('x-cache-refresh')
  })

  it('should accept { userId } only (strict: no secret, no extra field in Redis)', () => {
    expect(mediasCacheRefreshJobDataSchema.safeParse({ userId: 'u1' }).success).toBe(true)
    expect(mediasCacheRefreshJobDataSchema.safeParse({ userId: 'u1', secret: 'x' }).success).toBe(false)
    expect(mediasCacheRefreshJobDataSchema.safeParse({}).success).toBe(false)
    expect(mediasCacheRefreshJobDataSchema.safeParse({ userId: '' }).success).toBe(false)
  })
})
