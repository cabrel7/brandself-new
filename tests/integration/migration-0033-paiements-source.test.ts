import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { paiements } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'

// P1 (docs/specs/P1-mercypay.md §4.5, CA-M16) : migration 0033, paiements.source ('kpay','manuel') -> ('fournisseur','manuel').
// État de la base APRÈS la migration (jouée par le globalSetup sur la vraie base de test) lu dans les catalogues
// PostgreSQL, contraintes éprouvées par des écritures réelles, puis RETOUR ARRIÈRE (bloc ROLLBACK du fichier exécuté
// tel quel) et REJOUABILITÉ. Les essais de retour arrière se font dans une transaction annulée à la fin : la base
// commune n'est jamais laissée dans l'ancien état.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const RAISE_EXCEPTION = 'P0001'
const TAG = '0033_p1_paiements_source_fournisseur'
const FICHIER = `${TAG}.sql`

function contenuMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0033_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0033 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  expect(fichiers[0]).toBe(FICHIER)
  return readFileSync(path.join(MIGRATIONS_DIR, FICHIER), 'utf-8')
}

/** Instructions SQL du « up » (tout ce qui précède le bloc ROLLBACK), commentaires retirés. */
function instructionsUp(): string[] {
  const contenu = contenuMigration()
  const up = contenu.slice(0, contenu.indexOf('-- ROLLBACK'))
  return up
    .split(BREAKPOINT)
    .map((bloc) => bloc.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n').trim())
    .filter((bloc) => bloc !== '')
}

/** Instructions du bloc ROLLBACK commenté (entre BEGIN; et COMMIT;), une par ligne, préfixe « -- » retiré. */
function instructionsRollback(): string[] {
  const lignes = contenuMigration().split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin === -1 || fin <= debut) throw new Error('Bloc ROLLBACK BEGIN/COMMIT introuvable.')
  return lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').trim()).filter((l) => l !== '')
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function executer(tx: Transaction, instructions: string[]): Promise<void> {
  for (const instruction of instructions) await tx.execute(sql.raw(instruction))
}

/** Fait échouer volontairement la transaction pour l'annuler (rien n'est conservé) ; l'échec attendu est celui-ci seulement. */
class AnnulationVolontaire extends Error {}

async function dansTransactionAnnulee(corps: (tx: Transaction) => Promise<void>): Promise<void> {
  const erreur = await rejet(db.transaction(async (tx) => {
    await corps(tx)
    throw new AnnulationVolontaire('annulation volontaire de la transaction de test')
  }))
  expect(erreur.brute).toBeInstanceOf(AnnulationVolontaire)
}

interface Contrainte {
  validee: boolean
  definition: string
}

async function contraintes(executeur: Pick<typeof db, 'execute'> = db): Promise<Record<string, Contrainte>> {
  const resultat = await executeur.execute<{ conname: string, convalidated: boolean, def: string }>(sql`
    SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.paiements'::regclass AND contype = 'c'`)
  return Object.fromEntries(resultat.rows.map((r) => [r.conname, { validee: r.convalidated, definition: r.def }]))
}

async function defautSource(executeur: Pick<typeof db, 'execute'> = db): Promise<string | null> {
  const resultat = await executeur.execute<{ column_default: string | null }>(sql`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'paiements' AND column_name = 'source'`)
  return resultat.rows[0]?.column_default ?? null
}

type LignePaiement = typeof paiements.$inferInsert

/** Paiement d'un fournisseur valide ; les surcharges servent à éprouver chaque contrainte. */
function paiementFournisseur(surcharges: Partial<LignePaiement> = {}): LignePaiement {
  return {
    id: randomUUID(),
    userId: null,
    fournisseur: 'mercypay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CMR',
    environnement: 'test',
    idFournisseur: `pay_${randomUUID()}`,
    referenceFournisseur: randomUUID(),
    plan: 'payant',
    periodeMois: 1,
    devise: 'XAF',
    montantPlan: 5000,
    montant: 5000,
    fraisTauxPb: 350,
    fraisSupporteur: 'marchand',
    fraisEstimes: 175,
    netEstime: 4825,
    expireAvant: new Date(Date.now() + 900_000),
    source: 'fournisseur',
    ...surcharges,
  }
}

function paiementManuel(surcharges: Partial<LignePaiement> = {}): LignePaiement {
  const id = surcharges.id ?? randomUUID()
  return {
    id,
    userId: null,
    fournisseur: 'manuel',
    methode: 'manuel',
    operateur: null,
    environnement: 'live',
    idFournisseur: null,
    referenceFournisseur: `manuel-${id}`,
    plan: 'payant',
    periodeMois: 1,
    devise: 'XAF',
    montantPlan: 5000,
    montant: 5000,
    fraisTauxPb: 0,
    fraisSupporteur: 'marchand',
    fraisEstimes: 0,
    netEstime: 5000,
    expireAvant: new Date(Date.now() + 900_000),
    source: 'manuel',
    ...surcharges,
  }
}

/** Ligne K-PAY telle qu'elle existait AVANT 0033 (source 'kpay'), insérée en SQL brut dans l'ancien état. */
async function insererLigneKpayHeritee(tx: Transaction, id: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO paiements (id, fournisseur, methode, environnement, plan, periode_mois, devise, montant_plan, montant,
      frais_taux_pb, frais_supporteur, frais_estimes, net_estime, expire_avant, id_fournisseur, reference_fournisseur, source)
    VALUES (${id}, 'kpay', 'mobile_money', 'test', 'payant', 1, 'XAF', 5000, 5000, 500, 'marchand', 250, 4750,
      now() + interval '15 minutes', ${`kp_${id}`}, ${`ref_${id}`}, 'kpay')`)
}

describe('migration 0033 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot and the commented manual rollback', () => {
    const contenu = contenuMigration()

    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0033_snapshot.json'))).toBe(true)
    expect(contenu).toMatch(/ROLLBACK/)
    expect(contenu).toMatch(/--\s*UPDATE paiements SET source = 'kpay' WHERE source = 'fournisseur'/)
    expect(contenu).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
  })

  it('should be registered right after 0032 in the journal with a later date (or it would never be applied)', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }
    const { entries } = journal

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[32]).toMatchObject({ idx: 32, tag: '0032_a5_catalogues_versions' })
    expect(entries[33]).toMatchObject({ idx: 33, tag: TAG, breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0032 and carry the new default and checks, without any new column', () => {
    interface Snapshot {
      id: string
      prevId: string
      tables: Record<string, { columns: Record<string, { default?: unknown }>, checkConstraints: Record<string, { value: string }> }>
    }
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as Snapshot
    const precedent = lire('0032_snapshot.json')
    const courant = lire('0033_snapshot.json')
    const colonnesAvant = Object.keys(precedent.tables['public.paiements']!.columns).sort()
    const colonnesApres = Object.keys(courant.tables['public.paiements']!.columns).sort()

    expect(courant.prevId).toBe(precedent.id)
    expect(colonnesApres).toEqual(colonnesAvant)
    expect(courant.tables['public.paiements']!.columns.source!.default).toBe("'fournisseur'")
    expect(courant.tables['public.paiements']!.checkConstraints.paiements_source_check!.value).toContain("IN ('fournisseur','manuel')")
  })

  it('should be written to be replayed: guarded drops, an UPDATE limited to legacy rows, NOT VALID then VALIDATE, nothing destructive', () => {
    const instructions = instructionsUp().map((i) => i.replace(/\s+/g, ' '))

    expect(instructions).toHaveLength(8)
    for (const instruction of instructions) {
      if (/^ALTER TABLE .* DROP CONSTRAINT/.test(instruction)) expect(instruction, instruction).toContain('IF EXISTS')
      if (/^ALTER TABLE .* ADD CONSTRAINT/.test(instruction)) expect(instruction, instruction).toContain('NOT VALID')
    }
    expect(instructions.find((i) => i.startsWith('UPDATE'))).toBe(`UPDATE "paiements" SET "source" = 'fournisseur' WHERE "source" = 'kpay';`)
    for (const nom of ['paiements_source_check', 'paiements_source_coherence_check']) {
      expect(instructions.join('\n'), nom).toContain(`VALIDATE CONSTRAINT "${nom}"`)
    }
    expect(instructions.join('\n')).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ADD COLUMN)\b/i)
  })
})

describe('migration 0033 : paiements.source (CA-M16)', () => {
  it("should default source to 'fournisseur' and declare both CHECK constraints validated, with the new wording", async () => {
    const c = await contraintes()

    expect(await defautSource()).toContain("'fournisseur'")
    expect(c.paiements_source_check).toMatchObject({ validee: true })
    expect(c.paiements_source_check?.definition).toContain("'fournisseur'")
    expect(c.paiements_source_check?.definition).not.toContain("'kpay'")
    expect(c.paiements_source_coherence_check).toMatchObject({ validee: true })
    expect(c.paiements_source_coherence_check?.definition).toContain("(source = 'fournisseur'")
    expect(c.paiements_source_coherence_check?.definition).not.toContain("'kpay'")
  })

  it("should accept fournisseur='mercypay' with source='fournisseur', and an insertion without source takes the default 'fournisseur'", async () => {
    const explicite = paiementFournisseur()
    const { source: _omise, ...sansSource } = paiementFournisseur({ fournisseur: 'kpay' })

    await db.insert(paiements).values(explicite)
    await db.insert(paiements).values(sansSource)

    const [relu] = await db.select({ source: paiements.source, fournisseur: paiements.fournisseur }).from(paiements).where(eq(paiements.id, explicite.id))
    expect(relu).toEqual({ source: 'fournisseur', fournisseur: 'mercypay' })
    const lignes = await db.select({ source: paiements.source }).from(paiements).where(eq(paiements.id, sansSource.id!))
    expect(lignes).toEqual([{ source: 'fournisseur' }])
  })

  it("should refuse fournisseur='manuel' with source='fournisseur' (23514, coherence check)", async () => {
    const erreur = await rejet(db.insert(paiements).values(paiementManuel({ source: 'fournisseur' })))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })

  it("should refuse fournisseur='mercypay' with source='manuel' (23514, coherence check)", async () => {
    const erreur = await rejet(db.insert(paiements).values(paiementFournisseur({ source: 'manuel' })))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })

  it.each(['kpay', 'stripe', 'Fournisseur', 'FOURNISSEUR', '', 'admin'])('should refuse the source %j (23514, source check): the legacy value is gone', async (source) => {
    const erreur = await rejet(db.insert(paiements).values(paiementFournisseur({ source })))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_check' })
  })

  it('should keep every A3 manual-payment guarantee (a valid manual payment passes, a faulty one is refused)', async () => {
    const manuel = paiementManuel()
    const maintenant = new Date()
    const manuelReussi = paiementManuel({ statut: 'reussi', appliqueLe: maintenant, termineLe: maintenant })

    await db.insert(paiements).values([manuel, manuelReussi])
    const sansReference = await rejet(db.insert(paiements).values(paiementManuel({ referenceFournisseur: null })))
    const avecFrais = await rejet(db.insert(paiements).values(paiementManuel({ fraisTauxPb: 500 })))
    const avecIdFournisseur = await rejet(db.insert(paiements).values(paiementManuel({ idFournisseur: 'pay_x' })))

    expect(erreurPostgres(sansReference.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
    expect(erreurPostgres(avecFrais.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION })
    expect(erreurPostgres(avecIdFournisseur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })

  it("should refuse to relabel a provider payment as manual by UPDATE, and a manual one as 'fournisseur'", async () => {
    const mercy = paiementFournisseur()
    const manuel = paiementManuel()
    await db.insert(paiements).values([mercy, manuel])

    const versManuel = await rejet(db.execute(sql`UPDATE paiements SET source = 'manuel' WHERE id = ${mercy.id}`))
    const versFournisseur = await rejet(db.execute(sql`UPDATE paiements SET source = 'fournisseur' WHERE id = ${manuel.id}`))

    expect(erreurPostgres(versManuel.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
    expect(erreurPostgres(versFournisseur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })
})

describe('migration 0033 : données existantes et retour arrière', () => {
  it("should turn the legacy K-PAY rows (source 'kpay') into 'fournisseur' on the real data path, leaving manual rows and the K-PAY provider name untouched", async () => {
    const idKpay = randomUUID()
    const manuel = paiementManuel()

    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback()) // retour à l'ancien état : la source 'kpay' redevient admise
      await insererLigneKpayHeritee(tx, idKpay)
      await tx.insert(paiements).values(manuel)
      const avant = await tx.execute<{ source: string }>(sql`SELECT source FROM paiements WHERE id = ${idKpay}`)
      expect(avant.rows[0]?.source).toBe('kpay')

      await executer(tx, instructionsUp()) // la migration, telle quelle, sur ces lignes

      const apres = await tx.execute<{ id: string, source: string, fournisseur: string }>(sql`
        SELECT id, source, fournisseur FROM paiements WHERE id IN (${idKpay}, ${manuel.id}) ORDER BY source`)
      expect(apres.rows).toEqual([
        { id: idKpay, source: 'fournisseur', fournisseur: 'kpay' },
        { id: manuel.id, source: 'manuel', fournisseur: 'manuel' },
      ])
      const restantes = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM paiements WHERE source = 'kpay'`)
      expect(restantes.rows[0]?.n).toBe('0')
    })
  })

  it("should roll back to the old model (default 'kpay', old CHECKs validated, 'fournisseur' refused, 'kpay' accepted) and come back up", async () => {
    await dansTransactionAnnulee(async (tx) => {
      await executer(tx, instructionsRollback())

      const ancien = await contraintes(tx)
      expect(await defautSource(tx)).toContain("'kpay'")
      expect(ancien.paiements_source_check).toMatchObject({ validee: true })
      expect(ancien.paiements_source_check?.definition).toContain("'kpay'")
      expect(ancien.paiements_source_coherence_check).toMatchObject({ validee: true })
      expect(ancien.paiements_source_coherence_check?.definition).toContain("(source = 'kpay'")
      const journal = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations WHERE created_at = 1794966010914`)
      expect(journal.rows[0]?.n).toBe('0')
      await tx.execute(sql`SAVEPOINT avant_refus`)
      const refus = await rejet(tx.insert(paiements).values(paiementFournisseur({ fournisseur: 'kpay' })))
      expect(erreurPostgres(refus.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_check' })
      await tx.execute(sql`ROLLBACK TO SAVEPOINT avant_refus`)

      await executer(tx, instructionsUp())

      const nouveau = await contraintes(tx)
      expect(await defautSource(tx)).toContain("'fournisseur'")
      expect(nouveau.paiements_source_check?.definition).toContain("'fournisseur'")
      expect(nouveau.paiements_source_coherence_check?.definition).toContain("(source = 'fournisseur'")
      expect(nouveau.paiements_source_check?.validee).toBe(true)
      expect(nouveau.paiements_source_coherence_check?.validee).toBe(true)
    })
  })

  it("should refuse the rollback (guard) as soon as a payment of a provider other than 'kpay' exists, and lose nothing", async () => {
    const mercy = paiementFournisseur()
    await db.insert(paiements).values(mercy)

    const erreur = await rejet(db.transaction(async (tx) => { await executer(tx, instructionsRollback()) }))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    expect(erreur.message + String((erreur.brute as { cause?: unknown }).cause ?? '')).toMatch(/rollback 0033 refuse/)
    const [relu] = await db.select({ source: paiements.source }).from(paiements).where(eq(paiements.id, mercy.id))
    expect(relu?.source).toBe('fournisseur')
    expect(await defautSource()).toContain("'fournisseur'")
  })

  it('should replay twice without error and without losing any data (provider payment, manual payment)', async () => {
    const mercy = paiementFournisseur()
    const kpay = paiementFournisseur({ fournisseur: 'kpay' })
    const manuel = paiementManuel()
    await db.insert(paiements).values([mercy, kpay, manuel])

    for (let i = 0; i < 2; i += 1) {
      await db.transaction(async (tx) => { await executer(tx, instructionsUp()) })
    }

    const lignes = await db.select({ id: paiements.id, source: paiements.source }).from(paiements)
    expect(lignes.map((l) => `${l.id}:${l.source}`).sort()).toEqual(
      [`${mercy.id}:fournisseur`, `${kpay.id}:fournisseur`, `${manuel.id}:manuel`].sort(),
    )
    const c = await contraintes()
    expect(c.paiements_source_check?.validee).toBe(true)
    expect(c.paiements_source_coherence_check?.validee).toBe(true)
    const erreur = await rejet(db.insert(paiements).values(paiementManuel({ source: 'fournisseur' })))
    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })
})

describe('migration 0033 : parité entre le schéma Drizzle et la base', () => {
  it('should declare in Drizzle the same CHECK names, the same wording and the same default as the database', async () => {
    const config = getTableConfig(paiements)
    const enBase = await contraintes()
    const colonneSource = config.columns.find((c) => c.name === 'source')

    expect(colonneSource?.default).toBe('fournisseur')
    for (const nom of ['paiements_source_check', 'paiements_source_coherence_check']) {
      expect(config.checks.map((c) => c.name), nom).toContain(nom)
      expect(Object.keys(enBase), nom).toContain(nom)
    }
    expect(await defautSource()).toContain("'fournisseur'")
  })
})
