import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { configurationVersions } from '../../shared/db/schema'
import { schemaValeursFrais, schemaValeursMoyens } from '../../shared/schemas/admin-versions'
import { lireInstantaneSansCache, lireVersionActive } from '../../server/services/configuration/lecture'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'

// P1 (docs/specs/P1-mercypay.md §4.3) : migration 0034, DONNÉES du catalogue versionné pour Mercy Pay (moyens et frais, v1,
// actives). Aucune structure ne change. État de la base APRÈS la migration (jouée par le globalSetup sur la vraie base de
// test), puis REJEU, RETOUR ARRIÈRE documenté et remontée. `configuration_versions` refuse DELETE (42501) : tout test qui
// ÉCRIT s'exécute dans une transaction TOUJOURS annulée ; un refus attendu s'exécute dans un point de sauvegarde. La base
// commune n'en garde aucune trace.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const TAG = '0034_p1_catalogue_mercypay'
const PREFIXE_0035 = '0035_'
const RAISE_EXCEPTION = 'P0001'
const UNIQUE_VIOLATION = '23505'
const WHEN_0034 = 1794967170386

const ID_MOYENS = 'a5000000-moyens-mercypay-1'
// 0035 (P1-bis, zone XAF) remplace la v1 des moyens par une v2 : après toutes les migrations, la v1 est `remplacee`.
const ID_MOYENS_V2 = 'a5000000-moyens-mercypay-2'
const ID_FRAIS = 'a5000000-frais-mercypay-mobile-money-1'
const VALEURS_MOYENS = { actifs: ['mercypay:MTN_MOMO_CMR', 'mercypay:ORANGE_CMR'] }
const VALEURS_FRAIS = { tauxPointsBase: 350, supporteur: 'marchand' }
const KPAY = {
  moyens: { id: 'a5000000-moyens-kpay-1', categorie: 'moyens', cle: 'kpay', valeurs: { actifs: ['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'] } },
  frais: { id: 'a5000000-frais-kpay-1', categorie: 'frais', cle: 'kpay:mobile_money', valeurs: { tauxPointsBase: 500, supporteur: 'marchand' } },
} as const

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
class AnnulationVolontaire extends Error {}

function contenu(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0034_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0034 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  expect(fichiers[0]).toBe(`${TAG}.sql`)
  return readFileSync(path.join(MIGRATIONS_DIR, fichiers[0]!), 'utf-8')
}

/** Instruction(s) du « up » : tout ce qui précède le bloc ROLLBACK, commentaires retirés. */
function instructionsUp(): string[] {
  const texte = contenu()
  return texte
    .slice(0, texte.indexOf('-- ROLLBACK'))
    .split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n')
    .split(/;\s*$/m).map((i) => i.trim()).filter((i) => i !== '')
}

/** Bloc ROLLBACK commenté (entre BEGIN; et COMMIT;), une instruction par ligne. */
function instructionsRollback(): string[] {
  const lignes = contenu().split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin <= debut) throw new Error('Bloc ROLLBACK BEGIN/COMMIT introuvable.')
  return lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').trim()).filter((l) => l !== '')
}

/** Bloc ROLLBACK de 0035 : à jouer AVANT celui de 0034 (le garde-fou de 0034 refuse tant que la v2 des moyens existe). */
function instructionsRollback0035(): string[] {
  const fichier = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith(PREFIXE_0035) && f.endsWith('.sql'))
  if (fichier === undefined) throw new Error('Migration 0035 introuvable.')
  const lignes = readFileSync(path.join(MIGRATIONS_DIR, fichier), 'utf-8').split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin <= debut) throw new Error('Bloc ROLLBACK 0035 introuvable.')
  return lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').trim()).filter((l) => l !== '')
}

async function executer(tx: Tx, instructions: string[]): Promise<void> {
  for (const instruction of instructions) await tx.execute(sql.raw(instruction))
}

async function dansTransactionAnnulee(corps: (tx: Tx) => Promise<void>): Promise<void> {
  const erreur = await rejet(db.transaction(async (tx) => {
    await corps(tx)
    throw new AnnulationVolontaire('annulation volontaire de la transaction de test')
  }))
  expect(erreur.brute).toBeInstanceOf(AnnulationVolontaire)
}

/** Joue une écriture qui doit échouer dans un point de sauvegarde, pour que la transaction survive. */
async function refus(tx: Tx, instruction: string) {
  await tx.execute(sql`SAVEPOINT avant_refus`)
  const erreur = await rejet(tx.execute(sql.raw(instruction)))
  await tx.execute(sql`ROLLBACK TO SAVEPOINT avant_refus`)
  return erreur
}

interface LigneVersion {
  id: string
  categorie: string
  cle: string
  numero: number
  valeurs: unknown
  statut: string
  effective_a: Date
  motif: string
  cree_par: string
  validee_le: Date | null
}

