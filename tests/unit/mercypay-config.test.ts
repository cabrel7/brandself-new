import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertConfigPaiements, ConfigPaiementsError, FRAIS_PAIEMENT, getFraisPaiement, getMoyenPaiement, MOYENS_PAIEMENT } from '../../server/config/paiements'
import { PRIX_PLANS } from '../../server/config/plans'
import { loadEnv } from '../../shared/env'
import { MERCY_PAY_BASE_URL_DEFAUT } from '../../shared/paiements'

// P1 CA-M17 (+ spec §4.3 et §4.4) : variables d'environnement Mercy Pay validées au démarrage, règles croisées de production,
// contrôle des prix à valider, frais et moyens du catalogue de configuration. Aucun message d'erreur ne répète une valeur secrète.

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
  ADMIN_HOST: 'admin.brandself.io',
  MEDIAS_CACHE_REFRESH_SECRET: 'secret-de-test-cache-images-0123456789',
}
const CLE_SANDBOX = 'mp_sandbox_AbCdEf0123456789_-xyz'
const CLE_LIVE = 'mp_live_AbCdEf0123456789_-xyz'
const WEBHOOK = `whsec_${'a1B2c3D4'.repeat(5)}`

function messageDe(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source)
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
  return ''
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadEnv : Mercy Pay absent ou complet', () => {
  it('should boot without any Mercy Pay variable and use the default HTTPS address', () => {
    const env = loadEnv(BASE)

    expect(env.MERCY_PAY_API_KEY).toBeUndefined()
    expect(env.MERCY_PAY_WEBHOOK_SECRET).toBeUndefined()
    expect(env.MERCY_PAY_MODE_TEST_AUTORISE).toBe(false)
    expect(env.MERCY_PAY_BASE_URL).toBe(MERCY_PAY_BASE_URL_DEFAUT)
    expect(MERCY_PAY_BASE_URL_DEFAUT).toBe('https://mercy-pay.com/api/v1')
  })

  it('should boot in production without any Mercy Pay variable (payment simply not offered by this provider)', () => {
    expect(() => loadEnv(BASE_PRODUCTION)).not.toThrow()
  })

  it('should treat empty or blank variables as absent (copied .env.example)', () => {
    const env = loadEnv({ ...BASE, MERCY_PAY_API_KEY: '', MERCY_PAY_WEBHOOK_SECRET: '   ', MERCY_PAY_BASE_URL: '', MERCY_PAY_MODE_TEST_AUTORISE: '' })

    expect(env.MERCY_PAY_API_KEY).toBeUndefined()
    expect(env.MERCY_PAY_WEBHOOK_SECRET).toBeUndefined()
    expect(env.MERCY_PAY_BASE_URL).toBe(MERCY_PAY_BASE_URL_DEFAUT)
    expect(env.MERCY_PAY_MODE_TEST_AUTORISE).toBe(false)
  })

  it('should accept a sandbox key WITHOUT webhook secret outside production (the app is not hosted yet: polling takes over)', () => {
    const env = loadEnv({ ...BASE, MERCY_PAY_API_KEY: CLE_SANDBOX })

    expect(env.MERCY_PAY_API_KEY).toBe(CLE_SANDBOX)
    expect(env.MERCY_PAY_WEBHOOK_SECRET).toBeUndefined()
  })

  it('should trim padded values and drop trailing slashes from the base URL', () => {
    const env = loadEnv({ ...BASE, MERCY_PAY_API_KEY: `  ${CLE_SANDBOX} `, MERCY_PAY_BASE_URL: 'https://mercy-pay.com/api/v1///' })

    expect(env.MERCY_PAY_API_KEY).toBe(CLE_SANDBOX)
    expect(env.MERCY_PAY_BASE_URL).toBe('https://mercy-pay.com/api/v1')
  })
})

