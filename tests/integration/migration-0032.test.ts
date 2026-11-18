import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { configurationVersions, devises, pays, promptsIa, usernamesBloques } from '../../shared/db/schema'
import { DEVISES } from '../../shared/compte'
import { isValidTimeZone } from '../../shared/fuseau'
import { CAPACITES_PAYANTES } from '../../shared/plans'
import { PAYS } from '../../shared/vitrine'
import { FRAIS_PAIEMENT, MOYENS_PAIEMENT } from '../../server/config/paiements'
import { PLANS, PRIX_PLANS } from '../../server/config/plans'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'
import type { ErreurCapturee } from './support/erreurs'

// A5 §4 : migration 0032 (devises, pays, noms bloqués, versions de configuration en ajout seul, versionnage des
// prompts). État de la base APRÈS la migration (jouée par le globalSetup sur la vraie base de test), contraintes
// éprouvées par des écritures réelles, déclencheurs éprouvés, REJOUABILITÉ et montée / ROLLBACK documenté / remontée.
// DISCIPLINE : `configuration_versions` et `prompts_ia` refusent DELETE (42501) et ne sont pas vidées par le nettoyage
// de tests/integration/setup.ts ; `pays`, `devises` et `usernames_bloques` n'y sont pas non plus. Tout test qui ÉCRIT
// s'exécute donc dans une transaction TOUJOURS annulée (`dansTransactionAnnulee`) ; un refus attendu s'exécute dans un
// point de sauvegarde (`refus`) pour que la transaction survive. La base partagée n'en garde aucune trace.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const NOT_NULL_VIOLATION = '23502'
const INSUFFICIENT_PRIVILEGE = '42501'
const RAISE_EXCEPTION = 'P0001'
const EMPREINTE_SEED = 'systeme'
const ANNULATION = new Error('annulation volontaire de la transaction de test')
const TABLES_A5 = ['devises', 'pays', 'usernames_bloques', 'configuration_versions'] as const
const SEED_IDS = {
  gratuit: 'a5000000-plan-gratuit-1',
  payant: 'a5000000-plan-payant-1',
  prix: 'a5000000-prix-payant-1',
  frais: 'a5000000-frais-kpay-1',
  moyens: 'a5000000-moyens-kpay-1',
} as const
const MOTIF_HISTORIQUE = 'Historique (migrations 0018 et 0027)'
const PROMPTS_HISTORIQUES: ReadonlyArray<readonly [string, number]> = [
  ['onboarding_vitrine', 1], ['onboarding_vitrine', 2], ['ameliorer_texte', 1], ['seo_vitrine', 1],
]

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executeur = { execute: (requete: ReturnType<typeof sql.raw>) => PromiseLike<unknown> }
/** Lecteur du catalogue : DANS une transaction, toujours passer `tx` (une autre connexion attendrait les verrous du DDL non validé). */
type Lecteur = Pick<typeof db, 'execute'>

/** Message de l'erreur PostgreSQL elle-même (drizzle enveloppe : `message` ne contient que la requête). */
function messageSql(erreur: ErreurCapturee): string {
  const cause = (erreur.brute as { cause?: { message?: unknown } } | null)?.cause
  return typeof cause?.message === 'string' ? cause.message : erreur.message
}

/** Exécute `corps` dans une transaction qui est TOUJOURS annulée ; une assertion qui échoue dedans remonte telle quelle. */
async function dansTransactionAnnulee(corps: (tx: Tx) => Promise<void>): Promise<void> {
  let echec: unknown
  try {
    await db.transaction(async (tx) => {
      try {
        await corps(tx)
      } catch (erreur) {
        echec = erreur
      }
      throw ANNULATION
    })
  } catch (erreur) {
    if (erreur !== ANNULATION) throw erreur
  }
  if (echec !== undefined) throw echec
}

/** Attend le rejet de `action` dans un point de sauvegarde : la transaction englobante reste utilisable. */
async function refus(tx: Tx, action: (sp: Tx) => Promise<unknown>): Promise<ErreurCapturee> {
  return rejet(tx.transaction(async (sp) => { await action(sp) }))
}

function fichierMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0032_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0032 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return fichiers[0]!
}

function lireMigration(): string {
  return readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
}

interface Journal {
  entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
}

function lireJournal(): Journal {
  return JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as Journal
}

function instructionsMigration(): string[] {
  return lireMigration()
    .split(BREAKPOINT)
    .map((bloc) => bloc.trim())
    .filter((bloc) => bloc.split('\n').some((ligne) => ligne.trim() !== '' && !ligne.trimStart().startsWith('--')))
}

function sansCommentaires(instruction: string): string {
  return instruction.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
}

/** Lignes du ROLLBACK commenté (de « -- BEGIN; » à « -- COMMIT; », sans BEGIN, COMMIT ni la ligne du journal drizzle). */
function rollbackExecutable(): { instructions: string[], ligneJournal: string | undefined } {
  const lignes = lireMigration().split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin === -1 || fin < debut) throw new Error('Bloc ROLLBACK (-- BEGIN; … -- COMMIT;) introuvable dans 0032.')
  const corps = lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').replace(/\s+--\s.*$/, '').trim())
  return {
    instructions: corps.filter((l) => l !== '' && !l.startsWith('DELETE FROM drizzle.')),
    ligneJournal: corps.find((l) => l.startsWith('DELETE FROM drizzle.')),
  }
}

async function rejouer(executeur: Executeur): Promise<void> {
  for (const instruction of instructionsMigration()) await executeur.execute(sql.raw(instruction))
}

interface Colonne {
  type: string
  nullable: boolean
  defaut: string | null
}

