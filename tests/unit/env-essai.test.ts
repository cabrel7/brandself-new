import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../shared/env'

// E1 (docs/specs/E1-essai-gratuit.md D4) : ESSAI_EMPREINTE_SECRET, secret DÉDIÉ de l'empreinte « un essai par personne ».
// Indépendant du secret d'authentification (qui peut être tourné sans rouvrir les essais). Obligatoire en production,
// 32 caractères au moins ; hors production, repli dérivé (HKDF, label distinct) de NUXT_BETTER_AUTH_SECRET.

const AUTH_A = 'secret-auth-a-de-test-au-moins-trente-deux-caracteres'
const AUTH_B = 'secret-auth-b-de-test-au-moins-trente-deux-caracteres'
const SECRET_ESSAI = 'secret-dedie-essai-de-test-0123456789-abcdef'

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: AUTH_A,
}

const PRODUCTION = {
  ...BASE,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_x',
  EMAIL_EXPEDITEUR: 'Brandself <bonjour@brandself.io>',
  NUXT_PUBLIC_SITE_URL: 'https://brandself.io',
  ADMIN_HOST: 'admin.brandself.io',
  MEDIAS_CACHE_REFRESH_SECRET: 'secret-de-test-cache-images-0123456789',
  ESSAI_EMPREINTE_SECRET: SECRET_ESSAI,
}

function messageDe(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source)
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
  return ''
}

describe('ESSAI_EMPREINTE_SECRET en production (D4)', () => {
  it('should be REQUIRED: a production boot without it fails and names the variable', () => {
    const message = messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: undefined })

    expect(message).toContain('ESSAI_EMPREINTE_SECRET')
  })

  it('should treat an empty or blank value as absent: still refused in production, never silently derived', () => {
    expect(messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: '' })).toContain('ESSAI_EMPREINTE_SECRET')
    expect(messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: '    ' })).toContain('ESSAI_EMPREINTE_SECRET')
  })

  it('should accept 32 characters exactly and refuse 31 (minimum length)', () => {
    expect(() => loadEnv({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: 'a'.repeat(32) })).not.toThrow()
    expect(messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: 'a'.repeat(31) })).toContain('ESSAI_EMPREINTE_SECRET')
  })

  it('should keep the dedicated value as is (rognée), never the derived one, and never the authentication secret', () => {
    const env = loadEnv({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: ` ${SECRET_ESSAI} ` })

    expect(env.ESSAI_EMPREINTE_SECRET).toBe(SECRET_ESSAI)
    expect(env.ESSAI_EMPREINTE_SECRET).not.toBe(AUTH_A)
  })

  it('should not depend on the authentication secret: rotating the latter leaves the trial fingerprint key untouched', () => {
    const avant = loadEnv(PRODUCTION).ESSAI_EMPREINTE_SECRET
    const apres = loadEnv({ ...PRODUCTION, NUXT_BETTER_AUTH_SECRET: AUTH_B }).ESSAI_EMPREINTE_SECRET

    expect(apres).toBe(avant)
  })

  it('should never repeat the value in an error message (a too short secret must not leak into the logs)', () => {
    const court = 'secret-court-12'

    const message = messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: court })

    expect(message).toContain('ESSAI_EMPREINTE_SECRET')
    expect(message).not.toContain(court)
  })
})

describe('ESSAI_EMPREINTE_SECRET hors production (repli dérivé)', () => {
  it.each(['development', 'test', undefined])('should derive a usable secret of 64 hexadecimal characters when absent (NODE_ENV=%s)', (nodeEnv) => {
    const env = loadEnv({ ...BASE, ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }) })

    expect(env.ESSAI_EMPREINTE_SECRET).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should be stable for one authentication secret (the same account keeps the same fingerprint across restarts)', () => {
    expect(loadEnv(BASE).ESSAI_EMPREINTE_SECRET).toBe(loadEnv({ ...BASE }).ESSAI_EMPREINTE_SECRET)
  })

  it('should differ for two authentication secrets, and from the authentication secret itself (distinct HKDF label)', () => {
    const a = loadEnv(BASE).ESSAI_EMPREINTE_SECRET
    const b = loadEnv({ ...BASE, NUXT_BETTER_AUTH_SECRET: AUTH_B }).ESSAI_EMPREINTE_SECRET

    expect(a).not.toBe(b)
    expect(a).not.toContain(AUTH_A)
    expect(a).not.toBe(AUTH_A)
  })

  it('should take the dedicated value when it is given, even outside production', () => {
    expect(loadEnv({ ...BASE, ESSAI_EMPREINTE_SECRET: SECRET_ESSAI }).ESSAI_EMPREINTE_SECRET).toBe(SECRET_ESSAI)
  })

  it('should still refuse a dedicated value that is too short outside production (a typo must not silently weaken the key)', () => {
    expect(messageDe({ ...BASE, ESSAI_EMPREINTE_SECRET: 'trop-court' })).toContain('ESSAI_EMPREINTE_SECRET')
  })

  it('should treat an empty value as absent (a copied .env.example boots)', () => {
    expect(loadEnv({ ...BASE, ESSAI_EMPREINTE_SECRET: '' }).ESSAI_EMPREINTE_SECRET).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('ESSAI_EMPREINTE_SECRET distinct du secret d\'authentification', () => {
  it('should REFUSE in production a dedicated secret identical to NUXT_BETTER_AUTH_SECRET, and never repeat the value', () => {
    const message = messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: AUTH_A })

    expect(message).toContain('ESSAI_EMPREINTE_SECRET')
    expect(message).toContain('NUXT_BETTER_AUTH_SECRET')
    expect(message).not.toContain(AUTH_A)
  })

  it('should refuse it even when the copy only differs by surrounding spaces (the value is trimmed first)', () => {
    expect(messageDe({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: ` ${AUTH_A} ` })).toContain('NUXT_BETTER_AUTH_SECRET')
  })

  it('should accept a different dedicated secret in production', () => {
    expect(() => loadEnv({ ...PRODUCTION, ESSAI_EMPREINTE_SECRET: SECRET_ESSAI })).not.toThrow()
  })

  it.each(['development', 'test'])('should not apply outside production (NODE_ENV=%s): the same value stays accepted there', (nodeEnv) => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: nodeEnv, ESSAI_EMPREINTE_SECRET: AUTH_A })).not.toThrow()
  })
})
