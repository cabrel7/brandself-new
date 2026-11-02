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
      for (const fournisseur of [undefined, 'anthropic', 'faux', 'aucun'] as const) {
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
    expect(() => loadEnv({ ...BASE, IA_FOURNISSEUR: 'openai' })).toThrow(/IA_FOURNISSEUR/)
  })
})