async function colonnes(table: string, lecteur: Lecteur = db): Promise<Record<string, Colonne>> {
  const resultat = await lecteur.execute<{ column_name: string, data_type: string, is_nullable: string, column_default: string | null }>(sql`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable === 'YES', defaut: r.column_default }]))
}

interface Contrainte {
  type: string
  validee: boolean
  definition: string
  suppression: string
}

async function contraintes(table: string, lecteur: Lecteur = db): Promise<Record<string, Contrainte>> {
  const resultat = await lecteur.execute<{ conname: string, contype: string, convalidated: boolean, def: string, confdeltype: string }>(sql`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def, confdeltype FROM pg_constraint
    WHERE conrelid = ${`public.${table}`}::regclass`)
  return Object.fromEntries(resultat.rows.map((r) => [r.conname, { type: r.contype, validee: r.convalidated, definition: r.def, suppression: r.confdeltype }]))
}

async function indexDe(table: string, lecteur: Lecteur = db): Promise<Record<string, string>> {
  const resultat = await lecteur.execute<{ indexname: string, indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.indexname, r.indexdef]))
}

async function planSansBalayageSequentiel(requete: ReturnType<typeof sql>): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`)
    const resultat = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN ${requete}`)
    return resultat.rows.map((r) => r['QUERY PLAN']).join('\n')
  })
}

async function declencheurs(table: string, lecteur: Lecteur = db): Promise<Record<string, string>> {
  const resultat = await lecteur.execute<{ tgname: string, tgenabled: string }>(sql`
    SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = ${`public.${table}`}::regclass AND NOT tgisinternal`)
  return Object.fromEntries(resultat.rows.map((r) => [r.tgname, r.tgenabled]))
}

async function existe(objet: string, lecteur: Lecteur = db): Promise<boolean> {
  const resultat = await lecteur.execute<{ present: string | null }>(sql`SELECT to_regclass(${`public.${objet}`}) AS present`)
  return resultat.rows[0]?.present !== null
}

async function lireValeurs(id: string): Promise<unknown> {
  const resultat = await db.execute<{ valeurs: unknown }>(sql`SELECT valeurs FROM configuration_versions WHERE id = ${id}`)
  return resultat.rows[0]?.valeurs
}

let compteur = 0

function ligneVersion(surcharges: Partial<typeof configurationVersions.$inferInsert> = {}): typeof configurationVersions.$inferInsert {
  compteur += 1
  return {
    id: `test-version-${compteur}-${randomUUID().slice(0, 8)}`,
    categorie: 'moyens',
    cle: 'essai',
    numero: 1,
    valeurs: { actifs: [] },
    statut: 'active',
    effectiveA: new Date('2026-01-01T00:00:00.000Z'),
    motif: 'Version de test',
    creePar: 'test',
    ...surcharges,
  }
}

function lignePays(surcharges: Partial<typeof pays.$inferInsert> = {}): typeof pays.$inferInsert {
  return { code: 'ZZ', libelle: 'Pays de test', indicatif: '999', deviseDefaut: 'XAF', fuseaux: ['Africa/Douala'], ...surcharges }
}

function lignePrompt(surcharges: Partial<typeof promptsIa.$inferInsert> = {}): typeof promptsIa.$inferInsert {
  return {
    id: `test-prompt-${randomUUID().slice(0, 8)}`,
    type: 'ameliorer_texte',
    version: 98,
    systeme: 'Système de test',
    gabarit: 'Voici {{donnees}}',
    variables: ['donnees'],
    parametres: { maxTokens: 100 },
    schemaSortie: 'proposition_test_v1',
    actif: false,
    ...surcharges,
  }
}

describe('migration 0032 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, and carry the commented manual rollback', () => {
    const fichier = fichierMigration()

    expect(fichier).toBe('0032_a5_catalogues_versions.sql')
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0032_snapshot.json'))).toBe(true)
    const contenu = lireMigration()
    expect(contenu).toMatch(/ROLLBACK/)
    for (const table of ['configuration_versions', 'usernames_bloques', 'pays', 'devises']) {
      expect(contenu, table).toMatch(new RegExp(`--\\s*DROP TABLE IF EXISTS ${table};`))
    }
    expect(contenu).toMatch(/--\s*DROP TRIGGER IF EXISTS prompts_ia_figer ON prompts_ia;/)
    expect(contenu).toMatch(/--\s*ALTER TABLE prompts_ia DROP COLUMN IF EXISTS cree_par, DROP COLUMN IF EXISTS motif;/)
    expect(contenu).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
  })

  it('should be registered right after 0031 in the drizzle journal, with a later date (or it would never be applied)', () => {
    const { entries } = lireJournal()

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[31]).toMatchObject({ idx: 31, tag: '0031_a4_supervision_reglages' })
    expect(entries[32]).toMatchObject({ idx: 32, tag: '0032_a5_catalogues_versions', breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should delete from the drizzle journal, in its rollback, exactly the `when` of its own journal entry', () => {
    const entree = lireJournal().entries[32]!

    expect(rollbackExecutable().ligneJournal).toBe(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entree.when};`)
  })

  it('should chain its snapshot to the one of 0031 and describe the four new tables and the two prompts columns', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string
      prevId: string
      tables: Record<string, { columns: Record<string, unknown> }>
    }
    const precedent = lire('0031_snapshot.json')
    const courant = lire('0032_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    for (const table of TABLES_A5) {
      expect(Object.keys(courant.tables), table).toContain(`public.${table}`)
      expect(Object.keys(precedent.tables), table).not.toContain(`public.${table}`)
    }
    expect(Object.keys(precedent.tables['public.prompts_ia']!.columns)).not.toContain('motif')
    expect(Object.keys(courant.tables['public.prompts_ia']!.columns)).toEqual(expect.arrayContaining(['motif', 'cree_par']))
  })

  it('should be written to be replayed: every statement is guarded (IF NOT EXISTS, ON CONFLICT, NOT VALID, DROP IF EXISTS)', () => {
    const instructions = instructionsMigration().map((i) => sansCommentaires(i).replace(/\s+/g, ' ').trim())

    expect(instructions.length).toBeGreaterThan(25)
    for (const nu of instructions) {
      if (/^CREATE TABLE/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE (UNIQUE )?INDEX/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD COLUMN/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD CONSTRAINT/.test(nu)) expect(nu, nu).toContain('NOT VALID')
      else if (/^INSERT INTO/.test(nu)) expect(nu, nu).toContain('ON CONFLICT')
      else if (/^UPDATE /.test(nu)) expect(nu, nu).toMatch(/ WHERE .*IS NULL/)
      else if (/^CREATE TRIGGER/.test(nu)) {
        const nom = /^CREATE TRIGGER (\w+)/.exec(nu)![1]!
        expect(lireMigration(), nom).toContain(`DROP TRIGGER IF EXISTS ${nom} ON`)
      } else if (/^CREATE .*FUNCTION/.test(nu)) expect(nu, nu).toMatch(/^CREATE OR REPLACE FUNCTION/)
      else if (/^DO \$\$/.test(nu)) {
        expect(nu, nu).toContain('IF NOT EXISTS (SELECT 1 FROM pg_constraint')
        expect(nu, nu).toContain('NOT VALID')
        expect(nu, nu).toContain('VALIDATE CONSTRAINT')
      }
    }
    for (const nom of ['prompts_ia_motif_check', 'prompts_ia_cree_par_check']) {
      expect(lireMigration(), nom).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS "${nom}"`))
      expect(lireMigration(), nom).toMatch(new RegExp(`VALIDATE CONSTRAINT "${nom}"`))
    }
    for (const nu of instructions) expect(nu, nu).not.toMatch(/^(DROP TABLE|TRUNCATE|DELETE FROM)\b|^ALTER TABLE .* DROP COLUMN/i)
  })

  it('should not touch vitrines: no foreign key from vitrines.pays to the catalogue (old values can never fail the migration)', async () => {
    const code = instructionsMigration().map(sansCommentaires).join('\n')
    const versPays = await db.execute<{ conname: string }>(sql`SELECT conname FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.pays'::regclass`)

    expect(code).not.toMatch(/"vitrines"/)
    expect(versPays.rows).toEqual([])
  })
})

describe('migration 0032 : devises', () => {
  it('should create the table with a text key, a default-true flag and a CHECK on the three codes the product handles', async () => {
    const c = await colonnes('devises')
    const cs = await contraintes('devises')

    expect(Object.keys(c).sort()).toEqual(['actif', 'code', 'modifie_le'])
    expect(c.actif).toMatchObject({ type: 'boolean', nullable: false })
    expect(c.actif?.defaut).toBe('true')
    expect(cs.devises_code_check).toMatchObject({ type: 'c', validee: true })
  })

  it('should hold exactly the currencies of shared/compte.ts (DEVISES), nothing more', async () => {
    const lignes = await db.select({ code: devises.code }).from(devises)

    expect(lignes.map((l) => l.code).sort()).toEqual([...DEVISES].sort())
  })

  it.each(['XOF', 'xaf', '', 'EURO', 'JPY', 'XAF '])('should refuse the currency code %j (23514: XAF, EUR, USD only)', async (code) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(devises).values({ code }))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'devises_code_check' })
    })
  })

  it('should refuse a duplicate code (23505) and the deletion of a currency a country uses (23503)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const doublon = await refus(tx, (sp) => sp.insert(devises).values({ code: 'XAF' }))
      const utilisee = await refus(tx, (sp) => sp.execute(sql`DELETE FROM devises WHERE code = 'XAF'`))

      expect(erreurPostgres(doublon.brute).sqlstate).toBe(UNIQUE_VIOLATION)
      expect(erreurPostgres(utilisee.brute)).toMatchObject({ sqlstate: FK_VIOLATION, contrainte: 'pays_devise_defaut_devises_code_fk' })
    })
  })
})