describe('loadEnv : formats (CA-M17)', () => {
  it.each(['pas-une-cle', 'mp_prod_abc', 'mp_sandbox_', 'mp_live_', 'mp_sandbox_avec espace', 'MP_SANDBOX_abc', 'kpay_test_abc'])(
    'should refuse the API key %j, naming the variable but never echoing the value',
    (cle) => {
      const message = messageDe({ ...BASE, MERCY_PAY_API_KEY: cle })

      expect(message).toMatch(/MERCY_PAY_API_KEY/)
      expect(message).not.toContain(cle)
    },
  )

  it.each(['abc', 'sans-prefixe-mais-assez-long-0123456789', 'whsec_', 'WHSEC_abcdefghijklmnopqrstuvwxyz0123456789'])(
    'should refuse the webhook secret %j without echoing it',
    (secret) => {
      const message = messageDe({ ...BASE, MERCY_PAY_API_KEY: CLE_SANDBOX, MERCY_PAY_WEBHOOK_SECRET: secret })

      expect(message).toMatch(/MERCY_PAY_WEBHOOK_SECRET/)
      expect(message).not.toContain(secret)
    },
  )

  it('should accept a boolean for MERCY_PAY_MODE_TEST_AUTORISE and refuse garbage', () => {
    expect(loadEnv({ ...BASE, MERCY_PAY_MODE_TEST_AUTORISE: 'true' }).MERCY_PAY_MODE_TEST_AUTORISE).toBe(true)
    expect(loadEnv({ ...BASE, MERCY_PAY_MODE_TEST_AUTORISE: 'false' }).MERCY_PAY_MODE_TEST_AUTORISE).toBe(false)
    expect(() => loadEnv({ ...BASE, MERCY_PAY_MODE_TEST_AUTORISE: 'peut-etre' })).toThrow(/MERCY_PAY_MODE_TEST_AUTORISE/)
  })

  it.each(['http://evil.com', 'http://192.168.1.10:4010', 'file:///etc/passwd', 'https://utilisateur:motdepasse-tres-confidentiel@mercy-pay.com/api/v1', 'pas une url'])(
    'should refuse the base URL %s without echoing it',
    (url) => {
      const message = messageDe({ ...BASE, MERCY_PAY_BASE_URL: url })

      expect(message).toMatch(/MERCY_PAY_BASE_URL/)
      expect(message).not.toContain(url)
      expect(message).not.toContain('motdepasse-tres-confidentiel')
    },
  )

  it.each(['http://127.0.0.1:4010/api/v1', 'http://localhost:4010/api/v1'])('should accept %s outside production (local fake server)', (url) => {
    expect(loadEnv({ ...BASE, MERCY_PAY_BASE_URL: url }).MERCY_PAY_BASE_URL).toBe(url)
  })
})

describe('loadEnv : règles croisées de production (CA-M17)', () => {
  const PRODUCTION_LIVE = { ...BASE_PRODUCTION, MERCY_PAY_API_KEY: CLE_LIVE, MERCY_PAY_WEBHOOK_SECRET: WEBHOOK }

  it('should accept a live key with a webhook secret in production', () => {
    expect(() => loadEnv(PRODUCTION_LIVE)).not.toThrow()
  })

  it('should REFUSE a mp_sandbox_ key in production without the flag, with a message that never contains the key', () => {
    const message = messageDe({ ...PRODUCTION_LIVE, MERCY_PAY_API_KEY: CLE_SANDBOX })

    expect(message).toMatch(/MERCY_PAY_API_KEY/)
    expect(message).not.toContain(CLE_SANDBOX)
    expect(message).not.toContain(WEBHOOK)
  })

  it('should accept a sandbox key in production only with MERCY_PAY_MODE_TEST_AUTORISE=true (pre-production)', () => {
    expect(() => loadEnv({ ...PRODUCTION_LIVE, MERCY_PAY_API_KEY: CLE_SANDBOX, MERCY_PAY_MODE_TEST_AUTORISE: 'true' })).not.toThrow()
  })

  it('should REFUSE a key without webhook secret in production, naming MERCY_PAY_WEBHOOK_SECRET but not the key', () => {
    const message = messageDe({ ...BASE_PRODUCTION, MERCY_PAY_API_KEY: CLE_LIVE })

    expect(message).toMatch(/MERCY_PAY_WEBHOOK_SECRET/)
    expect(message).not.toContain(CLE_LIVE)
  })

  it('should refuse a sandbox key without webhook secret in production even with the flag (no unsigned flow)', () => {
    const message = messageDe({ ...BASE_PRODUCTION, MERCY_PAY_API_KEY: CLE_SANDBOX, MERCY_PAY_MODE_TEST_AUTORISE: 'true' })

    expect(message).toMatch(/MERCY_PAY_WEBHOOK_SECRET/)
  })

  it('should refuse an http base URL in production, even towards localhost', () => {
    expect(() => loadEnv({ ...PRODUCTION_LIVE, MERCY_PAY_BASE_URL: 'http://127.0.0.1:4010/api/v1' })).toThrow(/MERCY_PAY_BASE_URL/)
    expect(() => loadEnv({ ...PRODUCTION_LIVE, MERCY_PAY_BASE_URL: 'https://mercy-pay.com/api/v1' })).not.toThrow()
  })

  it('should not make a dormant K-PAY block Mercy Pay (K-PAY keys absent is the normal state, D7)', () => {
    expect(() => loadEnv(PRODUCTION_LIVE)).not.toThrow()
  })
})

