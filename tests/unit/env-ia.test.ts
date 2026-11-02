import { describe, expect, it } from 'vitest'
import { loadEnv, resolveIaFournisseur } from '../../shared/env'
import { IA_CLE_API_LONGUEUR_MIN, IA_MODELE_DEFAUT } from '../../shared/ia'

// S8 §0 #71 / CA33 : choix du fournisseur et validation de la configuration IA.
// La clé n'est lue que par le worker : jamais d'écho de sa valeur dans une erreur ou un journal.

const CLE = `sk-ant-${'x'.repeat(IA_CLE_API_LONGUEUR_MIN)}`
const BASE = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}
const BASE_PRODUCTION = { ...BASE, NODE_ENV: 'production', RESEND_API_KEY: 're_test_cle_resend' }

describe('resolveIaFournisseur (règle #71)', () => {
  it.each([
    // [NODE_ENV, IA_FOURNISSEUR, clé présente, attendu]
    ['development', undefined, false, 'faux'],
    ['test', undefined, false, 'faux'],
    ['development', undefined, true, 'anthropic'],
    ['test', undefined, true, 'anthropic'],
    ['production', undefined, false, 'aucun'],
    ['production', undefined, true, 'anthropic'],
    ['development', 'aucun', false, 'aucun'],
    ['development', 'aucun', true, 'aucun'],
    ['production', 'aucun', true, 'aucun'],
    ['development', 'faux', false, 'faux'],
    ['development', 'faux', true, 'faux'],
    ['test', 'faux', false, 'faux'],
    ['production', 'faux', false, 'aucun'],
    ['production', 'faux', true, 'aucun'],
    ['development', 'anthropic', true, 'anthropic'],
    ['production', 'anthropic', true, 'anthropic'],
    ['development', 'anthropic', false, 'aucun'],
    ['production', 'anthropic', false, 'aucun'],
    ['development', 'openai', true, 'openai'],
    ['production', 'openai', true, 'openai'],
    ['development', 'openai', false, 'aucun'],
    ['production', 'openai', false, 'aucun'],
  ] as const)('should resolve NODE_ENV=%s IA_FOURNISSEUR=%s key=%s to %s', (nodeEnv, fournisseur, avecCle, attendu) => {
    const resultat = resolveIaFournisseur({
      NODE_ENV: nodeEnv,
      IA_FOURNISSEUR: fournisseur,
      IA_CLE_API: avecCle ? CLE : undefined,
    })

    expect(resultat).toBe(attendu)
  })

  it('should never throw, whatever the combination (a bad configuration means fallback, not an outage)', () => {
    for (const nodeEnv of ['development', 'test', 'production'] as const) {
      for (const fournisseur of [undefined, 'anthropic', 'openai', 'faux', 'aucun'] as const) {
        for (const cle of [undefined, CLE]) {
          expect(() => resolveIaFournisseur({ NODE_ENV: nodeEnv, IA_FOURNISSEUR: fournisseur, IA_CLE_API: cle })).not.toThrow()
        }
      }
    }
  })
})

describe('loadEnv : variables IA (CA33)', () => {
  it('should refuse the fake provider in production, naming the variable', () => {
    expect(() => loadEnv({ ...BASE_PRODUCTION, IA_FOURNISSEUR: 'faux' })).toThrow(/IA_FOURNISSEUR/)
  })

  it('should accept the fake provider in development and test', () => {
    expect(loadEnv({ ...BASE, NODE_ENV: 'development', IA_FOURNISSEUR: 'faux' }).IA_FOURNISSEUR).toBe('faux')
    expect(loadEnv({ ...BASE, NODE_ENV: 'test', IA_FOURNISSEUR: 'faux' }).IA_FOURNISSEUR).toBe('faux')
  })

  it('should boot in production without any key and resolve to the deterministic fallback', () => {
    const env = loadEnv(BASE_PRODUCTION)

    expect(env.IA_CLE_API).toBeUndefined()
    expect(env.IA_FOURNISSEUR).toBeUndefined()
    expect(resolveIaFournisseur(env)).toBe('aucun')
  })

  it('should resolve to anthropic in production once a key is present', () => {
    expect(resolveIaFournisseur(loadEnv({ ...BASE_PRODUCTION, IA_CLE_API: CLE }))).toBe('anthropic')
  })

  it('should default the model to claude-haiku-5-5 and accept an override', () => {
    expect(loadEnv(BASE).IA_MODELE).toBe(IA_MODELE_DEFAUT)
    expect(loadEnv({ ...BASE, IA_MODELE: 'un-autre-modele' }).IA_MODELE).toBe('un-autre-modele')
  })

  it('should treat empty variables as absent (a copied .env.example with IA_*= must boot)', () => {
    const env = loadEnv({ ...BASE, IA_FOURNISSEUR: '', IA_CLE_API: '', IA_MODELE: '' })

    expect(env.IA_FOURNISSEUR).toBeUndefined()
    expect(env.IA_CLE_API).toBeUndefined()
    expect(env.IA_MODELE).toBe(IA_MODELE_DEFAUT)
  })

  it('should treat a whitespace-only key as absent and trim a padded key', () => {
    expect(loadEnv({ ...BASE, IA_CLE_API: '    ' }).IA_CLE_API).toBeUndefined()
    expect(loadEnv({ ...BASE, IA_CLE_API: `  ${CLE}  ` }).IA_CLE_API).toBe(CLE)
  })

  it('should refuse a key shorter than the minimum length, and accept exactly the minimum', () => {
    expect(() => loadEnv({ ...BASE, IA_CLE_API: 'x'.repeat(IA_CLE_API_LONGUEUR_MIN - 1) })).toThrow(/IA_CLE_API/)
    expect(loadEnv({ ...BASE, IA_CLE_API: 'x'.repeat(IA_CLE_API_LONGUEUR_MIN) }).IA_CLE_API).toHaveLength(IA_CLE_API_LONGUEUR_MIN)
  })

  it('should never echo a malformed key value in the configuration error', () => {
    const cleCourte = 'sk-ant-TROP-COURTE'

    let message = ''
    try {
      loadEnv({ ...BASE, IA_CLE_API: cleCourte })
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur)
    }

    expect(message).toMatch(/IA_CLE_API/)
    expect(message).not.toContain(cleCourte)
  })

  it('should refuse an unknown provider name', () => {
    expect(() => loadEnv({ ...BASE, IA_FOURNISSEUR: 'mistral' })).toThrow(/IA_FOURNISSEUR/)
  })
})