describe('migration 0032 : pays', () => {
  it('should create the table with typed columns, a text[] list of time zones and a foreign key to the currencies', async () => {
    const c = await colonnes('pays')
    const cs = await contraintes('pays')

    expect(Object.keys(c).sort()).toEqual(['actif', 'canal_email', 'canal_sms', 'canal_whatsapp', 'code', 'devise_defaut', 'fuseaux', 'indicatif', 'libelle', 'modifie_le'])
    expect(c.fuseaux).toMatchObject({ type: 'ARRAY', nullable: false })
    for (const [nom, colonne] of Object.entries(c)) expect(colonne.nullable, nom).toBe(false)
    expect(c.canal_sms?.defaut).toBe('true')
    expect(c.canal_whatsapp?.defaut).toBe('false')
    expect(c.canal_email?.defaut).toBe('true')
    expect(cs.pays_devise_defaut_devises_code_fk).toMatchObject({ type: 'f', validee: true, suppression: 'a' })
    for (const nom of ['pays_code_check', 'pays_libelle_check', 'pays_indicatif_check', 'pays_fuseaux_check']) {
      expect(cs[nom], nom).toMatchObject({ type: 'c', validee: true })
    }
  })

  it('should hold the 30 countries of shared/vitrine.ts (PAYS), same codes and same labels', async () => {
    const lignes = await db.select({ code: pays.code, libelle: pays.libelle }).from(pays)

    const attendu = PAYS.map((p) => ({ code: p.code, libelle: p.label })).sort((a, b) => a.code.localeCompare(b.code))
    expect(lignes.sort((a, b) => a.code.localeCompare(b.code))).toEqual(attendu)
    expect(lignes).toHaveLength(30)
  })

  it('should seed only valid data: a catalogued currency, an indicatif of 1 to 4 digits, and time zones PostgreSQL, Intl and isValidTimeZone all know', async () => {
    const lignes = await db.select().from(pays)
    const connus = await db.execute<{ name: string }>(sql`SELECT name FROM pg_timezone_names`)
    const nomsPostgres = new Set(connus.rows.map((r) => r.name))
    const nomsIntl = new Set(Intl.supportedValuesOf('timeZone'))

    for (const p of lignes) {
      expect([...DEVISES], p.code).toContain(p.deviseDefaut)
      expect(p.indicatif, p.code).toMatch(/^[1-9][0-9]{0,3}$/)
      expect(new Set(p.fuseaux).size, p.code).toBe(p.fuseaux.length)
      for (const fuseau of p.fuseaux) {
        expect(nomsPostgres.has(fuseau), `${p.code} ${fuseau} (PostgreSQL)`).toBe(true)
        expect(nomsIntl.has(fuseau), `${p.code} ${fuseau} (Intl.supportedValuesOf)`).toBe(true)
        expect(isValidTimeZone(fuseau), `${p.code} ${fuseau} (isValidTimeZone)`).toBe(true)
      }
    }
  })

  it('should share +1 between Canada and the United States (the indicatif is NOT unique) and keep the spec fallback zone first', async () => {
    const lignes = await db.select({ code: pays.code, indicatif: pays.indicatif, fuseaux: pays.fuseaux }).from(pays)

    expect(lignes.filter((l) => l.indicatif === '1').map((l) => l.code).sort()).toEqual(['CA', 'US'])
    expect(lignes.find((l) => l.code === 'CA')?.fuseaux[0]).toBe('America/Toronto')
    expect(lignes.find((l) => l.code === 'US')?.fuseaux[0]).toBe('America/New_York')
    expect(lignes.find((l) => l.code === 'CD')?.fuseaux).toEqual(['Africa/Kinshasa', 'Africa/Lubumbashi'])
    expect(lignes.find((l) => l.code === 'CM')?.fuseaux).toEqual(['Africa/Douala'])
  })

  it('should create new countries with the spec defaults: active, SMS and e-mail on, WhatsApp off', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(pays).values(lignePays())

      const [relu] = await tx.select().from(pays).where(sql`${pays.code} = 'ZZ'`)
      expect(relu).toMatchObject({ actif: true, canalSms: true, canalWhatsapp: false, canalEmail: true })
    })
  })

  it.each(['cm', 'CMR', 'C', '', 'C1', 'CM '])('should refuse the country code %j (23514: two uppercase letters)', async (code) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(pays).values(lignePays({ code })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'pays_code_check' })
    })
  })

  it.each(['', 'A', 'a'.repeat(81)])('should refuse the label %j (23514: 2 to 80 characters)', async (libelle) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(pays).values(lignePays({ libelle })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'pays_libelle_check' })
    })
  })

  it.each(['0', '', '+237', '12345', '237 ', '0237', 'abc', '237\n'])('should refuse the indicatif %j (23514: 1 to 4 digits, not starting with 0)', async (indicatif) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(pays).values(lignePays({ indicatif })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'pays_indicatif_check' })
    })
  })

  it.each([
    ['une liste vide', `'{}'::text[]`],
    ['un élément NULL seul', 'ARRAY[NULL]::text[]'],
    ['un élément vide seul', `ARRAY['']::text[]`],
    ['un NULL parmi des fuseaux', `ARRAY['Africa/Douala',NULL]::text[]`],
    ['un élément vide parmi des fuseaux', `ARRAY['Africa/Douala','']::text[]`],
  ])('should refuse %s as the time zones (23514: no NULL hole, no empty zone)', async (_libelle, expression) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.execute(sql`
        INSERT INTO pays (code, libelle, indicatif, devise_defaut, fuseaux) VALUES ('ZZ', 'Pays de test', '999', 'XAF', ${sql.raw(expression)})`))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'pays_fuseaux_check' })
    })
  })

  it('should refuse a SQL NULL list of time zones (23502), an unknown currency (23503) and a duplicate code (23505)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const sansFuseaux = await refus(tx, (sp) => sp.execute(sql`
        INSERT INTO pays (code, libelle, indicatif, devise_defaut, fuseaux) VALUES ('ZZ', 'Pays de test', '999', 'XAF', NULL)`))
      const devise = await refus(tx, (sp) => sp.execute(sql`
        INSERT INTO pays (code, libelle, indicatif, devise_defaut, fuseaux) VALUES ('ZZ', 'Pays de test', '999', 'GNF', ARRAY['Africa/Douala'])`))
      const doublon = await refus(tx, (sp) => sp.insert(pays).values(lignePays({ code: 'CM' })))

      expect(erreurPostgres(sansFuseaux.brute).sqlstate).toBe(NOT_NULL_VIOLATION)
      expect(erreurPostgres(devise.brute)).toMatchObject({ sqlstate: FK_VIOLATION, contrainte: 'pays_devise_defaut_devises_code_fk' })
      expect(erreurPostgres(doublon.brute).sqlstate).toBe(UNIQUE_VIOLATION)
    })
  })

  it('should let an administrator-made change survive: deactivating a country or a channel is a plain UPDATE, nothing in the schema forbids it', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql`UPDATE pays SET actif = false, canal_sms = false, modifie_le = now() WHERE code = 'TD'`)

      const [td] = await tx.select({ actif: pays.actif, canalSms: pays.canalSms }).from(pays).where(sql`${pays.code} = 'TD'`)
      expect(td).toEqual({ actif: false, canalSms: false })
    })
  })
})

describe('migration 0032 : usernames_bloques', () => {
  it('should create the table with a text key, a short motive, a short author (no foreign key) and a date', async () => {
    const c = await colonnes('usernames_bloques')
    const cs = await contraintes('usernames_bloques')

    expect(Object.keys(c).sort()).toEqual(['cree_le', 'cree_par', 'motif', 'valeur'])
    for (const [nom, colonne] of Object.entries(c)) expect(colonne.nullable, nom).toBe(false)
    expect(Object.values(cs).filter((x) => x.type === 'f')).toHaveLength(0)
    for (const nom of ['usernames_bloques_valeur_check', 'usernames_bloques_motif_check', 'usernames_bloques_cree_par_check']) {
      expect(cs[nom], nom).toMatchObject({ type: 'c', validee: true })
    }
  })

  it('should have no seed row in the migration (the code list shared/reserved.ts stays the only source of the reserved words)', () => {
    expect(instructionsMigration().map(sansCommentaires).join('\n')).not.toMatch(/INSERT INTO "usernames_bloques"/)
  })

  it.each(['ab', 'a-b_c9', '9ab', 'a'.repeat(40)])('should accept the name %j', async (valeur) => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(usernamesBloques).values({ valeur, motif: 'Nom réservé à la marque', creePar: 'admin-1' })

      expect(await tx.$count(usernamesBloques)).toBe(1)
    })
  })

  it.each(['A', 'Ab', 'a', '-abc', '_abc', 'ab cd', 'ab.cd', 'ab/cd', 'a'.repeat(41), 'ab\n', ''])('should refuse the name %j (23514: lowercase, 2 to 40 characters)', async (valeur) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(usernamesBloques).values({ valeur, motif: 'Nom réservé à la marque', creePar: 'admin-1' }))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'usernames_bloques_valeur_check' })
    })
  })

  it.each(['', 'abcd', '    ', ' abcd ', 'a'.repeat(201)])('should refuse the motive %j (23514: 5 to 200 characters once trimmed)', async (motif) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(usernamesBloques).values({ valeur: 'marque', motif, creePar: 'admin-1' }))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'usernames_bloques_motif_check' })
    })
  })

  it('should refuse an author longer than 64 characters (23514), accept `systeme`, and refuse a NULL author (23502)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const long = await refus(tx, (sp) => sp.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Nom réservé', creePar: 'a'.repeat(65) }))
      const nul = await refus(tx, (sp) => sp.execute(sql`INSERT INTO usernames_bloques (valeur, motif, cree_par) VALUES ('marque', 'Nom réservé', NULL)`))
      await tx.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Nom réservé', creePar: 'systeme' })

      expect(erreurPostgres(long.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'usernames_bloques_cree_par_check' })
      expect(erreurPostgres(nul.brute).sqlstate).toBe(NOT_NULL_VIOLATION)
    })
  })

  it('should refuse a duplicate name (23505) and let an idempotent insert (ON CONFLICT DO NOTHING) pass', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Nom réservé', creePar: 'admin-1' })

      const doublon = await refus(tx, (sp) => sp.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Autre motif', creePar: 'admin-2' }))
      await tx.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Autre motif', creePar: 'admin-2' }).onConflictDoNothing()

      expect(erreurPostgres(doublon.brute).sqlstate).toBe(UNIQUE_VIOLATION)
      expect(await tx.$count(usernamesBloques)).toBe(1)
    })
  })
})

describe('migration 0032 : configuration_versions (structure, valeurs de départ)', () => {
  it('should create the table with typed columns, only the two optional dates nullable, and every CHECK validated', async () => {
    const c = await colonnes('configuration_versions')
    const cs = await contraintes('configuration_versions')

    expect(Object.keys(c).sort()).toEqual(['categorie', 'cle', 'cree_le', 'cree_par', 'effective_a', 'id', 'motif', 'numero', 'statut', 'valeurs', 'validee_le'])
    expect(Object.entries(c).filter(([, colonne]) => colonne.nullable).map(([nom]) => nom).sort()).toEqual(['effective_a', 'validee_le'])
    expect(c.valeurs).toMatchObject({ type: 'jsonb' })
    expect(c.numero).toMatchObject({ type: 'integer' })
    expect(Object.values(cs).filter((x) => x.type === 'f')).toHaveLength(0)
    const checks = Object.entries(cs).filter(([, x]) => x.type === 'c')
    expect(checks.map(([nom]) => nom).sort()).toEqual([
      'configuration_versions_categorie_check', 'configuration_versions_cle_check', 'configuration_versions_cree_par_check',
      'configuration_versions_effet_check', 'configuration_versions_id_check', 'configuration_versions_motif_check',
      'configuration_versions_numero_check', 'configuration_versions_plan_cle_check', 'configuration_versions_statut_check',
      'configuration_versions_valeurs_check', 'configuration_versions_validee_check',
    ])
    for (const [nom, x] of checks) expect(x.validee, nom).toBe(true)
    expect(cs.configuration_versions_numero_unique).toMatchObject({ type: 'u', validee: true })
  })

  it('should declare the two partial unique indexes (one active, one scheduled per category and key)', async () => {
    const index = await indexDe('configuration_versions')

    expect(index.configuration_versions_active_unique).toMatch(/UNIQUE INDEX .*\(categorie, cle\) WHERE \(statut = 'active'::text\)/)
    expect(index.configuration_versions_programmee_unique).toMatch(/UNIQUE INDEX .*\(categorie, cle\) WHERE \(statut = 'programmee'::text\)/)
  })

  it('should hold the five seed versions of 0032 (the Mercy Pay ones belong to 0034) with their immutable content (numero 1, author `systeme`, dated 2000-01-01)', async () => {
    const resultat = await db.execute<{ id: string, categorie: string, cle: string, numero: number, cree_par: string, effective_a: Date }>(sql`
      SELECT id, categorie, cle, numero, cree_par, effective_a FROM configuration_versions WHERE cree_par = ${EMPREINTE_SEED} AND id IN (${sql.join(Object.values(SEED_IDS).map((id) => sql`${id}`), sql`, `)}) ORDER BY id`)

    expect(resultat.rows.map((r) => [r.id, r.categorie, r.cle, r.numero, r.cree_par])).toEqual([
      [SEED_IDS.frais, 'frais', 'kpay:mobile_money', 1, 'systeme'],
      [SEED_IDS.moyens, 'moyens', 'kpay', 1, 'systeme'],
      [SEED_IDS.gratuit, 'plan', 'gratuit', 1, 'systeme'],
      [SEED_IDS.payant, 'plan', 'payant', 1, 'systeme'],
      [SEED_IDS.prix, 'prix', 'payant', 1, 'systeme'],
    ])
    for (const r of resultat.rows) expect(new Date(r.effective_a).toISOString(), r.id).toBe('2000-01-01T00:00:00.000Z')
  })

  it('should seed the plans with EXACTLY the values of server/config/plans.ts (PLANS) plus the capacities of shared/plans.ts', async () => {
    const mcpPayant = (CAPACITES_PAYANTES as readonly string[]).includes('mcp')

    expect(await lireValeurs(SEED_IDS.gratuit)).toEqual({ ...PLANS.gratuit, capacites: { mcp: false } })
    expect(await lireValeurs(SEED_IDS.payant)).toEqual({ ...PLANS.payant, capacites: { mcp: mcpPayant } })
    expect(mcpPayant).toBe(true)
  })

  it('should seed the price grid with EXACTLY PRIX_PLANS.payant (3 currencies x 1, 3, 12 months)', async () => {
    expect(await lireValeurs(SEED_IDS.prix)).toEqual(PRIX_PLANS.payant)
  })

  it('should seed the fees with EXACTLY FRAIS_PAIEMENT.kpay.mobile_money', async () => {
    expect(await lireValeurs(SEED_IDS.frais)).toEqual(FRAIS_PAIEMENT.kpay?.mobile_money)
  })

  it('should seed the active payment methods with EXACTLY the active entries of MOYENS_PAIEMENT', async () => {
    const seed = await lireValeurs(SEED_IDS.moyens) as { actifs: string[] }
    // P1 (0033/0034) : la v1 de 0032 ne couvre que K-PAY ; les moyens d'un autre fournisseur ont leur propre clé (0034).
    const actifsDuCode = MOYENS_PAIEMENT.filter((m) => m.actif && m.fournisseur === 'kpay')

    expect(Object.keys(seed)).toEqual(['actifs'])
    expect([...seed.actifs].sort()).toEqual(actifsDuCode.map((m) => m.id).sort())
    expect(actifsDuCode.length).toBeGreaterThan(0)
  })

  it('should serve the real queries by the right index: active version of a key, scheduled versions due, history of a key', async () => {
    const active = await planSansBalayageSequentiel(sql`SELECT valeurs FROM configuration_versions WHERE categorie = 'plan' AND cle = 'gratuit' AND statut = 'active'`)
    const echues = await planSansBalayageSequentiel(sql`SELECT id FROM configuration_versions WHERE statut = 'programmee' AND effective_a <= now()`)
    const historique = await planSansBalayageSequentiel(sql`SELECT id FROM configuration_versions WHERE categorie = 'plan' AND cle = 'gratuit' ORDER BY numero DESC`)

    expect(active).toContain('configuration_versions_active_unique')
    expect(echues).toContain('configuration_versions_programmee_unique')
    expect(historique).toContain('configuration_versions_numero_unique')
  })
})

describe('migration 0032 : configuration_versions (contraintes)', () => {
  const CAS: Array<[string, Partial<typeof configurationVersions.$inferInsert>, string]> = [
    ['un identifiant de 7 caractères', { id: 'abcdefg' }, 'configuration_versions_id_check'],
    ['un identifiant de 65 caractères', { id: 'a'.repeat(65) }, 'configuration_versions_id_check'],
    ['une catégorie inconnue', { categorie: 'autre' }, 'configuration_versions_categorie_check'],
    ['une catégorie en majuscules', { categorie: 'PLAN' }, 'configuration_versions_categorie_check'],
    ['une clé en majuscules', { cle: 'Essai' }, 'configuration_versions_cle_check'],
    ['une clé vide', { cle: '' }, 'configuration_versions_cle_check'],
    ['une clé de 61 caractères', { cle: 'a'.repeat(61) }, 'configuration_versions_cle_check'],
    ['une clé avec une espace', { cle: 'a b' }, 'configuration_versions_cle_check'],
    ['un numéro nul', { numero: 0 }, 'configuration_versions_numero_check'],
    ['un numéro négatif', { numero: -1 }, 'configuration_versions_numero_check'],
    ['des valeurs en tableau', { valeurs: [] }, 'configuration_versions_valeurs_check'],
    ['des valeurs en texte', { valeurs: 'texte' }, 'configuration_versions_valeurs_check'],
    ['des valeurs en nombre', { valeurs: 5 }, 'configuration_versions_valeurs_check'],
    ['un statut inconnu', { statut: 'archivee' }, 'configuration_versions_statut_check'],
    ['un statut en majuscules', { statut: 'ACTIVE' }, 'configuration_versions_statut_check'],
    ['un motif de 4 caractères', { motif: 'abcd' }, 'configuration_versions_motif_check'],
    ['un motif d\'espaces', { motif: '      ' }, 'configuration_versions_motif_check'],
    ['un motif de 501 caractères', { motif: 'a'.repeat(501) }, 'configuration_versions_motif_check'],
    ['un auteur de 65 caractères', { creePar: 'a'.repeat(65) }, 'configuration_versions_cree_par_check'],
    ['une clé de plan hors gratuit et payant', { categorie: 'plan', cle: 'entreprise' }, 'configuration_versions_plan_cle_check'],
    ['un brouillon avec une date d\'effet', { statut: 'brouillon', effectiveA: new Date() }, 'configuration_versions_effet_check'],
    ['une version active sans date d\'effet', { statut: 'active', effectiveA: null }, 'configuration_versions_effet_check'],
    ['une version programmée sans date d\'effet', { statut: 'programmee', effectiveA: null }, 'configuration_versions_effet_check'],
    ['une version remplacée sans date d\'effet', { statut: 'remplacee', effectiveA: null }, 'configuration_versions_effet_check'],
    ['une validation sur une catégorie qui n\'est pas un prix', { categorie: 'moyens', valideeLe: new Date() }, 'configuration_versions_validee_check'],
    ['une validation sur un plan', { categorie: 'plan', cle: 'gratuit', statut: 'remplacee', numero: 9, valideeLe: new Date() }, 'configuration_versions_validee_check'],
  ]

  it.each(CAS)('should refuse %s (23514)', async (_libelle, surcharges, contrainte) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(configurationVersions).values(ligneVersion(surcharges)))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte })
    })
  })

  it('should refuse a JSON null as the values (23514, not a NULL that slips through) and a SQL NULL (23502)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const jsonNull = await refus(tx, (sp) => sp.execute(sql`
        INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
        VALUES ('test-json-null', 'moyens', 'essai', 1, 'null'::jsonb, 'active', now(), 'Version de test', 'test')`))
      const sqlNull = await refus(tx, (sp) => sp.execute(sql`
        INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
        VALUES ('test-sql-null', 'moyens', 'essai', 1, NULL, 'active', now(), 'Version de test', 'test')`))

      expect(erreurPostgres(jsonNull.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'configuration_versions_valeurs_check' })
      expect(erreurPostgres(sqlNull.brute).sqlstate).toBe(NOT_NULL_VIOLATION)
    })
  })

  it('should accept a draft without date, a validated price, and every valid status with its date', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(configurationVersions).values(ligneVersion({ statut: 'brouillon', effectiveA: null, numero: 1 }))
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'prix', cle: 'essai', valideeLe: new Date(), numero: 1 }))
      await tx.insert(configurationVersions).values(ligneVersion({ statut: 'programmee', effectiveA: new Date(Date.now() + 86_400_000), numero: 2 }))
      await tx.insert(configurationVersions).values(ligneVersion({ statut: 'remplacee', numero: 3 }))

      expect(await tx.$count(configurationVersions, sql`${configurationVersions.cle} = 'essai'`)).toBe(4)
    })
  })

  it('should allow ONE active version per (category, key): a second one is refused (23505), the other keys are independent', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const doublon = await refus(tx, (sp) => sp.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 2 })))
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'moyens', cle: 'autre', numero: 1 }))

      expect(erreurPostgres(doublon.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_active_unique' })
    })
  })

  it('should allow ONE scheduled version per (category, key) next to the active one, and any number of drafts', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const demain = new Date(Date.now() + 86_400_000)
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 2, statut: 'programmee', effectiveA: demain }))

      const seconde = await refus(tx, (sp) => sp.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 3, statut: 'programmee', effectiveA: demain })))
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 4, statut: 'brouillon', effectiveA: null }))
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 5, statut: 'brouillon', effectiveA: null }))

      expect(erreurPostgres(seconde.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_programmee_unique' })
    })
  })

  it('should refuse the same version number twice for a key (23505), whatever the status', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 1, statut: 'remplacee' })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_numero_unique' })
    })
  })

  it('should keep the seed insert idempotent: ON CONFLICT DO NOTHING on an existing id, number or active version inserts nothing', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await tx.$count(configurationVersions)

      await tx.insert(configurationVersions).values(ligneVersion({ id: SEED_IDS.gratuit, categorie: 'plan', cle: 'gratuit', numero: 1 })).onConflictDoNothing()
      await tx.insert(configurationVersions).values(ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 7 })).onConflictDoNothing()

      expect(await tx.$count(configurationVersions)).toBe(avant)
    })
  })
})

describe('migration 0032 : configuration_versions (déclencheur de protection, CA14)', () => {
  const FIGES: Array<[string, string]> = [
    ['valeurs', `valeurs = '{"actifs":["x"]}'::jsonb`],
    ['motif', `motif = 'Un autre motif valide'`],
    ['cree_par', `cree_par = 'autre'`],
    ['cree_le', `cree_le = cree_le + interval '1 second'`],
    ['numero', 'numero = numero + 100'],
    ['cle', `cle = 'autre'`],
    ['categorie', `categorie = 'frais'`],
  ]

  it('should be installed: a row trigger on UPDATE and DELETE and a statement trigger on TRUNCATE, both enabled', async () => {
    const t = await declencheurs('configuration_versions')

    expect(t).toEqual({ configuration_versions_proteger: 'O', configuration_versions_sans_vidage: 'O' })
  })

  it.each(FIGES)('should refuse to change the frozen column %s (42501)', async (_colonne, affectation) => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = ligneVersion()
      await tx.insert(configurationVersions).values(ligne)

      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET ${sql.raw(affectation)} WHERE id = ${ligne.id}`))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(messageSql(erreur)).toContain('contenu figé')
    })
  })

  it('should refuse to change the values of a SEED version (42501) and keep them intact', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await tx.execute<{ valeurs: unknown }>(sql`SELECT valeurs FROM configuration_versions WHERE id = ${SEED_IDS.gratuit}`)

      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET valeurs = jsonb_set(valeurs, '{services}', '99') WHERE id = ${SEED_IDS.gratuit}`))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      const apres = await tx.execute<{ valeurs: unknown }>(sql`SELECT valeurs FROM configuration_versions WHERE id = ${SEED_IDS.gratuit}`)
      expect(apres.rows[0]?.valeurs).toEqual(avant.rows[0]?.valeurs)
    })
  })

  it('should let the status walk the documented path (draft, scheduled, active, replaced, active again for a rollback) and a no-op UPDATE pass', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = ligneVersion({ statut: 'brouillon', effectiveA: null })
      await tx.insert(configurationVersions).values(ligne)
      const lire = async () => (await tx.execute<{ statut: string }>(sql`SELECT statut FROM configuration_versions WHERE id = ${ligne.id}`)).rows[0]?.statut

      await tx.execute(sql`UPDATE configuration_versions SET statut = 'programmee', effective_a = now() + interval '1 day' WHERE id = ${ligne.id}`)
      expect(await lire()).toBe('programmee')
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'active' WHERE id = ${ligne.id}`)
      expect(await lire()).toBe('active')
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ligne.id}`)
      expect(await lire()).toBe('remplacee')
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'active' WHERE id = ${ligne.id}`)
      expect(await lire()).toBe('active')
      await tx.execute(sql`UPDATE configuration_versions SET statut = statut, valeurs = valeurs WHERE id = ${SEED_IDS.gratuit}`)
    })
  })

  it('should freeze the date of effect once set (42501) but let a draft receive it', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = ligneVersion({ statut: 'programmee', effectiveA: new Date(Date.now() + 86_400_000) })
      await tx.insert(configurationVersions).values(ligne)

      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET effective_a = now() + interval '2 days' WHERE id = ${ligne.id}`))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should let a price be validated ONCE (NULL to a date), then freeze the validation date (42501)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = ligneVersion({ categorie: 'prix', cle: 'essai' })
      await tx.insert(configurationVersions).values(ligne)

      await tx.execute(sql`UPDATE configuration_versions SET validee_le = '2026-11-14T10:00:00Z' WHERE id = ${ligne.id}`)
      await tx.execute(sql`UPDATE configuration_versions SET validee_le = '2026-11-14T10:00:00Z' WHERE id = ${ligne.id}`)
      const autreDate = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET validee_le = '2026-11-15T10:00:00Z' WHERE id = ${ligne.id}`))
      const retrait = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET validee_le = NULL WHERE id = ${ligne.id}`))

      expect(erreurPostgres(autreDate.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres(retrait.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should still refuse to validate something that is not a price (23514 from the CHECK, the trigger lets the first NULL-to-date through)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET validee_le = now() WHERE id = ${SEED_IDS.gratuit}`))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'configuration_versions_validee_check' })
    })
  })

  it('should refuse DELETE (42501), a seed included, and keep every row', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = ligneVersion()
      await tx.insert(configurationVersions).values(ligne)
      const avant = await tx.$count(configurationVersions)

      const suppression = await refus(tx, (sp) => sp.execute(sql`DELETE FROM configuration_versions WHERE id = ${ligne.id}`))
      const graine = await refus(tx, (sp) => sp.execute(sql`DELETE FROM configuration_versions WHERE id = ${SEED_IDS.prix}`))
      const tout = await refus(tx, (sp) => sp.execute(sql`DELETE FROM configuration_versions`))

      for (const erreur of [suppression, graine, tout]) {
        expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
        expect(messageSql(erreur)).toContain('suppression interdite')
      }
      expect(await tx.$count(configurationVersions)).toBe(avant)
    })
  })

  it('should refuse TRUNCATE (42501), with or without CASCADE, and keep every row', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await tx.$count(configurationVersions)

      const simple = await refus(tx, (sp) => sp.execute(sql`TRUNCATE TABLE configuration_versions`))
      const cascade = await refus(tx, (sp) => sp.execute(sql`TRUNCATE TABLE configuration_versions CASCADE`))

      for (const erreur of [simple, cascade]) expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(await tx.$count(configurationVersions)).toBe(avant)
    })
  })
})