async function lignes(lecteur: Pick<typeof db, 'execute'>, filtre = sql`TRUE`): Promise<LigneVersion[]> {
  const resultat = await lecteur.execute<LigneVersion>(sql`
    SELECT id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par, validee_le
    FROM configuration_versions WHERE ${filtre} ORDER BY id`)
  return resultat.rows
}

const MERCY = sql`cle IN ('mercypay', 'mercypay:mobile_money')`
const MERCY_V1 = sql`id IN (${ID_MOYENS}, ${ID_FRAIS})`
const KPAY_LIGNES = sql`id IN (${KPAY.moyens.id}, ${KPAY.frais.id})`

describe('migration 0034 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, no structural statement and the commented manual rollback', () => {
    const texte = contenu()
    const code = instructionsUp().join('\n')

    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0034_snapshot.json'))).toBe(true)
    expect(texte).toMatch(/ROLLBACK/)
    expect(texte).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
    expect(code).toMatch(/ON CONFLICT DO NOTHING/)
    expect(code).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE|UPDATE|DELETE)\b/i)
    expect(code).not.toMatch(/'kpay/)
  })

  it('should be registered right after 0033 in the journal with a later date (or it would never be applied)', () => {
    const { entries } = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[33]).toMatchObject({ idx: 33, tag: '0033_p1_paiements_source_fournisseur' })
    expect(entries[34]).toMatchObject({ idx: 34, tag: TAG, when: WHEN_0034 })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0033 with an unchanged schema', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as { id: string, prevId: string, tables: unknown }
    const precedent = lire('0033_snapshot.json')
    const courant = lire('0034_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(courant.tables).toEqual(precedent.tables)
  })
})

describe('migration 0034 : versions Mercy Pay du catalogue', () => {
  it('should hold its two v1 versions, authored by `systeme`, dated 2000-01-01, with the expected ids, keys and values (the moyens v1 is replaced by the v2 of 0035)', async () => {
    const rows = await lignes(db, MERCY_V1)

    expect(rows.map((r) => [r.id, r.categorie, r.cle, r.numero, r.statut, r.cree_par, r.validee_le])).toEqual([
      [ID_FRAIS, 'frais', 'mercypay:mobile_money', 1, 'active', 'systeme', null],
      [ID_MOYENS, 'moyens', 'mercypay', 1, 'remplacee', 'systeme', null],
    ])
    expect(rows.find((r) => r.id === ID_MOYENS)?.valeurs).toEqual(VALEURS_MOYENS)
    expect(rows.find((r) => r.id === ID_FRAIS)?.valeurs).toEqual(VALEURS_FRAIS)
    for (const r of rows) {
      expect(new Date(r.effective_a).toISOString(), r.id).toBe('2000-01-01T00:00:00.000Z')
      expect(r.motif.trim().length, r.id).toBeGreaterThanOrEqual(5)
    }
  })

  it('should carry values that the strict schemas of the administration accept (or the reading service would ignore them)', () => {
    expect(schemaValeursMoyens.safeParse(VALEURS_MOYENS).success).toBe(true)
    expect(schemaValeursFrais.safeParse(VALEURS_FRAIS).success).toBe(true)
  })

  it('should leave exactly ONE active version per (category, key) among the Mercy Pay keys (unique partial index)', async () => {
    const resultat = await db.execute<{ categorie: string, cle: string, n: number }>(sql`
      SELECT categorie, cle, count(*)::int AS n FROM configuration_versions WHERE statut = 'active' AND ${MERCY} GROUP BY categorie, cle`)

    expect(resultat.rows.map((r) => `${r.categorie}/${r.cle}:${r.n}`).sort()).toEqual(['frais/mercypay:mobile_money:1', 'moyens/mercypay:1'])
    const doublon = await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, `INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
        VALUES ('a5000000-moyens-mercypay-9', 'moyens', 'mercypay', 3, '{"actifs":[]}', 'active', now(), 'Doublon de version active', 'admin-1')`)
      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_active_unique' })
    })
    expect(doublon).toBeUndefined()
  })

  it('should NOT modify the K-PAY rows of 0032 (same content, still active, still version 1)', async () => {
    const rows = await lignes(db, KPAY_LIGNES)

    expect(rows.map((r) => [r.id, r.categorie, r.cle, r.numero, r.statut, r.cree_par, r.valeurs])).toEqual(
      [KPAY.frais, KPAY.moyens].map((k) => [k.id, k.categorie, k.cle, 1, 'active', 'systeme', k.valeurs]),
    )
  })

  it('should be seen by the reading service of the catalogue (snapshot and active version of each key)', async () => {
    const instantane = await lireInstantaneSansCache()
    const moyens = await lireVersionActive('moyens', 'mercypay', { sansCache: true })
    const frais = await lireVersionActive('frais', 'mercypay:mobile_money', { sansCache: true })

    expect([...(instantane.moyensActifs.get('mercypay') ?? [])]).toEqual(expect.arrayContaining(['mercypay:MTN_MOMO_CMR', 'mercypay:ORANGE_CMR']))
    expect(instantane.frais).toHaveProperty(['mercypay', 'mobile_money'])
    expect((instantane.frais as Record<string, Record<string, unknown>>).mercypay?.mobile_money).toMatchObject(VALEURS_FRAIS)
    expect(moyens).toMatchObject({ id: ID_MOYENS_V2, numero: 2, valideeLe: null })
    expect(frais).toMatchObject({ id: ID_FRAIS, numero: 1, valeurs: VALEURS_FRAIS, valideeLe: null })
    expect([...(instantane.moyensActifs.get('kpay') ?? [])].sort()).toEqual(['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
  })
})