describe('loadEnv : fournisseur compatible OpenAI', () => {
  const OPENAI = { ...BASE, IA_FOURNISSEUR: 'openai', IA_CLE_API: CLE, IA_MODELE: 'gpt-4.1-mini' }

  it('should accept openai with a key and an explicit model, defaulting to no base URL', () => {
    const env = loadEnv(OPENAI)

    expect(env.IA_FOURNISSEUR).toBe('openai')
    expect(env.IA_MODELE).toBe('gpt-4.1-mini')
    expect(env.IA_BASE_URL).toBeUndefined()
    expect(resolveIaFournisseur(env)).toBe('openai')
  })

  it.each([undefined, '', '   '])('should refuse openai without an explicit model (%j), naming the variable and not echoing the key', (modele) => {
    let message = ''
    try {
      loadEnv({ ...OPENAI, IA_MODELE: modele })
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur)
    }

    expect(message).toMatch(/IA_MODELE/)
    expect(message).not.toContain(CLE)
  })

  it('should keep the Anthropic default model when the provider is not openai', () => {
    expect(loadEnv({ ...BASE, IA_FOURNISSEUR: 'anthropic' }).IA_MODELE).toBe(IA_MODELE_DEFAUT)
  })

  it('should accept the Gemini example configuration', () => {
    const env = loadEnv({
      ...OPENAI,
      IA_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      IA_MODELE: 'gemini-2.5-flash',
    })

    expect(env.IA_BASE_URL).toBe('https://generativelanguage.googleapis.com/v1beta/openai/')
  })

  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:11434/v1', 'https://api.groq.com/openai/v1'])(
    'should accept the base URL %s',
    (url) => {
      expect(loadEnv({ ...OPENAI, IA_BASE_URL: url }).IA_BASE_URL).toBe(url)
    },
  )

  it.each([
    'http://api.exemple.com/v1',
    'http://192.168.1.10:11434/v1',
    'http://localhost.exemple.com/v1',
    'file:///etc/passwd',
    'ftp://exemple.com/v1',
    'https://utilisateur:secret-tres-confidentiel@api.exemple.com/v1',
    'https://jeton-seul@api.exemple.com/v1',
    'pas une url',
  ])('should refuse the base URL %s without echoing it', (url) => {
    let message = ''
    try {
      loadEnv({ ...OPENAI, IA_BASE_URL: url })
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur)
    }

    expect(message).toMatch(/IA_BASE_URL/)
    expect(message).not.toContain(url)
    expect(message).not.toContain('secret-tres-confidentiel')
  })

  it('should treat an empty or blank base URL as absent', () => {
    expect(loadEnv({ ...OPENAI, IA_BASE_URL: '' }).IA_BASE_URL).toBeUndefined()
    expect(loadEnv({ ...OPENAI, IA_BASE_URL: '   ' }).IA_BASE_URL).toBeUndefined()
  })

  it('should resolve openai without a key to the deterministic fallback, in production too', () => {
    const sansCle = loadEnv({ ...BASE_PRODUCTION, IA_FOURNISSEUR: 'openai', IA_MODELE: 'gpt-4.1-mini' })

    expect(resolveIaFournisseur(sansCle)).toBe('aucun')
  })

  it('should still refuse the fake provider in production with the openai variables around', () => {
    expect(() => loadEnv({ ...BASE_PRODUCTION, IA_FOURNISSEUR: 'faux', IA_BASE_URL: 'https://api.openai.com/v1' })).toThrow(/IA_FOURNISSEUR/)
  })

  it('should never pick openai implicitly from a key alone', () => {
    expect(resolveIaFournisseur(loadEnv({ ...BASE, IA_CLE_API: CLE, IA_BASE_URL: 'https://api.openai.com/v1' }))).toBe('anthropic')
  })
})