describe('migration 0032 : prompts_ia (versionnage)', () => {
  it('should add `motif` and `cree_par` as nullable text and keep the existing columns', async () => {
    const c = await colonnes('prompts_ia')

    expect(c.motif).toMatchObject({ type: 'text', nullable: true, defaut: null })
    expect(c.cree_par).toMatchObject({ type: 'text', nullable: true, defaut: null })
    expect(Object.keys(c).sort()).toEqual(['actif', 'created_at', 'cree_par', 'gabarit', 'id', 'motif', 'parametres', 'schema_sortie', 'systeme', 'type', 'variables', 'version'])
  })

  it('should have filled the motive of the four historical prompts and left their author NULL', async () => {
    const resultat = await db.execute<{ type: string, version: number, motif: string | null, cree_par: string | null }>(sql`
      SELECT type, version, motif, cree_par FROM prompts_ia ORDER BY type, version`)
    const historiques = resultat.rows.filter((r) => PROMPTS_HISTORIQUES.some(([type, version]) => type === r.type && version === r.version))

    expect(historiques).toHaveLength(PROMPTS_HISTORIQUES.length)
    for (const r of historiques) expect(r, `${r.type} v${r.version}`).toMatchObject({ motif: MOTIF_HISTORIQUE, cree_par: null })
  })

  it('should declare the two CHECK constraints, validated', async () => {
    const cs = await contraintes('prompts_ia')

    expect(cs.prompts_ia_motif_check).toMatchObject({ type: 'c', validee: true })
    expect(cs.prompts_ia_cree_par_check).toMatchObject({ type: 'c', validee: true })
  })

  it('should keep accepting a prompt written WITHOUT motive or author (NULL admitted, existing code paths are not broken)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(promptsIa).values(lignePrompt())
      await tx.insert(promptsIa).values(lignePrompt({ version: 99, motif: 'Raccourcir les accroches', creePar: 'admin-1' }))

      expect(await tx.$count(promptsIa, sql`${promptsIa.version} >= 98`)).toBe(2)
    })
  })

  it.each(['', 'abcd', '    ', ' abcd ', 'a'.repeat(501)])('should refuse the motive %j (23514: 5 to 500 characters once trimmed, or NULL)', async (motif) => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(promptsIa).values(lignePrompt({ motif })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'prompts_ia_motif_check' })
    })
  })

  it('should refuse an author longer than 64 characters (23514)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, (sp) => sp.insert(promptsIa).values(lignePrompt({ creePar: 'a'.repeat(65) })))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'prompts_ia_cree_par_check' })
    })
  })

  it('should keep the existing guarantees: one active prompt per type (23505), version unique per type', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const deuxActifs = await refus(tx, (sp) => sp.insert(promptsIa).values(lignePrompt({ actif: true })))
      const memeVersion = await refus(tx, (sp) => sp.insert(promptsIa).values(lignePrompt({ version: 1 })))

      expect(erreurPostgres(deuxActifs.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'prompts_ia_type_actif_unique' })
      expect(erreurPostgres(memeVersion.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'prompts_ia_type_version_unique' })
    })
  })
})