describe('migration 0034 : rejeu, retour arrière, remontée', () => {
  it('should replay twice without error, without duplicate and without touching any row (data present, K-PAY rows included)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await lignes(tx)

      await executer(tx, instructionsUp())
      await executer(tx, instructionsUp())

      expect(await lignes(tx)).toEqual(avant)
      expect(await lignes(tx, MERCY)).toHaveLength(3) // frais v1, moyens v1 (remplacee), moyens v2 (0035)
    })
  })

  it('should never resurrect nor overwrite a version the administration has replaced (v1 replaced by v2: replay leaves both as they are)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ID_MOYENS_V2}`)
      await tx.insert(configurationVersions).values({
        id: 'a5000000-moyens-mercypay-3', categorie: 'moyens', cle: 'mercypay', numero: 3, valeurs: { actifs: ['mercypay:MTN_MOMO_CMR'] },
        statut: 'active', effectiveA: new Date('2026-11-18T00:00:00Z'), motif: 'Orange désactivé', creePar: 'admin-1',
      })
      const avant = await lignes(tx, MERCY)

      await executer(tx, instructionsUp())

      expect(await lignes(tx, MERCY)).toEqual(avant)
      expect(avant.map((r) => `${r.id}:${r.statut}`)).toEqual([
        `${ID_FRAIS}:active`, `${ID_MOYENS}:remplacee`, `${ID_MOYENS_V2}:remplacee`, 'a5000000-moyens-mercypay-3:active',
      ])
    })
  })

  it('should roll back (documented block, executed as is): Mercy Pay rows gone, K-PAY rows untouched, protection trigger re-enabled, journal row removed; then come back up', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback0035()) // 0035 se retire avant 0034
      await executer(tx, instructionsRollback())

      expect(await lignes(tx, MERCY)).toEqual([])
      expect((await lignes(tx, KPAY_LIGNES)).map((r) => r.id).sort()).toEqual([KPAY.frais.id, KPAY.moyens.id].sort())
      const declencheur = await tx.execute<{ tgenabled: string }>(sql`
        SELECT tgenabled FROM pg_trigger WHERE tgname = 'configuration_versions_proteger' AND tgrelid = 'public.configuration_versions'::regclass`)
      expect(declencheur.rows[0]?.tgenabled).toBe('O')
      const journal = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0034}`)
      expect(journal.rows[0]?.n).toBe(0)

      await executer(tx, instructionsUp())

      const rows = await lignes(tx, MERCY)
      expect(rows.map((r) => r.id)).toEqual([ID_FRAIS, ID_MOYENS])
      expect(rows.find((r) => r.id === ID_MOYENS)?.valeurs).toEqual(VALEURS_MOYENS)
    })
  })

  it('should REFUSE its rollback (P0001, rows kept) when the administration created or replaced a Mercy Pay version', async () => {
    const garde = instructionsRollback().find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback0035())
      await tx.execute(sql.raw(garde)) // état d'origine (sans 0035) : le garde-fou laisse passer
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ID_FRAIS}`)

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
      expect(((erreur.brute as { cause?: { message?: string } }).cause?.message) ?? erreur.message).toContain('rollback 0034 refuse')
      expect(await lignes(tx, MERCY)).toHaveLength(2)
    })
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(configurationVersions).values({
        id: 'a5000000-frais-mercypay-mobile-money-2', categorie: 'frais', cle: 'mercypay:mobile_money', numero: 2, valeurs: { tauxPointsBase: 400, supporteur: 'client' },
        statut: 'brouillon', effectiveA: null, motif: 'Nouveau barème', creePar: 'admin-1',
      })

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
    await dansTransactionAnnulee(async (tx) => {
      // Tant que la v2 de 0035 existe, 0034 refuse de se retirer : l'ordre inverse de l'application est imposé.
      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
  })

  it('should leave the common database with its Mercy Pay rows and the protection trigger enabled (nothing committed by the tests above)', async () => {
    const declencheur = await db.execute<{ tgenabled: string }>(sql`
      SELECT tgenabled FROM pg_trigger WHERE tgname = 'configuration_versions_proteger' AND tgrelid = 'public.configuration_versions'::regclass`)

    expect(await lignes(db, MERCY)).toHaveLength(3)
    expect(declencheur.rows[0]?.tgenabled).toBe('O')
  })
})
