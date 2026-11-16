import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { battementsSysteme, capacitesAccordees, envoisCodes, generationsIa, reglages } from '../../shared/db/schema'
import { MOTIFS_REPLI } from '../../shared/ia'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'
import { createUser } from './support/fabriques'

// A4 §3 : migration 0031 (registre des réglages, capacités accordées, journal d'envoi des codes, battements du système,
// motif de repli `ia_coupee`). État de la base APRÈS la migration, lu dans les catalogues PostgreSQL (jouée par le
// globalSetup sur la vraie base de test), contraintes éprouvées par des écritures réelles, puis REJOUABILITÉ et
// montée / ROLLBACK documenté / remontée (dans une transaction annulée : la base partagée n'en garde aucune trace).
// `envois_codes` et `battements_systeme` n'ont aucune clé étrangère : le TRUNCATE ... CASCADE de tests/integration/setup.ts
// ne les atteint pas, d'où le nettoyage explicite ci-dessous (reglages et capacites_accordees tombent avec `users`).

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
// ON DELETE RESTRICT lève restrict_violation (23001) ; NO ACTION et une insertion orpheline lèvent foreign_key_violation (23503).
const RESTRICT_VIOLATION = '23001'
const NOT_NULL_VIOLATION = '23502'
const GENERATED_ALWAYS = '428C9'
const EMPREINTE = 'a'.repeat(64)
const ANNULATION = new Error('annulation volontaire de la transaction de test')
const TABLES_A4 = ['reglages', 'capacites_accordees', 'envois_codes', 'battements_systeme'] as const

type Executeur = { execute: (requete: ReturnType<typeof sql.raw>) => PromiseLike<unknown> }

function fichierMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0031_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0031 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
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

interface Colonne {
  type: string
  nullable: boolean
  defaut: string | null
  identite: string
}

async function colonnes(table: string): Promise<Record<string, Colonne>> {
  const resultat = await db.execute<{ column_name: string, data_type: string, is_nullable: string, column_default: string | null, identity_generation: string | null }>(sql`
    SELECT column_name, data_type, is_nullable, column_default, identity_generation FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.column_name, {
    type: r.data_type, nullable: r.is_nullable === 'YES', defaut: r.column_default, identite: r.identity_generation ?? '',
  }]))
}

interface Contrainte {
  type: string
  validee: boolean
  definition: string
  suppression: string
}

async function contraintes(table: string): Promise<Record<string, Contrainte>> {
  const resultat = await db.execute<{ conname: string, contype: string, convalidated: boolean, def: string, confdeltype: string }>(sql`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def, confdeltype FROM pg_constraint
    WHERE conrelid = ${`public.${table}`}::regclass`)
  return Object.fromEntries(resultat.rows.map((r) => [r.conname, { type: r.contype, validee: r.convalidated, definition: r.def, suppression: r.confdeltype }]))
}

async function indexDe(table: string): Promise<Record<string, string>> {
  const resultat = await db.execute<{ indexname: string, indexdef: string }>(sql`
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

/** Valeurs entre apostrophes d'une CHECK de la base (liste IN (...)), dans l'ordre de la définition. */
async function valeursCheck(table: string, nom: string): Promise<string[]> {
  const c = (await contraintes(table))[nom]
  if (!c) throw new Error(`Contrainte ${nom} absente de ${table}.`)
  return [...c.definition.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!)
}

async function existeTable(nom: string): Promise<boolean> {
  const resultat = await db.execute<{ present: string | null }>(sql`SELECT to_regclass(${`public.${nom}`}) AS present`)
  return resultat.rows[0]?.present !== null
}

/** Instructions exécutables de la migration (chaque bloc entre deux séparateurs, sans les blocs entièrement commentés). */
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
  if (debut === -1 || fin === -1 || fin < debut) throw new Error('Bloc ROLLBACK (-- BEGIN; … -- COMMIT;) introuvable dans 0031.')
  const corps = lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').replace(/\s+--\s.*$/, '').trim())
  return {
    instructions: corps.filter((l) => l !== '' && !l.startsWith('DELETE FROM drizzle.')),
    ligneJournal: corps.find((l) => l.startsWith('DELETE FROM drizzle.')),
  }
}

async function generation(statut: string, motif: string | null, userId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO generations_ia (id, user_id, type, statut, motif_repli, entree_empreinte, terminee_le)
    VALUES (${randomUUID()}, ${userId}, 'onboarding_vitrine', ${statut}, ${motif},
      ${EMPREINTE}, ${statut === 'repli' || statut === 'terminee' ? new Date() : null})`)
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM envois_codes`)
  await db.execute(sql`DELETE FROM battements_systeme`)
})