describe('migration 0032 : prompts_ia (déclencheur de contenu figé, CA08)', () => {
  const FIGES: Array<[string, string]> = [
    ['systeme', `systeme = 'Texte corrigé à la main'`],
    ['gabarit', `gabarit = 'Autre gabarit {{donnees}}'`],
    ['variables', `variables = ARRAY[]::text[]`],
    ['parametres', `parametres = '{"maxTokens":1}'::jsonb`],
    ['schema_sortie', `schema_sortie = 'autre_schema_v1'`],
    ['type', `type = 'seo_vitrine'`],
    ['version', 'version = version + 1'],
    ['created_at', `created_at = created_at + interval '1 second'`],
  ]

  it('should be installed and enabled', async () => {
    expect(await declencheurs('prompts_ia')).toEqual({ prompts_ia_figer: 'O' })
  })

  it.each(FIGES)('should refuse to change the frozen column %s of a prompt (42501)', async (_colonne, affectation) => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = lignePrompt({ version: 97 })
      await tx.insert(promptsIa).values(ligne)

      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE prompts_ia SET ${sql.raw(affectation)} WHERE id = ${ligne.id}`))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(messageSql(erreur)).toContain('contenu figé')
    })
  })

  it('should refuse to correct the text of an ACTIVE historical prompt by hand (42501) and keep it as it was', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const avant = await tx.execute<{ systeme: string }>(sql`SELECT systeme FROM prompts_ia WHERE type = 'onboarding_vitrine' AND actif`)

      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE prompts_ia SET systeme = 'Texte corrigé à la main' WHERE type = 'onboarding_vitrine' AND actif`))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      const apres = await tx.execute<{ systeme: string }>(sql`SELECT systeme FROM prompts_ia WHERE type = 'onboarding_vitrine' AND actif`)
      expect(apres.rows).toEqual(avant.rows)
    })
  })

  it('should let the activation swap through (deactivate the old one, activate the new one in one transaction) and a no-op UPDATE pass', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = lignePrompt({ version: 96 })
      await tx.insert(promptsIa).values(ligne)

      await tx.execute(sql`UPDATE prompts_ia SET actif = false WHERE type = 'ameliorer_texte' AND actif`)
      await tx.execute(sql`UPDATE prompts_ia SET actif = true WHERE id = ${ligne.id}`)
      await tx.execute(sql`UPDATE prompts_ia SET systeme = systeme, gabarit = gabarit WHERE id = ${ligne.id}`)

      const actifs = await tx.execute<{ id: string }>(sql`SELECT id FROM prompts_ia WHERE type = 'ameliorer_texte' AND actif`)
      expect(actifs.rows.map((r) => r.id)).toEqual([ligne.id])
    })
  })

  it('should refuse DELETE (42501), historical prompts included (generations_ia.prompt_id references them)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = lignePrompt({ version: 95 })
      await tx.insert(promptsIa).values(ligne)
      const avant = await tx.$count(promptsIa)

      const neuf = await refus(tx, (sp) => sp.execute(sql`DELETE FROM prompts_ia WHERE id = ${ligne.id}`))
      const historique = await refus(tx, (sp) => sp.execute(sql`DELETE FROM prompts_ia WHERE type = 'onboarding_vitrine' AND version = 1`))

      for (const erreur of [neuf, historique]) {
        expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
        expect(messageSql(erreur)).toContain('suppression interdite')
      }
      expect(await tx.$count(promptsIa)).toBe(avant)
    })
  })
})

