import { describe, expect, it } from 'vitest'
import { kpayConfigure, loadEnv, resolveKpayEnvironnement } from '../../shared/env'
import { KPAY_BASE_URL_DEFAUT, KPAY_WEBHOOK_SECRET_LONGUEUR_MIN } from '../../shared/paiements'

// S10 #118 / CA14 : variables K-PAY. Aucun message d'erreur ne répète une valeur (clés, secret, URL).

const BASE = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}
const BASE_PRODUCTION = {
  ...BASE,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_test_cle_resend',
  EMAIL_EXPEDITEUR: 'Brandself <bonjour@brandself.io>',
  NUXT_PUBLIC_SITE_URL: 'https://brandself.io',
}
const CLE_TEST = 'kpay_test_AbCdEf0123456789_-xyz'
const CLE_LIVE = 'kpay_live_AbCdEf0123456789_-xyz'
const SECRET = 'a1b2c3d4'.repeat(8)
const WEBHOOK = 'secret-webhook-assez-long'

function messageDe(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source)
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
  return ''
}

describe('loadEnv : K-PAY absent ou complet', () => {
  it('should boot without any K-PAY variable and use the default HTTPS address', () => {
    const env = loadEnv(BASE)

    expect(env.KPAY_API_KEY).toBeUndefined()
    expect(env.KPAY_SECRET_KEY).toBeUndefined()
    expect(env.KPAY_WEBHOOK_SECRET).toBeUndefined()
    expect(env.KPAY_MODE_TEST_AUTORISE).toBe(false)
    expect(env.KPAY_BASE_URL).toBe(KPAY_BASE_URL_DEFAUT)
    expect(kpayConfigure(env)).toBe(false)
  })

  it('should boot in production without any K-PAY variable (payment simply not offered)', () => {
    expect(() => loadEnv(BASE_PRODUCTION)).not.toThrow()
  })

  it('should treat empty or blank K-PAY variables as absent (copied .env.example)', () => {
    const env = loadEnv({
      ...BASE,
      KPAY_API_KEY: '',
      KPAY_SECRET_KEY: '   ',
      KPAY_WEBHOOK_SECRET: '',
      KPAY_BASE_URL: '',
      KPAY_MODE_TEST_AUTORISE: '',
    })

    expect(kpayConfigure(env)).toBe(false)
    expect(env.KPAY_BASE_URL).toBe(KPAY_BASE_URL_DEFAUT)
    expect(env.KPAY_MODE_TEST_AUTORISE).toBe(false)
  })

  it('should accept a test key pair with a webhook secret in development', () => {
    const env = loadEnv({ ...BASE, KPAY_API_KEY: CLE_TEST, KPAY_SECRET_KEY: SECRET, KPAY_WEBHOOK_SECRET: WEBHOOK })

    expect(kpayConfigure(env)).toBe(true)
    expect(resolveKpayEnvironnement(env.KPAY_API_KEY ?? '')).toBe('test')
  })

  it('should trim padded keys and drop trailing slashes from the base URL', () => {
    const env = loadEnv({ ...BASE, KPAY_API_KEY: `  ${CLE_TEST} `, KPAY_SECRET_KEY: SECRET, KPAY_BASE_URL: 'https://admin.kpay.site///' })

    expect(env.KPAY_API_KEY).toBe(CLE_TEST)
    expect(env.KPAY_BASE_URL).toBe('https://admin.kpay.site')
  })
})

describe('resolveKpayEnvironnement', () => {
  it('should deduce the environment from the key prefix', () => {
    expect(resolveKpayEnvironnement(CLE_TEST)).toBe('test')
    expect(resolveKpayEnvironnement(CLE_LIVE)).toBe('live')
  })
})

