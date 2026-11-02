import { inspect } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../shared/env'
import { IA_CLE_API_LONGUEUR_MIN } from '../../shared/ia'
import { definirModeFaux, iaFaux, iaFournisseurs, iaTypes, reinitialiserIa } from './support/ia'
import type { RequeteVue } from './support/ia'
import { rejet } from './support/erreurs'

// S8 §4.2 / CA33 : choix et comportement des fournisseurs. Le faux fournisseur lit son mode dans le vrai Redis.
// `createIaProvider` ne reçoit que l'environnement validé (loadEnv) : jamais un littéral de type Env incomplet.

const CLE = `cle-de-test-${'x'.repeat(IA_CLE_API_LONGUEUR_MIN)}`
const BASE = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/15',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}

beforeEach(reinitialiserIa)

function requete(surcharges: Partial<RequeteVue> = {}): RequeteVue {
  return {
    systeme: 'Système',
    message: '<donnees>{"titre":"Dr","metier":"Cardiologue interventionnel","ville":"Douala","pays":"Cameroun"}</donnees>',
    outil: { nom: 'proposer_vitrine', description: 'Enregistre la proposition de vitrine', schema: {} },
    parametres: { temperature: 0.7, maxTokens: 1500 },
    delaiMs: 50,
    signal: new AbortController().signal,
    ...surcharges,
  }
}

describe('createIaProvider', () => {
  it('should answer null when the resolved provider is « aucun » (deterministic fallback, no call)', async () => {
    const { createIaProvider } = await iaFournisseurs()

    expect(createIaProvider(loadEnv({ ...BASE, NODE_ENV: 'development', IA_FOURNISSEUR: 'aucun' }))).toBeNull()
  })

  it('should answer null in production without key (CA33)', async () => {
    const { createIaProvider } = await iaFournisseurs()

    expect(createIaProvider(loadEnv({ ...BASE, NODE_ENV: 'production', RESEND_API_KEY: 're_test_cle_resend' }))).toBeNull()
  })

  it('should answer null when the fake provider is configured in production (never served to real users)', async () => {
    const { createIaProvider } = await iaFournisseurs()
    const env = { ...loadEnv({ ...BASE, NODE_ENV: 'production', RESEND_API_KEY: 're_test_cle_resend' }), IA_FOURNISSEUR: 'faux' as const }

    expect(createIaProvider(env)).toBeNull()
  })

  it('should build the fake provider in development without any key', async () => {
    const { createIaProvider } = await iaFournisseurs()

    expect(createIaProvider(loadEnv({ ...BASE, NODE_ENV: 'development' }))?.nom).toBe('faux')
  })

  it('should build the Anthropic provider once a key is present, and never expose the key when the provider is printed or serialised', async () => {
    const { createIaProvider } = await iaFournisseurs()

    const provider = createIaProvider(loadEnv({ ...BASE, NODE_ENV: 'development', IA_CLE_API: CLE }))

    expect(provider?.nom).toBe('anthropic')
    expect(JSON.stringify(provider)).not.toContain(CLE)
    expect(inspect(provider, { depth: 6, showHidden: false })).not.toContain(CLE)
  })

  it('should build no provider for « anthropic » without a key (never an exception)', async () => {
    const { createIaProvider } = await iaFournisseurs()

    expect(createIaProvider(loadEnv({ ...BASE, NODE_ENV: 'development', IA_FOURNISSEUR: 'anthropic' }))).toBeNull()
  })
})

describe('faux fournisseur', () => {
  it('should count every call, including failed ones', async () => {
    const { creerFauxProvider } = await iaFaux()
    const provider = creerFauxProvider()
    await definirModeFaux('panne')

    await rejet(provider.generer(requete()))
    await rejet(provider.generer(requete()))

    expect(provider.appels).toBe(2)
  })

  it('should fail with a provider error in « panne » mode', async () => {
    const { creerFauxProvider } = await iaFaux()
    const { IaErreur } = await iaTypes()
    await definirModeFaux('panne')

    const erreur = await rejet(creerFauxProvider().generer(requete()))

    expect(erreur.brute).toBeInstanceOf(IaErreur)
    expect(erreur.code).toBe('fournisseur')
  })

  it('should wait for the requested delay then fail with a timeout in « lent » mode', async () => {
    const { creerFauxProvider } = await iaFaux()
    await definirModeFaux('lent')
    const debut = Date.now()

    const erreur = await rejet(creerFauxProvider().generer(requete({ delaiMs: 40 })))

    expect(erreur.code).toBe('delai')
    expect(Date.now() - debut).toBeGreaterThanOrEqual(40)
  })

  it('should answer a deterministic proposition in normal mode, with fictitious tokens', async () => {
    const { creerFauxProvider } = await iaFaux()
    const provider = creerFauxProvider()

    const premiere = await provider.generer(requete())
    const seconde = await provider.generer(requete())

    expect(premiere.donnees).toEqual(seconde.donnees)
    expect(premiere).toMatchObject({ tokensEntree: 100, tokensSortie: 300 })
    expect(premiere.modele.length).toBeGreaterThan(0)
  })

  it('should read the mode at every call (changing the key changes the behaviour)', async () => {
    const { creerFauxProvider } = await iaFaux()
    const provider = creerFauxProvider()
    await provider.generer(requete())
    await definirModeFaux('panne')

    await rejet(provider.generer(requete()))
    await definirModeFaux('normal')

    await expect(provider.generer(requete())).resolves.toBeDefined()
  })
})