describe('migration 0032 : parité entre le schéma Drizzle et la base', () => {
  it.each([
    ['devises', devises],
    ['pays', pays],
    ['usernames_bloques', usernamesBloques],
    ['configuration_versions', configurationVersions],
    ['prompts_ia', promptsIa],
  ] as const)('should declare in Drizzle exactly the columns of the table %s', async (nom, table) => {
    const enBase = Object.keys(await colonnes(nom)).sort()
    const enDrizzle = getTableConfig(table).columns.map((c) => c.name).sort()

    expect(enDrizzle).toEqual(enBase)
  })

  it.each([
    ['devises', devises, ['devises_code_check']],
    ['pays', pays, ['pays_code_check', 'pays_fuseaux_check', 'pays_indicatif_check', 'pays_libelle_check']],
    ['usernames_bloques', usernamesBloques, ['usernames_bloques_cree_par_check', 'usernames_bloques_motif_check', 'usernames_bloques_valeur_check']],
  ] as const)('should declare in Drizzle the CHECK constraints of %s, under the names used in the database', async (nom, table, attendus) => {
    const enDrizzle = getTableConfig(table).checks.map((c) => c.name).sort()
    const enBase = Object.entries(await contraintes(nom)).filter(([, c]) => c.type === 'c').map(([n]) => n).sort()

    expect(enDrizzle).toEqual([...attendus])
    expect(enBase).toEqual([...attendus])
  })

  it('should declare in Drizzle the CHECK constraints, indexes and unique constraint of configuration_versions, under the database names', async () => {
    const config = getTableConfig(configurationVersions)
    const checksEnBase = Object.entries(await contraintes('configuration_versions')).filter(([, c]) => c.type === 'c').map(([n]) => n).sort()
    const index = await indexDe('configuration_versions')

    expect(config.checks.map((c) => c.name).sort()).toEqual(checksEnBase)
    expect(config.indexes.map((i) => i.config.name).sort()).toEqual(['configuration_versions_active_unique', 'configuration_versions_programmee_unique'])
    expect(config.uniqueConstraints.map((u) => u.name)).toEqual(['configuration_versions_numero_unique'])
    for (const nom of ['configuration_versions_active_unique', 'configuration_versions_programmee_unique']) expect(Object.keys(index), nom).toContain(nom)
  })

  it('should declare in Drizzle the two CHECK constraints added to prompts_ia and the foreign key of pays', async () => {
    const noms = getTableConfig(promptsIa).checks.map((c) => c.name)

    expect(noms).toEqual(expect.arrayContaining(['prompts_ia_motif_check', 'prompts_ia_cree_par_check']))
    expect(getTableConfig(pays).foreignKeys.map((f) => f.getName())).toEqual(['pays_devise_defaut_devises_code_fk'])
  })
})

