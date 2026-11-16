import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAIS_PAIEMENT } from '../../../server/config/paiements'
import { PLANS, PRIX_PLANS } from '../../../server/config/plans'

// A5 D-A5-04 : lecture de la configuration commerciale. Cache mémoire de 5 s pour les plans, frais, moyens et catalogues ;
// SANS cache pour `lireVersionActive(..., { sansCache: true })` (lectures qui décident d'un encaissement) ; erreur de
// lecture = repli sur les constantes du code (qui valent la v1 seedée), jamais une exception ni une porte « ouverte ».
// La base est remplacée par une fausse base qui compte ses lectures (seul le NOMBRE de lectures et leur résultat sont
// observés, jamais la forme des requêtes) ; l'horloge est fausse, le module est rechargé à chaque test (cache neuf).

const CACHE_MS = 5_000
const base = vi.hoisted(() => ({ lectures: 0, lignes: [] as unknown[], panne: false }))

vi.mock('../../../server/utils/db', () => {
  const lire = (): Promise<unknown> => {
    base.lectures += 1
    if (base.panne) return Promise.reject(new Error('base indisponible'))
    return Promise.resolve(Object.assign([...base.lignes], { rows: base.lignes }))
  }
  // Toute chaîne (`select().from().where()…`, `execute()`) se résout en lisant la fausse base.
  const chaine: unknown = new Proxy(() => undefined, {
    get: (_cible, propriete) => (propriete === 'then'
      ? (ok: (valeur: unknown) => unknown, ko: (erreur: unknown) => unknown) => lire().then(ok, ko)
      : chaine),
    apply: () => chaine,
  })
  return { db: chaine }
})

const instant = new Date(0)
/** Ligne de version avec les deux écritures de colonne (camelCase de Drizzle, snake_case du SQL brut). */
const ligneFrais = (tauxPointsBase: number) => ({
  id: 'a5000000-frais-test', categorie: 'frais', cle: 'kpay:mobile_money', numero: 2, statut: 'active',
  valeurs: { tauxPointsBase, supporteur: 'client' },
  effectiveA: instant, effective_a: instant, valideeLe: null, validee_le: null,
  motif: 'Version de test', creePar: 'test', cree_par: 'test', creeLe: instant, cree_le: instant,
})

const valeursDe = (lu: unknown): unknown => (typeof lu === 'object' && lu !== null && 'valeurs' in lu ? (lu as { valeurs: unknown }).valeurs : lu)
const taux = (lu: unknown): unknown => (valeursDe(lu) as { tauxPointsBase?: number } | undefined)?.tauxPointsBase

async function lecture() {
  vi.resetModules()
  return import('../../../server/services/configuration/lecture')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'))
  base.lectures = 0
  base.lignes = [ligneFrais(700)]
  base.panne = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cache de lecture de 5 secondes', () => {
  it('should serve the cached value for 5 seconds without reading again, then reload the new one', async () => {
    const { lireFrais } = await lecture()
    expect(taux(await lireFrais('kpay', 'mobile_money'))).toBe(700)
    const lecturesInitiales = base.lectures
    base.lignes = [ligneFrais(900)]

    vi.advanceTimersByTime(CACHE_MS - 100)
    const dansLeCache = taux(await lireFrais('kpay', 'mobile_money'))
    const lecturesDansLeCache = base.lectures
    vi.advanceTimersByTime(200)
    const apresLeCache = taux(await lireFrais('kpay', 'mobile_money'))

    expect(lecturesInitiales).toBeGreaterThan(0)
    expect(dansLeCache).toBe(700)
    expect(lecturesDansLeCache).toBe(lecturesInitiales)
    expect(apresLeCache).toBe(900)
    expect(base.lectures).toBeGreaterThan(lecturesInitiales)
  })

  it('should read the base every time with sansCache (the reads that decide a charge never use the cache)', async () => {
    const { lireVersionActive } = await lecture()
    await lireVersionActive('frais', 'kpay:mobile_money', { sansCache: true })
    base.lignes = [ligneFrais(900)]

    const relue = await lireVersionActive('frais', 'kpay:mobile_money', { sansCache: true })

    expect(taux(relue)).toBe(900)
  })
})

describe('repli sur les constantes du code', () => {
  it('should serve the constants (which equal version 1) instead of throwing when the base cannot be read, and never report the price as validated', async () => {
    base.panne = true
    const { lireFrais, lireGrillePrix, lirePlanConfig, lireVersionActive } = await lecture()

    const frais = await lireFrais('kpay', 'mobile_money')
    const grille = await lireGrillePrix()
    const prix = await lireVersionActive('prix', 'payant', { sansCache: true }) as { valideeLe?: unknown }

    expect(valeursDe(frais)).toEqual(FRAIS_PAIEMENT.kpay?.mobile_money)
    expect(valeursDe(grille)).toEqual(PRIX_PLANS.payant)
    expect(lirePlanConfig('gratuit')).toMatchObject(PLANS.gratuit)
    expect(lirePlanConfig('payant')).toMatchObject(PLANS.payant)
    expect(prix.valideeLe ?? null).toBeNull()
  })
})