describe('migration 0031 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, and carry the commented manual rollback', () => {
    const fichier = fichierMigration()

    expect(fichier).toBe('0031_a4_supervision_reglages.sql')
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0031_snapshot.json'))).toBe(true)
    const contenu = lireMigration()
    expect(contenu).toMatch(/ROLLBACK/)
    for (const table of TABLES_A4) expect(contenu, table).toMatch(new RegExp(`--\\s*DROP TABLE IF EXISTS ${table};`))
    expect(contenu).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
  })

  it('should be registered right after 0030 in the drizzle journal, with a later date (or it would never be applied)', () => {
    const { entries } = lireJournal()

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[30]).toMatchObject({ idx: 30, tag: '0030_a3_paiements_admin' })
    expect(entries[31]).toMatchObject({ idx: 31, tag: '0031_a4_supervision_reglages', breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should delete from the drizzle journal, in its rollback, exactly the `when` of its own journal entry', () => {
    const entree = lireJournal().entries[31]!

    expect(rollbackExecutable().ligneJournal).toBe(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entree.when};`)
  })

  it('should chain its snapshot to the one of 0030 and describe the four new tables and the replaced CHECK', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string
      prevId: string
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>
    }
    const precedent = lire('0030_snapshot.json')
    const courant = lire('0031_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    for (const table of TABLES_A4) {
      expect(Object.keys(courant.tables), table).toContain(`public.${table}`)
      expect(Object.keys(precedent.tables), table).not.toContain(`public.${table}`)
    }
    expect(precedent.tables['public.generations_ia']!.checkConstraints.generations_ia_motif_check!.value).not.toContain('ia_coupee')
    expect(courant.tables['public.generations_ia']!.checkConstraints.generations_ia_motif_check!.value).toContain('ia_coupee')
  })

  it('should be written to be replayed: every statement is guarded (IF NOT EXISTS, IF EXISTS, NOT VALID, guarded DO)', () => {
    const instructions = instructionsMigration()

    expect(instructions.length).toBeGreaterThan(10)
    for (const instruction of instructions) {
      const nu = sansCommentaires(instruction).replace(/\s+/g, ' ').trim()
      if (/^CREATE TABLE/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE (UNIQUE )?INDEX/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD CONSTRAINT/.test(nu)) expect(nu, nu).toContain('NOT VALID')
      else if (/^DO \$\$/.test(nu)) {
        expect(nu, nu).toContain('IF NOT EXISTS (SELECT 1 FROM pg_constraint')
        expect(nu, nu).toContain('NOT VALID')
        expect(nu, nu).toContain('VALIDATE CONSTRAINT')
      }
    }
    expect(lireMigration()).toMatch(/DROP CONSTRAINT IF EXISTS "generations_ia_motif_check"/)
    expect(lireMigration()).toMatch(/VALIDATE CONSTRAINT "generations_ia_motif_check"/)
    for (const instruction of instructions) {
      expect(sansCommentaires(instruction).trim(), instruction).not.toMatch(/^(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE)\b|^ALTER TABLE .* DROP COLUMN/i)
    }
  })

  it('should NOT drop constraints of generations_ia by pattern (the spec block would have dropped generations_ia_motif_coherence_check)', () => {
    const code = instructionsMigration().map(sansCommentaires).join('\n')

    expect(code).not.toMatch(/LIKE '%motif_repli%'/)
    expect(code).not.toMatch(/FOR c IN SELECT conname/)
  })
})

describe('migration 0031 : reglages', () => {
  it('should create the table with typed columns, a text primary key and a RESTRICT foreign key on the author', async () => {
    const c = await colonnes('reglages')
    const cs = await contraintes('reglages')

    expect(Object.keys(c).sort()).toEqual(['cle', 'modifie_le', 'modifie_par', 'valeur'])
    expect(c.valeur).toMatchObject({ type: 'jsonb', nullable: false })
    expect(c.modifie_par).toMatchObject({ type: 'text', nullable: false })
    expect(c.modifie_le).toMatchObject({ type: 'timestamp with time zone', nullable: false })
    expect(Object.values(cs).find((x) => x.type === 'p')?.definition).toBe('PRIMARY KEY (cle)')
    expect(cs.reglages_modifie_par_users_id_fk).toMatchObject({ type: 'f', validee: true, suppression: 'r' })
    expect(cs.reglages_cle_check).toMatchObject({ type: 'c', validee: true })
    expect(cs.reglages_valeur_check).toMatchObject({ type: 'c', validee: true })
  })

  it.each<[string, unknown]>([
    ['un entier', 10],
    ['un booléen vrai', true],
    ['un booléen faux', false],
    ['un texte', 'Maintenance jusqu’à 18 h.'],
    ['zéro', 0],
  ])('should accept a setting whose value is %s and read it back unchanged', async (_libelle, valeur) => {
    const admin = await createUser()

    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.limite_utilisateur_heure', ${JSON.stringify(valeur)}::jsonb, ${admin.id})`)

    const [relu] = await db.select().from(reglages)
    expect(relu?.valeur).toEqual(valeur)
  })

  it.each<[string, string]>([
    ['un objet', '{"a":1}'],
    ['un tableau', '[1,2]'],
    ['un null JSON', 'null'],
  ])('should refuse a value that is %s (23514: only a number, a boolean or a string is a setting)', async (_libelle, json) => {
    const admin = await createUser()

    const erreur = await rejet(db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', ${json}::jsonb, ${admin.id})`))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'reglages_valeur_check' })
  })

  it('should refuse a SQL NULL value (23502: no NULL hole in the value CHECK)', async () => {
    const admin = await createUser()

    const erreur = await rejet(db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', NULL, ${admin.id})`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(NOT_NULL_VIOLATION)
  })

  it.each(['', 'ia', 'Ia.active', '1ia.active', 'ia active', 'ia/active', 'ia.active\n', `a${'b'.repeat(64)}`, 'ia-active'])(
    'should refuse the key %j (23514: lowercase, 3 to 64 characters, [a-z0-9_.] only)',
    async (cle) => {
      const admin = await createUser()

      const erreur = await rejet(db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES (${cle}, 'true'::jsonb, ${admin.id})`))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'reglages_cle_check' })
    },
  )

  it('should accept the longest registry key shape (64 characters) and the dotted keys of the registry', async () => {
    const admin = await createUser()
    const cles = ['ia.limite_utilisateur_heure', 'retention.inscriptions_abandonnees_jours', 'supervision.seuil_echecs_15_min', `a${'b'.repeat(63)}`]

    for (const cle of cles) await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES (${cle}, '1'::jsonb, ${admin.id})`)

    expect(await db.$count(reglages)).toBe(cles.length)
  })

  it('should write one row per key: a second write is an upsert (ON CONFLICT), never a duplicate (23505 without it)', async () => {
    const admin = await createUser()
    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', 'true'::jsonb, ${admin.id})`)

    const doublon = await rejet(db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', 'false'::jsonb, ${admin.id})`))
    await db.execute(sql`
      INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', 'false'::jsonb, ${admin.id})
      ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`)

    expect(erreurPostgres(doublon.brute).sqlstate).toBe(UNIQUE_VIOLATION)
    expect((await db.select().from(reglages)).map((r) => r.valeur)).toEqual([false])
  })

  it('should refuse a setting authored by an unknown account (23503) and the deletion of its author (23001, RESTRICT)', async () => {
    const admin = await createUser()
    const inconnu = await rejet(db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', 'true'::jsonb, ${randomUUID()})`))
    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.active', 'true'::jsonb, ${admin.id})`)

    const suppression = await rejet(db.execute(sql`DELETE FROM users WHERE id = ${admin.id}`))

    expect(erreurPostgres(inconnu.brute).sqlstate).toBe(FK_VIOLATION)
    expect(erreurPostgres(suppression.brute)).toMatchObject({ sqlstate: RESTRICT_VIOLATION, contrainte: 'reglages_modifie_par_users_id_fk' })
    expect(await db.$count(reglages)).toBe(1)
  })
})

describe('migration 0031 : capacites_accordees', () => {
  async function accorder(userId: string, adminId: string, surcharges: Partial<typeof capacitesAccordees.$inferInsert> = {}): Promise<string> {
    const id = surcharges.id ?? randomUUID()
    await db.insert(capacitesAccordees).values({
      id, userId, accordePar: adminId, capacite: 'mcp', motif: 'Pilote MCP validé avec le client', ...surcharges,
    })
    return id
  }

  it('should create the table with a cascade on the account, a RESTRICT on the author and the active-only unique index', async () => {
    const c = await colonnes('capacites_accordees')
    const cs = await contraintes('capacites_accordees')
    const index = await indexDe('capacites_accordees')

    expect(Object.keys(c).sort()).toEqual(['accorde_le', 'accorde_par', 'capacite', 'id', 'motif', 'revoque_le', 'user_id'])
    expect(c.revoque_le).toMatchObject({ nullable: true })
    expect(c.accorde_le).toMatchObject({ nullable: false })
    expect(cs.capacites_accordees_user_id_users_id_fk).toMatchObject({ type: 'f', validee: true, suppression: 'c' })
    expect(cs.capacites_accordees_accorde_par_users_id_fk).toMatchObject({ type: 'f', validee: true, suppression: 'r' })
    for (const nom of ['capacites_accordees_capacite_check', 'capacites_accordees_motif_check', 'capacites_accordees_revocation_check']) {
      expect(cs[nom], nom).toMatchObject({ type: 'c', validee: true })
    }
    expect(index.capacites_accordees_actives_unique).toMatch(/UNIQUE INDEX .*\(user_id, capacite\) WHERE \(revoque_le IS NULL\)/)
  })

  it('should accept a grant and a grant to a second account for the same capacity (accounts are independent)', async () => {
    const admin = await createUser()
    const [a, b] = [await createUser(), await createUser()]

    await accorder(a.id, admin.id)
    await accorder(b.id, admin.id)

    const lignes = await db.select({ userId: capacitesAccordees.userId }).from(capacitesAccordees)
    expect(lignes.map((l) => l.userId).sort()).toEqual([a.id, b.id].sort())
  })

  it.each(['admin', 'MCP', '', 'mcp ', 'ia'])('should refuse the capacity %j (23514: only `mcp` exists)', async (capacite) => {
    const admin = await createUser()
    const compte = await createUser()

    const erreur = await rejet(accorder(compte.id, admin.id, { capacite }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'capacites_accordees_capacite_check' })
  })

  it.each(['', 'abcd', '    ', ' abcd ', 'a'.repeat(501), `${' '.repeat(10)}ab`])('should refuse the motive %j (23514: 5 to 500 characters once trimmed)', async (motif) => {
    const admin = await createUser()
    const compte = await createUser()

    const erreur = await rejet(accorder(compte.id, admin.id, { motif }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'capacites_accordees_motif_check' })
  })

  it('should refuse a revocation dated BEFORE the grant (23514) and accept one at the same instant or later', async () => {
    const admin = await createUser()
    const compte = await createUser()
    const accorde = new Date('2026-11-14T10:00:00.000Z')

    const avant = await rejet(accorder(compte.id, admin.id, { accordeLe: accorde, revoqueLe: new Date(accorde.getTime() - 1) }))
    await accorder(compte.id, admin.id, { accordeLe: accorde, revoqueLe: accorde })
    await accorder(compte.id, admin.id, { accordeLe: accorde, revoqueLe: new Date(accorde.getTime() + 1) })

    expect(erreurPostgres(avant.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'capacites_accordees_revocation_check' })
    expect(await db.$count(capacitesAccordees)).toBe(2)
  })

  it('should allow ONE active grant per (account, capacity): a second one is refused (23505), a re-grant after revocation is accepted', async () => {
    const admin = await createUser()
    const compte = await createUser()
    const premiere = await accorder(compte.id, admin.id)

    const doublon = await rejet(accorder(compte.id, admin.id))
    await db.execute(sql`UPDATE capacites_accordees SET revoque_le = now() WHERE id = ${premiere}`)
    await accorder(compte.id, admin.id)

    expect(erreurPostgres(doublon.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'capacites_accordees_actives_unique' })
    const actives = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM capacites_accordees WHERE user_id = ${compte.id} AND revoque_le IS NULL`)
    expect(actives.rows[0]?.n).toBe(1)
    expect(await db.$count(capacitesAccordees)).toBe(2)
  })

  it('should disappear with the account (CASCADE) but keep the account of the author protected (RESTRICT)', async () => {
    const admin = await createUser()
    const [a, b] = [await createUser(), await createUser()]
    await accorder(a.id, admin.id)
    await accorder(b.id, admin.id)

    const auteur = await rejet(db.execute(sql`DELETE FROM users WHERE id = ${admin.id}`))
    await db.execute(sql`DELETE FROM users WHERE id = ${a.id}`)

    expect(erreurPostgres(auteur.brute)).toMatchObject({ sqlstate: RESTRICT_VIOLATION, contrainte: 'capacites_accordees_accorde_par_users_id_fk' })
    const restantes = await db.select({ userId: capacitesAccordees.userId }).from(capacitesAccordees)
    expect(restantes.map((l) => l.userId)).toEqual([b.id])
  })

  it('should serve the real query (does this account hold the capacity now?) by the partial unique index', async () => {
    const plan = await planSansBalayageSequentiel(sql`
      SELECT 1 FROM capacites_accordees WHERE user_id = ${randomUUID()} AND capacite = 'mcp' AND revoque_le IS NULL`)

    expect(plan).toContain('capacites_accordees_actives_unique')
  })
})

describe('migration 0031 : envois_codes', () => {
  async function envoi(surcharges: Partial<typeof envoisCodes.$inferInsert> = {}): Promise<void> {
    await db.insert(envoisCodes).values({ canal: 'sms', pays: 'CM', statut: 'envoye', tentative: 1, ...surcharges })
  }

  it('should create the table WITHOUT any identifying column (no number, no address, no code, no user) and an identity key ALWAYS', async () => {
    const c = await colonnes('envois_codes')
    const cs = await contraintes('envois_codes')

    expect(Object.keys(c).sort()).toEqual(['canal', 'code_erreur', 'cree_le', 'id', 'pays', 'statut', 'tentative'])
    expect(c.id).toMatchObject({ type: 'bigint', nullable: false, identite: 'ALWAYS' })
    expect(c.pays).toMatchObject({ nullable: true })
    expect(c.code_erreur).toMatchObject({ nullable: true })
    expect(Object.values(cs).filter((x) => x.type === 'f')).toHaveLength(0)
  })

  it('should refuse an explicit identifier (428C9: GENERATED ALWAYS)', async () => {
    const erreur = await rejet(db.execute(sql`INSERT INTO envois_codes (id, canal, statut, tentative) VALUES (1, 'sms', 'envoye', 1)`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(GENERATED_ALWAYS)
  })

  it('should accept an e-mail send without country, a failed SMS with a short error code, and fill the date by default', async () => {
    await envoi({ canal: 'email', pays: null })
    await envoi({ canal: 'sms', pays: 'CM', statut: 'echec', tentative: 3, codeErreur: 'OTP_SMS_NON_CONFIGURE' })
    await envoi({ canal: 'whatsapp', pays: 'FR' })

    const lignes = await db.select().from(envoisCodes)
    expect(lignes).toHaveLength(3)
    expect(lignes.every((l) => Date.now() - l.creeLe.getTime() < 60_000)).toBe(true)
    expect(lignes.filter((l) => l.canal === 'email').every((l) => l.pays === null)).toBe(true)
  })

  it.each(['SMS', 'telegram', '', 'sms '])('should refuse the channel %j (23514)', async (canal) => {
    const erreur = await rejet(envoi({ canal }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'envois_codes_canal_check' })
  })

  it.each(['cm', 'CMR', 'C', '', '12', 'C1', '+237'])('should refuse the country %j (23514: two uppercase letters, or NULL)', async (pays) => {
    const erreur = await rejet(envoi({ pays }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'envois_codes_pays_check' })
  })

  it.each(['reussi', 'ENVOYE', '', 'en_attente'])('should refuse the status %j (23514)', async (statut) => {
    const erreur = await rejet(envoi({ statut }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'envois_codes_statut_check' })
  })

  it.each([0, 4, -1, 100])('should refuse the attempt number %j (23514: 1 to 3, the BullMQ attempts)', async (tentative) => {
    const erreur = await rejet(envoi({ tentative }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'envois_codes_tentative_check' })
  })

  it('should accept a 40-character error code and refuse a 41-character one (a message or a number cannot be stored)', async () => {
    await envoi({ statut: 'echec', codeErreur: 'E'.repeat(40) })

    const erreur = await rejet(envoi({ statut: 'echec', codeErreur: 'E'.repeat(41) }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'envois_codes_code_erreur_check' })
  })

  it('should make NOT NULL columns mandatory (23502): channel, status, attempt', async () => {
    const sansCanal = await rejet(db.execute(sql`INSERT INTO envois_codes (statut, tentative) VALUES ('envoye', 1)`))
    const sansStatut = await rejet(db.execute(sql`INSERT INTO envois_codes (canal, tentative) VALUES ('sms', 1)`))
    const sansTentative = await rejet(db.execute(sql`INSERT INTO envois_codes (canal, statut) VALUES ('sms', 'envoye')`))

    for (const erreur of [sansCanal, sansStatut, sansTentative]) expect(erreurPostgres(erreur.brute).sqlstate).toBe(NOT_NULL_VIOLATION)
  })

  it('should serve the real queries (sends per channel and country over a window, 90-day purge) by the date-first index', async () => {
    const index = await indexDe('envois_codes')
    const agregat = await planSansBalayageSequentiel(sql`
      SELECT canal, pays, statut, count(*) FROM envois_codes WHERE cree_le >= now() - interval '30 days' GROUP BY canal, pays, statut`)
    const purge = await planSansBalayageSequentiel(sql`DELETE FROM envois_codes WHERE cree_le < now() - interval '90 days'`)

    expect(index.envois_codes_cree_le_idx).toMatch(/\(cree_le, canal, pays\)/)
    expect(agregat).toContain('envois_codes_cree_le_idx')
    expect(purge).toContain('envois_codes_cree_le_idx')
  })
})

describe('migration 0031 : battements_systeme', () => {
  it('should create the table with a text key and two non-null dates', async () => {
    const c = await colonnes('battements_systeme')

    expect(Object.keys(c).sort()).toEqual(['cle', 'ecrit_le', 'horodatage'])
    expect(c.horodatage).toMatchObject({ type: 'timestamp with time zone', nullable: false })
    expect(c.ecrit_le).toMatchObject({ type: 'timestamp with time zone', nullable: false })
  })

  it('should keep ONE row per key by upsert (the backup script rewrites the same row)', async () => {
    const premier = new Date('2026-11-14T02:00:00.000Z')
    const second = new Date('2026-11-15T02:00:00.000Z')
    const ecrire = (horodatage: Date) => db.execute(sql`
      INSERT INTO battements_systeme (cle, horodatage) VALUES ('sauvegarde_derniere_reussite', ${horodatage})
      ON CONFLICT (cle) DO UPDATE SET horodatage = EXCLUDED.horodatage, ecrit_le = now()`)

    await ecrire(premier)
    await ecrire(second)

    const lignes = await db.select().from(battementsSysteme)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.horodatage.getTime()).toBe(second.getTime())
  })

  it.each(['', 'ab', 'Sauvegarde', 'sauvegarde-derniere', 'sauvegarde derniere', 'a1b', 'x'.repeat(41), 'sauvegarde\n'])(
    'should refuse the key %j (23514: [a-z_], 3 to 40 characters)',
    async (cle) => {
      const erreur = await rejet(db.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES (${cle}, now())`))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'battements_systeme_cle_check' })
    },
  )

  it('should accept the key of the specification (28 characters)', async () => {
    await expect(db.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES ('sauvegarde_derniere_reussite', now())`)).resolves.toBeDefined()
  })
})

describe('migration 0031 : motif de repli ia_coupee', () => {
  it('should replace generations_ia_motif_check under its existing name, validated, listing the 0021 reasons plus ia_coupee', async () => {
    const cs = await contraintes('generations_ia')
    const motifs = await valeursCheck('generations_ia', 'generations_ia_motif_check')

    expect(cs.generations_ia_motif_check).toMatchObject({ type: 'c', validee: true })
    expect(Object.keys(cs)).not.toContain('generations_ia_motif_repli_check')
    expect(motifs).toEqual([
      'echec_fournisseur', 'delai_depasse', 'sortie_invalide', 'injection', 'sans_fournisseur',
      'sans_prompt', 'file_indisponible', 'limiteur_indisponible', 'plafond_global', 'quota_atteint', 'ia_coupee',
    ])
  })

  it('should keep every reason of the TypeScript list (MOTIFS_REPLI) accepted, and add nothing else but ia_coupee', async () => {
    const enBase = await valeursCheck('generations_ia', 'generations_ia_motif_check')

    expect([...MOTIFS_REPLI].filter((m) => !enBase.includes(m))).toEqual([])
    expect(enBase.filter((m) => !(MOTIFS_REPLI as readonly string[]).includes(m)).filter((m) => m !== 'ia_coupee')).toEqual([])
  })

  it('should accept a fallback with ia_coupee and keep refusing an unknown reason', async () => {
    const compte = await createUser()

    await expect(generation('repli', 'ia_coupee', compte.id)).resolves.toBeUndefined()
    const inconnu = await rejet(generation('repli', 'ia_eteinte', compte.id))

    expect(erreurPostgres(inconnu.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'generations_ia_motif_check' })
  })

  it('should KEEP generations_ia_motif_coherence_check: a fallback without reason, or a reason without fallback, is still refused', async () => {
    const compte = await createUser()
    const cs = await contraintes('generations_ia')

    const repliSansMotif = await rejet(generation('repli', null, compte.id))
    const motifSansRepli = await rejet(generation('terminee', 'ia_coupee', compte.id))

    expect(cs.generations_ia_motif_coherence_check).toMatchObject({ type: 'c', validee: true })
    expect(erreurPostgres(repliSansMotif.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'generations_ia_motif_coherence_check' })
    expect(erreurPostgres(motifSansRepli.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'generations_ia_motif_coherence_check' })
  })

  it('should leave existing generations untouched (no UPDATE in the migration, reasons of 0021 still valid)', async () => {
    const compte = await createUser()
    for (const motif of ['plafond_global', 'quota_atteint', 'sans_fournisseur']) await generation('repli', motif, compte.id)

    const lignes = await db.select({ motif: generationsIa.motifRepli }).from(generationsIa)

    expect(lignes.map((l) => l.motif).sort()).toEqual(['plafond_global', 'quota_atteint', 'sans_fournisseur'])
  })
})

describe('migration 0031 : parité entre le schéma Drizzle et la base', () => {
  it.each([
    ['reglages', reglages],
    ['capacites_accordees', capacitesAccordees],
    ['envois_codes', envoisCodes],
    ['battements_systeme', battementsSysteme],
  ] as const)('should declare in Drizzle exactly the columns of the table %s', async (nom, table) => {
    const enBase = Object.keys(await colonnes(nom)).sort()
    const enDrizzle = getTableConfig(table).columns.map((c) => c.name).sort()

    expect(enDrizzle).toEqual(enBase)
  })

  it.each([
    ['reglages', reglages, ['reglages_cle_check', 'reglages_valeur_check']],
    ['capacites_accordees', capacitesAccordees, ['capacites_accordees_capacite_check', 'capacites_accordees_motif_check', 'capacites_accordees_revocation_check']],
    ['envois_codes', envoisCodes, ['envois_codes_canal_check', 'envois_codes_code_erreur_check', 'envois_codes_pays_check', 'envois_codes_statut_check', 'envois_codes_tentative_check']],
    ['battements_systeme', battementsSysteme, ['battements_systeme_cle_check']],
  ] as const)('should declare in Drizzle the CHECK constraints of %s, under the names used in the database', async (nom, table, attendus) => {
    const enDrizzle = getTableConfig(table).checks.map((c) => c.name).sort()
    const enBase = Object.entries(await contraintes(nom)).filter(([, c]) => c.type === 'c').map(([n]) => n).sort()

    expect(enDrizzle).toEqual([...attendus])
    expect(enBase).toEqual([...attendus])
  })

  it('should declare in Drizzle the two indexes added by 0031, under the names used in the database', async () => {
    const cap = getTableConfig(capacitesAccordees)
    const envois = getTableConfig(envoisCodes)

    expect(cap.indexes.map((i) => i.config.name)).toContain('capacites_accordees_actives_unique')
    expect(envois.indexes.map((i) => i.config.name)).toContain('envois_codes_cree_le_idx')
    expect(Object.keys(await indexDe('capacites_accordees'))).toContain('capacites_accordees_actives_unique')
    expect(Object.keys(await indexDe('envois_codes'))).toContain('envois_codes_cree_le_idx')
    expect(getTableConfig(generationsIa).checks.find((c) => c.name === 'generations_ia_motif_check')).toBeDefined()
  })
})

describe('migration 0031 : rejouabilité et ROLLBACK documenté (montée, retour, remontée)', () => {
  async function rejouer(executeur: Executeur): Promise<void> {
    for (const instruction of instructionsMigration()) await executeur.execute(sql.raw(instruction))
  }

  async function semer(): Promise<void> {
    const admin = await createUser()
    const compte = await createUser()
    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('ia.limite_utilisateur_heure', '12'::jsonb, ${admin.id})`)
    await db.insert(capacitesAccordees).values({ id: randomUUID(), userId: compte.id, accordePar: admin.id, capacite: 'mcp', motif: 'Pilote MCP validé avec le client' })
    await db.insert(envoisCodes).values({ canal: 'sms', pays: 'CM', statut: 'echec', tentative: 2, codeErreur: 'DELAI' })
    await db.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES ('sauvegarde_derniere_reussite', now())`)
    await generation('repli', 'ia_coupee', compte.id)
  }

  it('should replay twice, in one transaction, without error and without losing any data', async () => {
    await semer()

    await db.transaction(async (tx) => {
      await rejouer(tx)
      await rejouer(tx)
    })

    expect(await db.$count(reglages)).toBe(1)
    expect(await db.$count(capacitesAccordees)).toBe(1)
    expect(await db.$count(envoisCodes)).toBe(1)
    expect(await db.$count(battementsSysteme)).toBe(1)
    expect((await db.select({ motif: generationsIa.motifRepli }).from(generationsIa)).map((g) => g.motif)).toEqual(['ia_coupee'])
  })

  it('should keep every foreign key and CHECK validated and effective after a replay (no duplicate foreign key)', async () => {
    await db.transaction(async (tx) => {
      await rejouer(tx)
    })

    for (const table of [...TABLES_A4, 'generations_ia']) {
      const cs = await contraintes(table)
      for (const [nom, c] of Object.entries(cs)) expect(c.validee, `${table}.${nom}`).toBe(true)
    }
    expect(Object.keys(await contraintes('capacites_accordees')).filter((n) => n.endsWith('_fk')).sort()).toEqual([
      'capacites_accordees_accorde_par_users_id_fk', 'capacites_accordees_user_id_users_id_fk',
    ])
    const erreur = await rejet(db.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES ('X', now())`))
    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'battements_systeme_cle_check' })
  })

  it('should run its documented ROLLBACK, then be re-applied (up, down, up), leaving the shared database untouched', async () => {
    await semer()
    const { instructions } = rollbackExecutable()

    await expect(db.transaction(async (tx) => {
      // Retour : les quatre tables disparaissent, ia_coupee est réécrit en sans_fournisseur, l'ancienne CHECK revient.
      for (const instruction of instructions) await tx.execute(sql.raw(instruction))
      for (const table of TABLES_A4) {
        const present = await tx.execute<{ p: string | null }>(sql`SELECT to_regclass(${`public.${table}`}) AS p`)
        expect(present.rows[0]?.p, table).toBeNull()
      }
      const apresRetour = await tx.execute<{ motif_repli: string, def: string }>(sql`
        SELECT g.motif_repli, (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'generations_ia_motif_check') AS def
        FROM generations_ia g`)
      expect(apresRetour.rows.map((r) => r.motif_repli)).toEqual(['sans_fournisseur'])
      expect(apresRetour.rows[0]?.def).not.toContain('ia_coupee')
      expect(apresRetour.rows[0]?.def).toContain('quota_atteint')
      const coherence = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'generations_ia_motif_coherence_check'`)
      expect(coherence.rows[0]?.n).toBe(1)

      // Remontée : la migration se rejoue sur la base revenue en arrière.
      await rejouer(tx)
      for (const table of TABLES_A4) {
        const present = await tx.execute<{ p: string | null }>(sql`SELECT to_regclass(${`public.${table}`}) AS p`)
        expect(present.rows[0]?.p, table).not.toBeNull()
        const lignes = await tx.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))
        expect(lignes.rows[0]?.n, table).toBe(0)
      }
      const remontee = await tx.execute<{ def: string }>(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'generations_ia_motif_check'`)
      expect(remontee.rows[0]?.def).toContain('ia_coupee')
      await tx.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES ('sauvegarde_derniere_reussite', now())`)
      throw ANNULATION
    })).rejects.toBe(ANNULATION)

    // Rien n'a été conservé : l'état post-0031 d'avant le test est intact (données semées comprises).
    expect(await existeTable('reglages')).toBe(true)
    expect(await db.$count(reglages)).toBe(1)
    expect(await db.$count(capacitesAccordees)).toBe(1)
    expect((await db.select({ motif: generationsIa.motifRepli }).from(generationsIa)).map((g) => g.motif)).toEqual(['ia_coupee'])
  })

  it('should refuse the rollback WITHOUT rewriting first: recreating the old CHECK fails (23514) if an ia_coupee row is left', async () => {
    await semer()
    const recreation = rollbackExecutable().instructions.find((i) => i.startsWith('ALTER TABLE generations_ia ADD CONSTRAINT'))!

    const erreur = await rejet(db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE generations_ia DROP CONSTRAINT generations_ia_motif_check`)
      await tx.execute(sql.raw(recreation))
    }))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
    expect((await contraintes('generations_ia')).generations_ia_motif_check?.definition).toContain('ia_coupee')
  })
})
