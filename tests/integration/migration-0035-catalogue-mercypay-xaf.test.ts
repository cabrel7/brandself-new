import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { configurationVersions } from '../../shared/db/schema'
import { schemaValeursFrais, schemaValeursMoyens } from '../../shared/schemas/admin-versions'
import { lireInstantaneSansCache, lireMoyensActifs, lireVersionActive } from '../../server/services/configuration/lecture'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'

// P1-bis : migration 0035, DONNÉES du catalogue versionné : v2 de `moyens` / `mercypay` (six moyens actifs : Cameroun + zone XAF
// Congo et Gabon), la v1 de 0034 passe à `remplacee`. Aucune structure ne change. État de la base APRÈS la migration (jouée par
// le globalSetup sur la vraie base de test), puis REJEU, RETOUR ARRIÈRE documenté et remontée. `configuration_versions` refuse
// DELETE (42501) : tout test qui ÉCRIT s'exécute dans une transaction TOUJOURS annulée ; un refus attendu s'exécute dans un
// point de sauvegarde. La base commune n'en garde aucune trace.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const TAG = '0035_p1b_catalogue_mercypay_xaf'
const RAISE_EXCEPTION = 'P0001'
const INSUFFICIENT_PRIVILEGE = '42501'
const UNIQUE_VIOLATION = '23505'
const WHEN_0035 = 1795424286616
const MARQUEUR_RUPTURE = '@@RUPTURE@@'

const ID_V1 = 'a5000000-moyens-mercypay-1'
const ID_V2 = 'a5000000-moyens-mercypay-2'
const ID_FRAIS = 'a5000000-frais-mercypay-mobile-money-1'
const ACTIFS_V1 = ['mercypay:MTN_MOMO_CMR', 'mercypay:ORANGE_CMR']
const ACTIFS_XAF = ['mercypay:MTN_MOMO_COG', 'mercypay:AIRTEL_COG', 'mercypay:AIRTEL_GAB', 'mercypay:MOOV_GAB']
const VALEURS_V1 = { actifs: ACTIFS_V1 }
const VALEURS_V2 = { actifs: [...ACTIFS_V1, ...ACTIFS_XAF] }
const VALEURS_FRAIS = { tauxPointsBase: 350, supporteur: 'marchand' }
const KPAY = {
  moyens: { id: 'a5000000-moyens-kpay-1', categorie: 'moyens', cle: 'kpay', valeurs: { actifs: ['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'] } },
  frais: { id: 'a5000000-frais-kpay-1', categorie: 'frais', cle: 'kpay:mobile_money', valeurs: { tauxPointsBase: 500, supporteur: 'marchand' } },
} as const

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
class AnnulationVolontaire extends Error {}

function contenu(prefixe: string): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith(prefixe) && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration ${prefixe} est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return readFileSync(path.join(MIGRATIONS_DIR, fichiers[0]!), 'utf-8')
}

/**
 * Instructions du « up » : tout ce qui précède le bloc ROLLBACK, découpé sur les marqueurs `--> statement-breakpoint` de
 * drizzle-kit (ce que fait `migrate`), commentaires retirés.
 */
function instructionsUp(): string[] {
  const texte = contenu('0035_')
  return texte
    .slice(0, texte.indexOf('-- ROLLBACK'))
    .replaceAll('--> statement-breakpoint', `\n${MARQUEUR_RUPTURE}\n`)
    .split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n')
    .split(MARQUEUR_RUPTURE).map((i) => i.trim().replace(/;$/, '')).filter((i) => i !== '')
}

/** Bloc ROLLBACK commenté (entre BEGIN; et COMMIT;), une instruction par ligne. */
function instructionsRollback(prefixe = '0035_'): string[] {
  const lignes = contenu(prefixe).split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin <= debut) throw new Error('Bloc ROLLBACK BEGIN/COMMIT introuvable.')
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
const MOYENS_MERCY = sql`categorie = 'moyens' AND cle = 'mercypay'`
const KPAY_LIGNES = sql`id IN (${KPAY.moyens.id}, ${KPAY.frais.id})`

/** Résumé stable (sans dates ni auteur de création) pour comparer deux états de la même clé. */
function resume(rows: LigneVersion[]): string[] {
  return rows.map((r) => `${r.id}|${r.numero}|${r.statut}|${JSON.stringify(r.valeurs)}`)
}