describe('loadEnv : formats et appariement (CA14)', () => {
  it.each(['pas-une-cle', 'kpay_prod_abc', 'kpay_test_', 'kpay_test_avec espace', 'KPAY_TEST_abc'])(
    'should refuse the API key %j without echoing it',
    (cle) => {
      const message = messageDe({ ...BASE, KPAY_API_KEY: cle, KPAY_SECRET_KEY: SECRET })

      expect(message).toMatch(/KPAY_API_KEY/)
      expect(message).not.toContain(cle)
    },
  )

  it.each(['abc', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])('should refuse the secret key %j without echoing it', (secret) => {
    const message = messageDe({ ...BASE, KPAY_API_KEY: CLE_TEST, KPAY_SECRET_KEY: secret })

    expect(message).toMatch(/KPAY_SECRET_KEY/)
    expect(message).not.toContain(secret)
  })

  it('should refuse an API key without its secret key, and the reverse', () => {
    expect(messageDe({ ...BASE, KPAY_API_KEY: CLE_TEST })).toMatch(/KPAY_SECRET_KEY/)
    expect(messageDe({ ...BASE, KPAY_SECRET_KEY: SECRET })).toMatch(/KPAY_API_KEY/)
    expect(messageDe({ ...BASE, KPAY_API_KEY: CLE_TEST })).not.toContain(CLE_TEST)
  })

  it('should refuse a webhook secret shorter than the minimum, and accept exactly the minimum', () => {
    const court = 'x'.repeat(KPAY_WEBHOOK_SECRET_LONGUEUR_MIN - 1)

    expect(messageDe({ ...BASE, KPAY_WEBHOOK_SECRET: court })).toMatch(/KPAY_WEBHOOK_SECRET/)
    expect(messageDe({ ...BASE, KPAY_WEBHOOK_SECRET: court })).not.toContain(court)
    expect(loadEnv({ ...BASE, KPAY_WEBHOOK_SECRET: 'x'.repeat(KPAY_WEBHOOK_SECRET_LONGUEUR_MIN) }).KPAY_WEBHOOK_SECRET).toHaveLength(KPAY_WEBHOOK_SECRET_LONGUEUR_MIN)
  })

  it('should accept a boolean for KPAY_MODE_TEST_AUTORISE and refuse garbage', () => {
    expect(loadEnv({ ...BASE, KPAY_MODE_TEST_AUTORISE: 'true' }).KPAY_MODE_TEST_AUTORISE).toBe(true)
    expect(loadEnv({ ...BASE, KPAY_MODE_TEST_AUTORISE: 'false' }).KPAY_MODE_TEST_AUTORISE).toBe(false)
    expect(() => loadEnv({ ...BASE, KPAY_MODE_TEST_AUTORISE: 'peut-etre' })).toThrow(/KPAY_MODE_TEST_AUTORISE/)
  })
})

describe('loadEnv : règles de production (#118, CA14)', () => {
  const PRODUCTION_LIVE = { ...BASE_PRODUCTION, KPAY_API_KEY: CLE_LIVE, KPAY_SECRET_KEY: SECRET, KPAY_WEBHOOK_SECRET: WEBHOOK }

  it('should accept live keys with a webhook secret in production', () => {
    const env = loadEnv(PRODUCTION_LIVE)

    expect(kpayConfigure(env)).toBe(true)
    expect(resolveKpayEnvironnement(env.KPAY_API_KEY ?? '')).toBe('live')
  })

  it('should refuse a test key in production, naming the variable but not the value', () => {
    const message = messageDe({ ...PRODUCTION_LIVE, KPAY_API_KEY: CLE_TEST })

    expect(message).toMatch(/KPAY_API_KEY/)
    expect(message).not.toContain(CLE_TEST)
  })

  it('should accept a test key in production only with KPAY_MODE_TEST_AUTORISE=true', () => {
    expect(() => loadEnv({ ...PRODUCTION_LIVE, KPAY_API_KEY: CLE_TEST, KPAY_MODE_TEST_AUTORISE: 'true' })).not.toThrow()
  })

  it('should refuse the keys without the webhook secret in production', () => {
    const message = messageDe({ ...PRODUCTION_LIVE, KPAY_WEBHOOK_SECRET: undefined })

    expect(message).toMatch(/KPAY_WEBHOOK_SECRET/)
    expect(message).not.toContain(SECRET)
  })

  it('should not require the webhook secret in development', () => {
    expect(() => loadEnv({ ...BASE, KPAY_API_KEY: CLE_TEST, KPAY_SECRET_KEY: SECRET })).not.toThrow()
  })

  it('should refuse an http base URL in production, even towards localhost', () => {
    expect(() => loadEnv({ ...PRODUCTION_LIVE, KPAY_BASE_URL: 'http://127.0.0.1:4010' })).toThrow(/KPAY_BASE_URL/)
    expect(() => loadEnv({ ...PRODUCTION_LIVE, KPAY_BASE_URL: 'https://admin.kpay.site' })).not.toThrow()
  })
})

describe('loadEnv : KPAY_BASE_URL', () => {
  it.each(['http://127.0.0.1:4010', 'http://localhost:4010', 'https://admin.kpay.site'])('should accept %s outside production', (url) => {
    expect(loadEnv({ ...BASE, KPAY_BASE_URL: url }).KPAY_BASE_URL).toBe(url)
  })

  it.each([
    'http://evil.com',
    'http://localhost.evil.com',
    'http://192.168.1.10:4010',
    'file:///etc/passwd',
    'https://utilisateur:secret-tres-confidentiel@admin.kpay.site',
    'pas une url',
  ])('should refuse %s without echoing it', (url) => {
    const message = messageDe({ ...BASE, KPAY_BASE_URL: url })

    expect(message).toMatch(/KPAY_BASE_URL/)
    expect(message).not.toContain(url)
    expect(message).not.toContain('secret-tres-confidentiel')
  })
})