describe('assertConfigPaiements : grille de prix à valider (CA-M17)', () => {
  const configAValider = { moyens: MOYENS_PAIEMENT, frais: FRAIS_PAIEMENT, prix: PRIX_PLANS.payant, prixStatut: 'a_valider' as const }
  const PRODUCTION = { NODE_ENV: 'production' as const }

  it('should throw ConfigPaiementsError for a mp_live_ key while the price grid is "a_valider", without the key in the message', () => {
    let erreur: unknown
    try {
      assertConfigPaiements({ ...PRODUCTION, MERCY_PAY_API_KEY: CLE_LIVE }, configAValider)
    } catch (e) {
      erreur = e
    }

    expect(erreur).toBeInstanceOf(ConfigPaiementsError)
    expect((erreur as Error).message).toMatch(/PRIX_STATUT/)
    expect((erreur as Error).message).not.toContain(CLE_LIVE)
  })

  it('should only warn (the server starts, payment stays locked) for a sandbox key with an unvalidated grid in production', () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => assertConfigPaiements({ ...PRODUCTION, MERCY_PAY_API_KEY: CLE_SANDBOX }, configAValider)).not.toThrow()
    expect(avertissement).toHaveBeenCalled()
  })

  it('should keep refusing live K-PAY keys with an unvalidated grid (the control covers EVERY provider)', () => {
    expect(() => assertConfigPaiements({ ...PRODUCTION, KPAY_API_KEY: 'kpay_live_abc' }, configAValider)).toThrow(ConfigPaiementsError)
  })

  it('should not throw with a live key once the grid is validated', () => {
    expect(() => assertConfigPaiements({ ...PRODUCTION, MERCY_PAY_API_KEY: CLE_LIVE }, { ...configAValider, prixStatut: 'valide' })).not.toThrow()
  })

  it('should not throw in development whatever the grid status', () => {
    expect(() => assertConfigPaiements({ NODE_ENV: 'development', MERCY_PAY_API_KEY: CLE_LIVE }, configAValider)).not.toThrow()
  })
})

describe('catalogue de configuration : frais et moyens Mercy Pay (spec §4.3, D2)', () => {
  it('should bill 350 basis points on mobile money, paid by the merchant, with no fixed part in P1', () => {
    expect(getFraisPaiement('mercypay', 'mobile_money')).toMatchObject({ tauxPointsBase: 350, supporteur: 'marchand' })
    expect(getFraisPaiement('mercypay', 'mobile_money')?.fixeMinor ?? 0).toBe(0)
  })

  it.each([
    ['mercypay:MTN_MOMO_CMR', 'MTN_MOMO_CMR', 'MTN MoMo'],
    ['mercypay:ORANGE_CMR', 'ORANGE_CMR', 'Orange Money'],
  ])('should offer the active Cameroon mobile money way %s (operator %s, label %s)', (id, operateur, libelle) => {
    const moyen = getMoyenPaiement(id)

    expect(moyen).toMatchObject({ fournisseur: 'mercypay', methode: 'mobile_money', operateur, libelle, pays: 'CMR', indicatif: '237', devise: 'XAF', actif: true })
    expect(moyen?.numeroNational.test('680000000')).toBe(true)
    expect(moyen?.numeroNational.test('580000000')).toBe(false)
  })

  it('should show no provider name to the user: the label is the operator only (D9)', () => {
    for (const moyen of MOYENS_PAIEMENT.filter((m) => m.fournisseur === 'mercypay')) {
      expect(moyen.libelle).not.toMatch(/mercy|kpay/i)
    }
  })

  it('should keep a coherent catalogue : the whole configuration passes the startup check', () => {
    expect(() => assertConfigPaiements({ NODE_ENV: 'development' })).not.toThrow()
  })
})