async function declencheurActif(lecteur: Pick<typeof db, 'execute'>): Promise<string | undefined> {
  const resultat = await lecteur.execute<{ tgenabled: string }>(sql`
    SELECT tgenabled FROM pg_trigger WHERE tgname = 'configuration_versions_proteger' AND tgrelid = 'public.configuration_versions'::regclass`)
  return resultat.rows[0]?.tgenabled
}

describe('migration 0035 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, data statements only (no structure, no DO block) and the commented manual rollback', () => {
    const texte = contenu('0035_')
    const code = instructionsUp().join('\n')

    expect(readdirSync(MIGRATIONS_DIR)).toContain(`${TAG}.sql`)
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0035_snapshot.json'))).toBe(true)
    expect(texte).toMatch(/ROLLBACK/)
    expect(texte).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
    expect(instructionsUp()).toHaveLength(2)
    expect(code).toMatch(/ON CONFLICT DO NOTHING/)
    expect(code).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE)\b/i)
    expect(code).not.toMatch(/DO \$\$/)
    expect(code).not.toMatch(/'kpay/)
    expect(code).not.toMatch(/mobile_money/)
  })

  it('should be registered right after 0034 in the journal with a later date (or it would never be applied)', () => {
    const { entries } = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[34]).toMatchObject({ idx: 34, tag: '0034_p1_catalogue_mercypay' })
    expect(entries[35]).toMatchObject({ idx: 35, tag: TAG, when: WHEN_0035, breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0034 with an unchanged schema', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as { id: string, prevId: string, tables: unknown }
    const precedent = lire('0034_snapshot.json')
    const courant = lire('0035_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(courant.tables).toEqual(precedent.tables)
  })

  it('should have been applied by drizzle (journal row present in the database)', async () => {
    const journal = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0035}`)

    expect(journal.rows[0]?.n).toBe(1)
  })
})

describe('migration 0035 : versions Mercy Pay du catalogue', () => {
  it('should hold v1 replaced (content untouched) and v2 active with the six moyens, authored by `systeme`, with the expected id, key and values', async () => {
    const rows = await lignes(db, MOYENS_MERCY)

    expect(rows.map((r) => [r.id, r.categorie, r.cle, r.numero, r.statut, r.cree_par, r.validee_le])).toEqual([
      [ID_V1, 'moyens', 'mercypay', 1, 'remplacee', 'systeme', null],
      [ID_V2, 'moyens', 'mercypay', 2, 'active', 'systeme', null],
    ])
    expect(rows[0]?.valeurs).toEqual(VALEURS_V1)
    expect(rows[1]?.valeurs).toEqual(VALEURS_V2)
    expect(new Date(rows[0]!.effective_a).toISOString()).toBe('2000-01-01T00:00:00.000Z')
    const effet = new Date(rows[1]!.effective_a).getTime()
    expect(effet).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime())
    expect(effet).toBeLessThanOrEqual(Date.now())
    expect(rows[1]!.motif.trim().length).toBeGreaterThanOrEqual(5)
    expect(rows[1]!.motif.trim().length).toBeLessThanOrEqual(500)
  })

  it('should carry values that the strict schema of the administration accepts (or the reading service would ignore them)', () => {
    expect(schemaValeursMoyens.safeParse(VALEURS_V2).success).toBe(true)
    expect(schemaValeursMoyens.safeParse(VALEURS_V1).success).toBe(true)
    expect(schemaValeursFrais.safeParse(VALEURS_FRAIS).success).toBe(true)
  })

  it('should leave exactly ONE active version per (category, key) among the Mercy Pay keys (unique partial index)', async () => {
    const resultat = await db.execute<{ categorie: string, cle: string, n: number }>(sql`
      SELECT categorie, cle, count(*)::int AS n FROM configuration_versions WHERE statut = 'active' AND ${MERCY} GROUP BY categorie, cle`)

    expect(resultat.rows.map((r) => `${r.categorie}/${r.cle}:${r.n}`).sort()).toEqual(['frais/mercypay:mobile_money:1', 'moyens/mercypay:1'])
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, `INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
        VALUES ('a5000000-moyens-mercypay-9', 'moyens', 'mercypay', 3, '{"actifs":[]}', 'active', now(), 'Doublon de version active', 'admin-1')`)
      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_active_unique' })
    })
  })

  it('should NOT modify the Mercy Pay fees (v1, 350 bp, merchant) nor the K-PAY rows of 0032', async () => {
    const frais = await lignes(db, sql`id = ${ID_FRAIS}`)
    const kpay = await lignes(db, KPAY_LIGNES)

    expect(frais.map((r) => [r.id, r.numero, r.statut, r.cree_par, r.valeurs])).toEqual([[ID_FRAIS, 1, 'active', 'systeme', VALEURS_FRAIS]])
    expect(kpay.map((r) => [r.id, r.categorie, r.cle, r.numero, r.statut, r.cree_par, r.valeurs])).toEqual(
      [KPAY.frais, KPAY.moyens].map((k) => [k.id, k.categorie, k.cle, 1, 'active', 'systeme', k.valeurs]),
    )
  })

  it('should keep the protection trigger: the content of v2 is frozen and v2 cannot be deleted (42501)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const modif = await refus(tx, `UPDATE configuration_versions SET valeurs = '{"actifs":[]}' WHERE id = '${ID_V2}'`)
      const suppr = await refus(tx, `DELETE FROM configuration_versions WHERE id = '${ID_V2}'`)

      expect(erreurPostgres(modif.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres(suppr.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should be seen by the reading service of the catalogue (snapshot, active version, and the six Mercy Pay moyens ACTIVE in the code catalogue)', async () => {
    const instantane = await lireInstantaneSansCache()
    const version = await lireVersionActive('moyens', 'mercypay', { sansCache: true })
    const moyens = await lireMoyensActifs({ sansCache: true })
    const mercy = moyens.filter((m) => m.fournisseur === 'mercypay')

    expect([...(instantane.moyensActifs.get('mercypay') ?? [])].sort()).toEqual([...VALEURS_V2.actifs].sort())
    expect(version).toMatchObject({ id: ID_V2, numero: 2, valeurs: VALEURS_V2, valideeLe: null })
    expect(mercy.filter((m) => m.actif).map((m) => m.id).sort()).toEqual([...VALEURS_V2.actifs].sort())
    expect(mercy.map((m) => m.id).sort()).toEqual([...VALEURS_V2.actifs].sort())
    expect([...(instantane.moyensActifs.get('kpay') ?? [])].sort()).toEqual(['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
    expect(instantane.frais).toHaveProperty(['mercypay', 'mobile_money'])
    expect((instantane.frais as Record<string, Record<string, unknown>>).mercypay?.mobile_money).toMatchObject(VALEURS_FRAIS)
  })
})

describe('migration 0035 : rejeu, retour arrière, remontée', () => {
  it('should replay twice without error, without duplicate and without touching any row', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await lignes(tx)

      await executer(tx, instructionsUp())
      await executer(tx, instructionsUp())

      expect(await lignes(tx)).toEqual(avant)
      expect(await lignes(tx, MOYENS_MERCY)).toHaveLength(2)
    })
  })

  it('should never resurrect nor overwrite what the administration did after it (v2 replaced by an administration v3: replay leaves everything as it is)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ID_V2}`)
      await tx.insert(configurationVersions).values({
        id: 'a5000000-moyens-mercypay-3', categorie: 'moyens', cle: 'mercypay', numero: 3, valeurs: { actifs: ['mercypay:MTN_MOMO_CMR'] },
        statut: 'active', effectiveA: new Date('2026-12-01T00:00:00Z'), motif: 'Orange désactivé', creePar: 'admin-1',
      })
      const avant = await lignes(tx, MOYENS_MERCY)

      await executer(tx, instructionsUp())

      expect(await lignes(tx, MOYENS_MERCY)).toEqual(avant)
      expect(avant.map((r) => `${r.id}:${r.statut}`)).toEqual([`${ID_V1}:remplacee`, `${ID_V2}:remplacee`, 'a5000000-moyens-mercypay-3:active'])
    })
  })

  it('should leave v1 active and add nothing when the administration already holds a version >= 2 for the key (draft v2 written before the migration)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback().filter((i) => !i.startsWith('DO $$')))
      await tx.insert(configurationVersions).values({
        id: 'a5000000-moyens-mercypay-brouillon', categorie: 'moyens', cle: 'mercypay', numero: 2, valeurs: { actifs: ['mercypay:MTN_MOMO_CMR'] },
        statut: 'brouillon', effectiveA: null, motif: 'Brouillon de l’administration', creePar: 'admin-1',
      })
      const avant = await lignes(tx, MOYENS_MERCY)

      await executer(tx, instructionsUp())

      expect(await lignes(tx, MOYENS_MERCY)).toEqual(avant)
      expect(avant.map((r) => `${r.id}:${r.statut}`)).toEqual([`${ID_V1}:active`, 'a5000000-moyens-mercypay-brouillon:brouillon'])
    })
  })

  it('should insert nothing when v1 itself is missing (never leave a gap in the numbering)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback().filter((i) => !i.startsWith('DO $$')))
      await tx.execute(sql`ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger`)
      await tx.execute(sql`DELETE FROM configuration_versions WHERE id = ${ID_V1}`)
      await tx.execute(sql`ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger`)

      await executer(tx, instructionsUp())

      expect(await lignes(tx, MOYENS_MERCY)).toEqual([])
    })
  })

  it('should roll back (documented block, executed as is): v2 gone, v1 active again with its values, protection trigger re-enabled, journal row removed; then come back up', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback())

      const rows = await lignes(tx, MOYENS_MERCY)
      expect(rows.map((r) => [r.id, r.statut, r.valeurs])).toEqual([[ID_V1, 'active', VALEURS_V1]])
      expect(new Date(rows[0]!.effective_a).toISOString()).toBe('2000-01-01T00:00:00.000Z')
      expect((await lignes(tx, KPAY_LIGNES)).map((r) => r.id).sort()).toEqual([KPAY.frais.id, KPAY.moyens.id].sort())
      expect((await lignes(tx, sql`id = ${ID_FRAIS}`)).map((r) => r.statut)).toEqual(['active'])
      expect(await declencheurActif(tx)).toBe('O')
      const journal = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0035}`)
      expect(journal.rows[0]?.n).toBe(0)

      await executer(tx, instructionsUp())

      const remontee = await lignes(tx, MOYENS_MERCY)
      expect(resume(remontee)).toEqual([
        `${ID_V1}|1|remplacee|${JSON.stringify(VALEURS_V1)}`,
        `${ID_V2}|2|active|${JSON.stringify(VALEURS_V2)}`,
      ])
    })
  })

  it('should REFUSE its rollback (P0001, rows kept) when the administration created a version, replaced v2, or when v1 is not replaced', async () => {
    const garde = instructionsRollback().find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql.raw(garde)) // état d'origine : le garde-fou laisse passer
      await tx.insert(configurationVersions).values({
        id: 'a5000000-moyens-mercypay-3', categorie: 'moyens', cle: 'mercypay', numero: 3, valeurs: { actifs: ['mercypay:MTN_MOMO_CMR'] },
        statut: 'brouillon', effectiveA: null, motif: 'Nouveau brouillon', creePar: 'admin-1',
      })

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
      expect(((erreur.brute as { cause?: { message?: string } }).cause?.message) ?? erreur.message).toContain('rollback 0035 refuse')
      expect(await lignes(tx, MOYENS_MERCY)).toHaveLength(3)
    })
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ID_V2}`)
      await tx.insert(configurationVersions).values({
        id: 'a5000000-moyens-mercypay-3', categorie: 'moyens', cle: 'mercypay', numero: 3, valeurs: { actifs: ['mercypay:MTN_MOMO_CMR'] },
        statut: 'active', effectiveA: new Date('2026-12-01T00:00:00Z'), motif: 'Orange désactivé', creePar: 'admin-1',
      })

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql`ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger`)
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'brouillon', effective_a = NULL WHERE id = ${ID_V1}`)
      await tx.execute(sql`ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger`)

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
  })

  it('should make the rollback of 0034 refuse while v2 exists (0035 must be rolled back FIRST), and let it through once 0035 is rolled back', async () => {
    const gardeSuivante = instructionsRollback('0034_').find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, gardeSuivante)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
      expect(((erreur.brute as { cause?: { message?: string } }).cause?.message) ?? erreur.message).toContain('rollback 0034 refuse')
    })
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback())

      await tx.execute(sql.raw(gardeSuivante))
    })
  })

  it('should leave the common database with v2 active, v1 replaced and the protection trigger enabled (nothing committed by the tests above)', async () => {
    const rows = await lignes(db, MOYENS_MERCY)

    expect(rows.map((r) => `${r.id}:${r.statut}`)).toEqual([`${ID_V1}:remplacee`, `${ID_V2}:active`])
    expect(await declencheurActif(db)).toBe('O')
  })
})