describe('migration 0032 : rejouabilité et ROLLBACK documenté (montée, retour, remontée)', () => {
  it('should replay twice without error, without recreating a replaced v1, and without overwriting an administrator change', async () => {
    await dansTransactionAnnulee(async (tx) => {
      // L'administration a déjà travaillé : v1 des services gratuits remplacée par une v2, un pays désactivé, un nom bloqué, une devise coupée.
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${SEED_IDS.gratuit}`)
      const v2 = ligneVersion({ categorie: 'plan', cle: 'gratuit', numero: 2, valeurs: { ...PLANS.gratuit, services: 5, capacites: { mcp: false } }, creePar: 'admin-1' })
      await tx.insert(configurationVersions).values(v2)
      await tx.execute(sql`UPDATE pays SET canal_sms = false, actif = false WHERE code = 'CM'`)
      await tx.execute(sql`UPDATE devises SET actif = false WHERE code = 'EUR'`)
      await tx.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Nom réservé', creePar: 'admin-1' })
      await tx.execute(sql`UPDATE prompts_ia SET motif = 'Motif corrigé par un administrateur' WHERE type = 'seo_vitrine' AND version = 1`)

      await rejouer(tx)
      await rejouer(tx)

      const versions = await tx.execute<{ id: string, statut: string }>(sql`SELECT id, statut FROM configuration_versions WHERE categorie = 'plan' AND cle = 'gratuit' ORDER BY numero`)
      expect(versions.rows).toEqual([{ id: SEED_IDS.gratuit, statut: 'remplacee' }, { id: v2.id, statut: 'active' }])
      expect(await tx.$count(configurationVersions, sql`${configurationVersions.cle} = 'gratuit' AND ${configurationVersions.statut} = 'active'`)).toBe(1)
      const [cm] = await tx.select({ sms: pays.canalSms, actif: pays.actif }).from(pays).where(sql`${pays.code} = 'CM'`)
      const [eur] = await tx.select({ actif: devises.actif }).from(devises).where(sql`${devises.code} = 'EUR'`)
      expect(cm).toEqual({ sms: false, actif: false })
      expect(eur).toEqual({ actif: false })
      expect(await tx.$count(usernamesBloques)).toBe(1)
      expect(await tx.$count(pays)).toBe(30)
      expect(await tx.$count(devises)).toBe(3)
      const motif = await tx.execute<{ motif: string }>(sql`SELECT motif FROM prompts_ia WHERE type = 'seo_vitrine' AND version = 1`)
      expect(motif.rows[0]?.motif).toBe('Motif corrigé par un administrateur')
    })
  })

  it('should keep every constraint validated, the triggers enabled and effective, and no duplicate foreign key after a replay', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await rejouer(tx)

      for (const table of [...TABLES_A5, 'prompts_ia']) {
        const cs = await contraintes(table, tx)
        for (const [nom, c] of Object.entries(cs)) expect(c.validee, `${table}.${nom}`).toBe(true)
      }
      expect(Object.keys(await contraintes('pays', tx)).filter((n) => n.endsWith('_fk'))).toEqual(['pays_devise_defaut_devises_code_fk'])
      expect(await declencheurs('configuration_versions', tx)).toEqual({ configuration_versions_proteger: 'O', configuration_versions_sans_vidage: 'O' })
      expect(await declencheurs('prompts_ia', tx)).toEqual({ prompts_ia_figer: 'O' })
      const erreur = await refus(tx, (sp) => sp.execute(sql`UPDATE configuration_versions SET motif = 'Un autre motif valide' WHERE id = ${SEED_IDS.gratuit}`))
      expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should run its documented ROLLBACK, then be re-applied (up, down, up), restoring pristine seed data', async () => {
    const { instructions } = rollbackExecutable()
    const avant = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM prompts_ia`)).rows[0]!.n

    await dansTransactionAnnulee(async (tx) => {
      // Retour : tout A5 disparaît, les prompts RESTENT (sans leurs deux colonnes), leur déclencheur et ses fonctions sont retirés.
      for (const instruction of instructions) await tx.execute(sql.raw(instruction))
      for (const table of TABLES_A5) expect((await tx.execute<{ p: string | null }>(sql`SELECT to_regclass(${`public.${table}`}) AS p`)).rows[0]?.p, table).toBeNull()
      const colonnesPrompts = await tx.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'prompts_ia'`)
      expect(colonnesPrompts.rows.map((r) => r.column_name)).not.toEqual(expect.arrayContaining(['motif']))
      expect(colonnesPrompts.rows.map((r) => r.column_name)).not.toContain('cree_par')
      const fonctions = await tx.execute<{ proname: string }>(sql`SELECT proname FROM pg_proc WHERE proname IN ('prompts_ia_figer','configuration_versions_proteger')`)
      expect(fonctions.rows).toEqual([])
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM prompts_ia`)).rows[0]?.n).toBe(avant)
      // Un prompt n'est plus figé : l'ancien comportement est rétabli.
      await tx.execute(sql`UPDATE prompts_ia SET systeme = systeme WHERE type = 'seo_vitrine'`)

      // Remontée : la migration se rejoue sur la base revenue en arrière et recrée l'état de départ.
      await rejouer(tx)
      for (const table of TABLES_A5) expect((await tx.execute<{ p: string | null }>(sql`SELECT to_regclass(${`public.${table}`}) AS p`)).rows[0]?.p, table).not.toBeNull()
      expect(await tx.$count(devises)).toBe(3)
      expect(await tx.$count(pays)).toBe(30)
      expect(await tx.$count(usernamesBloques)).toBe(0)
      const versions = await tx.execute<{ id: string, statut: string, validee_le: Date | null }>(sql`SELECT id, statut, validee_le FROM configuration_versions ORDER BY id`)
      expect(versions.rows).toEqual([
        { id: SEED_IDS.frais, statut: 'active', validee_le: null },
        { id: SEED_IDS.moyens, statut: 'active', validee_le: null },
        { id: SEED_IDS.gratuit, statut: 'active', validee_le: null },
        { id: SEED_IDS.payant, statut: 'active', validee_le: null },
        { id: SEED_IDS.prix, statut: 'active', validee_le: null },
      ])
      const historiques = await tx.execute<{ motif: string | null, cree_par: string | null }>(sql`SELECT motif, cree_par FROM prompts_ia ORDER BY type, version`)
      expect(historiques.rows.filter((r) => r.motif === MOTIF_HISTORIQUE)).toHaveLength(PROMPTS_HISTORIQUES.length)
      expect(await declencheurs('prompts_ia', tx)).toEqual({ prompts_ia_figer: 'O' })
      expect(await declencheurs('configuration_versions', tx)).toEqual({ configuration_versions_proteger: 'O', configuration_versions_sans_vidage: 'O' })
      // État neuf des pays et des devises : valeurs de la spec, canaux par défaut.
      const cm = await tx.select().from(pays).where(sql`${pays.code} = 'CM'`)
      expect(cm[0]).toMatchObject({ libelle: 'Cameroun', indicatif: '237', deviseDefaut: 'XAF', fuseaux: ['Africa/Douala'], actif: true, canalSms: true, canalWhatsapp: false, canalEmail: true })
      expect((await tx.select({ code: devises.code, actif: devises.actif }).from(devises)).every((d) => d.actif)).toBe(true)
    })

    // La base partagée est intacte : les tables A5 et les triggers existent, rien n'a été perdu.
    expect(await existe('configuration_versions')).toBe(true)
    expect(await existe('pays')).toBe(true)
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM prompts_ia`)).rows[0]?.n).toBe(avant)
    expect(await declencheurs('prompts_ia')).toEqual({ prompts_ia_figer: 'O' })
  })

  it('should REFUSE its rollback (P0001, nothing changed) when a version created after the migration exists', async () => {
    const garde = rollbackExecutable().instructions.find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await tx.insert(configurationVersions).values(ligneVersion({ creePar: 'admin-1' }))

      const erreur = await refus(tx, (sp) => sp.execute(sql.raw(garde)))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
      expect(messageSql(erreur)).toContain('rollback 0032 refuse')
      expect(await existe('configuration_versions', tx)).toBe(true)
    })
  })

  it('should REFUSE its rollback (P0001) when a blocked name exists, and let it through on the pristine state', async () => {
    const garde = rollbackExecutable().instructions.find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql.raw(garde))
      await tx.insert(usernamesBloques).values({ valeur: 'marque', motif: 'Nom réservé', creePar: 'admin-1' })

      const erreur = await refus(tx, (sp) => sp.execute(sql.raw(garde)))

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
  })
})
