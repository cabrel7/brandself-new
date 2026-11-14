import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { adminReauth, journalAdmin, sessions, users } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { auditService, creerSuperadmin, etatDeclencheurs, journaliser, lignesReauth, lireJournal, sansDeclencheur } from './support/admin'
import { erreurPostgres, rejet } from './support/erreurs'
import { createUser } from './support/fabriques'

// A1 §2 : migration 0028 (plugin admin, sessions d'administration, journal chaîné, réauthentifications). État de la
// base APRÈS la migration, lu dans les catalogues PostgreSQL (jouée par le globalSetup sur la vraie base de test),
// contraintes éprouvées par des écritures réelles, puis REJOUABILITÉ (la migration est écrite en IF NOT EXISTS).

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const FK_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'
const NOT_NULL_VIOLATION = '23502'
const HEX_64 = 'a'.repeat(64)

// Bits de pg_trigger.tgtype : ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
const AVANT_LIGNE_INSERT = 1 | 2 | 4
const AVANT_LIGNE_MODIF_SUPPRESSION = 1 | 2 | 8 | 16
const AVANT_INSTRUCTION_VIDAGE = 2 | 32

function fichierMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0028_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0028 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return fichiers[0]!
}

interface Colonne {
  type: string
  nullable: boolean
  defaut: string | null
}

async function colonnes(table: string): Promise<Record<string, Colonne>> {
  const resultat = await db.execute<{ column_name: string, data_type: string, is_nullable: string, column_default: string | null }>(sql`
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

describe('migration 0028 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, and carry the commented manual rollback', () => {
    const fichier = fichierMigration()

    expect(fichier).toBe('0028_a1_admin_socle.sql')
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0028_snapshot.json'))).toBe(true)
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichier), 'utf-8')
    expect(contenu).toMatch(/ROLLBACK/)
    expect(contenu).toMatch(/--\s*DROP TABLE IF EXISTS journal_admin/)
    expect(contenu).toMatch(/--\s*DROP TABLE IF EXISTS admin_reauth/)
  })

  it('should be registered last in the drizzle journal, with a date after the previous migration (or it would never be applied)', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }
    const { entries } = journal

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries.at(-1)).toMatchObject({ idx: 28, tag: '0028_a1_admin_socle', breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the previous one and describe the new tables and columns', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string
      prevId: string
      tables: Record<string, { columns: Record<string, unknown> }>
    }
    const precedent = lire('0027_snapshot.json')
    const courant = lire('0028_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(Object.keys(courant.tables)).toEqual(expect.arrayContaining(['public.journal_admin', 'public.admin_reauth']))
    expect(Object.keys(courant.tables['public.users']!.columns)).toEqual(expect.arrayContaining(['role', 'suspendu', 'motif_suspension', 'suspension_fin']))
    expect(Object.keys(courant.tables['public.sessions']!.columns)).toEqual(expect.arrayContaining(['incarne_par', 'admin']))
  })

  it('should be written to be replayed: every statement is guarded (IF NOT EXISTS, IF EXISTS, OR REPLACE)', () => {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    const instructions = contenu
      .split(BREAKPOINT)
      .map((bloc) => bloc.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n').trim())
      .filter((bloc) => bloc !== '')

    expect(instructions.length).toBeGreaterThan(20)
    for (const instruction of instructions) {
      const nu = instruction.replace(/\s+/g, ' ')
      if (/^ALTER TABLE .* ADD COLUMN/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD CONSTRAINT/.test(nu)) expect(nu, nu).toContain('NOT VALID')
      else if (/^CREATE TABLE/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE (UNIQUE )?INDEX/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE (OR REPLACE )?FUNCTION/.test(nu)) expect(nu, nu).toContain('OR REPLACE')
      else if (/^CREATE TRIGGER/.test(nu)) expect(contenu).toContain(`DROP TRIGGER IF EXISTS ${/CREATE TRIGGER (\w+)/.exec(nu)?.[1]} ON journal_admin`)
    }
  })
})

describe('migration 0028 : colonnes', () => {
  it('should add to users: role, suspendu, motif_suspension, suspension_fin', async () => {
    const c = await colonnes('users')

    expect(c.role).toMatchObject({ type: 'text', nullable: false })
    expect(c.role?.defaut).toContain("'user'")
    expect(c.suspendu).toMatchObject({ type: 'boolean', nullable: false, defaut: 'false' })
    expect(c.motif_suspension).toMatchObject({ type: 'text', nullable: true })
    expect(c.suspension_fin).toMatchObject({ type: 'timestamp with time zone', nullable: true })
  })

  it('should add to sessions: incarne_par (nullable) and admin (not null, false)', async () => {
    const c = await colonnes('sessions')

    expect(c.incarne_par).toMatchObject({ type: 'text', nullable: true })
    expect(c.admin).toMatchObject({ type: 'boolean', nullable: false, defaut: 'false' })
  })

  it('should create journal_admin with typed columns (dates in timestamptz, state in jsonb, number in bigint)', async () => {
    const c = await colonnes('journal_admin')

    expect(Object.keys(c).sort()).toEqual([
      'action', 'admin_id', 'apres', 'avant', 'cible_id', 'cible_type', 'cle_idempotence', 'cree_le',
      'empreinte', 'empreinte_precedente', 'id', 'ip', 'motif', 'numero',
    ])
    expect(c.numero?.type).toBe('bigint')
    expect(c.avant).toMatchObject({ type: 'jsonb', nullable: true })
    expect(c.apres).toMatchObject({ type: 'jsonb', nullable: true })
    expect(c.cree_le).toMatchObject({ type: 'timestamp with time zone', nullable: false })
    expect(c.cible_id?.nullable).toBe(true)
    expect(c.cle_idempotence?.nullable).toBe(true)
    for (const nom of ['id', 'admin_id', 'action', 'cible_type', 'motif', 'ip', 'empreinte', 'empreinte_precedente']) {
      expect(c[nom], nom).toMatchObject({ type: 'text', nullable: false })
    }
  })

  it('should create admin_reauth with a small attempt counter and nullable consumption date', async () => {
    const c = await colonnes('admin_reauth')

    expect(Object.keys(c).sort()).toEqual([
      'action', 'admin_id', 'cible_id', 'cible_type', 'code_empreinte', 'consomme_le', 'cree_le', 'essais', 'expire_le', 'id',
    ])
    expect(c.essais).toMatchObject({ type: 'smallint', nullable: false, defaut: '0' })
    expect(c.expire_le).toMatchObject({ type: 'timestamp with time zone', nullable: false })
    expect(c.consomme_le).toMatchObject({ type: 'timestamp with time zone', nullable: true })
    expect(c.cible_id?.nullable).toBe(true)
  })

  it('should not store a plain code anywhere: no column of admin_reauth is named code', async () => {
    expect(Object.keys(await colonnes('admin_reauth'))).not.toContain('code')
  })

  it('should leave every existing account an ordinary, non suspended one (constant defaults, no backfill)', async () => {
    const compte = await createUser()

    const [relu] = await db.select().from(users).where(eq(users.id, compte.id))

    expect(relu).toMatchObject({ role: 'user', banned: false, banReason: null, banExpires: null })
  })
})

describe('migration 0028 : contraintes', () => {
  it('should declare the two named CHECK constraints, validated (NOT VALID then VALIDATE)', async () => {
    const utilisateurs = await contraintes('users')
    const sessionsContraintes = await contraintes('sessions')

    expect(utilisateurs.users_role_check).toMatchObject({ type: 'c', validee: true })
    expect(utilisateurs.users_role_check?.definition).toMatch(/superadmin/)
    expect(sessionsContraintes.sessions_sans_incarnation_check).toMatchObject({ type: 'c', validee: true })
    expect(sessionsContraintes.sessions_sans_incarnation_check?.definition).toMatch(/incarne_par IS NULL/)
  })

  it('should refuse a role outside user and superadmin (23514) and accept both', async () => {
    const inserer = (role: string) => db.execute(sql`INSERT INTO users (id, name, email, role) VALUES (${randomUUID()}, 'x', ${`${randomUUID()}@exemple.test`}, ${role})`)

    expect(erreurPostgres((await rejet(inserer('root'))).brute).sqlstate).toBe(CHECK_VIOLATION)
    expect(erreurPostgres((await rejet(inserer('admin'))).brute).sqlstate).toBe(CHECK_VIOLATION)
    expect(erreurPostgres((await rejet(inserer('Superadmin'))).brute).sqlstate).toBe(CHECK_VIOLATION)
    await expect(inserer('user')).resolves.toBeDefined()
    await expect(inserer('superadmin')).resolves.toBeDefined()
  })

  it('should refuse to promote an account to an unknown role by UPDATE', async () => {
    const compte = await createUser()

    const erreur = await rejet(db.execute(sql`UPDATE users SET role = 'root' WHERE id = ${compte.id}`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should make impersonation impossible at the database level: incarne_par must stay NULL, on INSERT and on UPDATE', async () => {
    const compte = await createUser()
    const inserer = () => db.execute(sql`INSERT INTO sessions (id, user_id, token, expires_at, incarne_par) VALUES (${randomUUID()}, ${compte.id}, ${randomUUID()}, now() + interval '1 hour', ${compte.id})`)
    await db.insert(sessions).values({ id: 'session-saine', userId: compte.id, token: 'jeton-sain', expiresAt: new Date(Date.now() + 3_600_000) })

    const insertion = await rejet(inserer())
    const modification = await rejet(db.execute(sql`UPDATE sessions SET incarne_par = ${compte.id} WHERE id = 'session-saine'`))

    expect(erreurPostgres(insertion.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'sessions_sans_incarnation_check' })
    expect(erreurPostgres(modification.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'sessions_sans_incarnation_check' })
  })

  it('should keep the journal rows tied to their administrator (RESTRICT) and the reauth rows to their account (CASCADE)', async () => {
    const journal = await contraintes('journal_admin')
    const reauth = await contraintes('admin_reauth')

    const cleEtrangereJournal = Object.values(journal).find((c) => c.type === 'f')
    const cleEtrangereReauth = Object.values(reauth).find((c) => c.type === 'f')
    expect(cleEtrangereJournal?.suppression).toBe('r')
    expect(cleEtrangereJournal?.definition).toMatch(/REFERENCES users\(id\)/)
    expect(cleEtrangereReauth?.suppression).toBe('c')
    expect(cleEtrangereReauth?.definition).toMatch(/REFERENCES users\(id\)/)
  })

  it('should require numero and fingerprint to be unique', async () => {
    const indexes = await indexDe('journal_admin')

    expect(Object.values(indexes).filter((d) => /UNIQUE INDEX .*\(numero\)/.test(d))).toHaveLength(1)
    expect(Object.values(indexes).filter((d) => /UNIQUE INDEX .*\(empreinte\)/.test(d))).toHaveLength(1)
  })

  it('should refuse a line that reaches the table while the chaining trigger is absent (numero cannot be left to a default)', async () => {
    const admin = await creerSuperadmin()

    const erreur = await sansDeclencheur('journal_admin_chainer', () => rejet(
      db.execute(sql`INSERT INTO journal_admin (id, admin_id, action, cible_type, motif, ip) VALUES (${randomUUID()}, ${admin.id}, 'compte.suspendre', 'utilisateur', 'Motif de test valide', '203.0.113.9')`),
    ))

    // Selon la conception : valeur de repli refusée par un CHECK (23514) ou colonne sans défaut (23502).
    expect([CHECK_VIOLATION, NOT_NULL_VIOLATION]).toContain(erreurPostgres(erreur.brute).sqlstate)
  })

  it.each([
    ['action mal formée', { action: 'Compte-Supprimer' }],
    ['action sans point', { action: 'comptesupprimer' }],
    ['type de cible mal formé', { cible_type: 'Utilisateur1' }],
    ['identifiant de cible de 65 caractères', { cible_id: 'x'.repeat(65) }],
    ['motif de 4 caractères', { motif: 'abcd' }],
    ['motif de 4 caractères entouré d\'espaces', { motif: '   abcd   ' }],
    ['motif de 501 caractères', { motif: 'a'.repeat(501) }],
    ['IP de 65 caractères', { ip: '1'.repeat(65) }],
    ['clé d\'idempotence de 7 caractères', { cle_idempotence: 'abcdefg' }],
    ['clé d\'idempotence de 129 caractères', { cle_idempotence: 'k'.repeat(129) }],
  ])('should refuse a journal line with %s (23514)', async (_cas, surcharge) => {
    const admin = await creerSuperadmin()
    const valeurs = { id: randomUUID(), admin_id: admin.id, action: 'compte.suspendre', cible_type: 'utilisateur', cible_id: null as string | null, motif: 'Motif de test valide', ip: '203.0.113.9', cle_idempotence: null as string | null, ...surcharge }

    const erreur = await rejet(db.execute(sql`
      INSERT INTO journal_admin (id, admin_id, action, cible_type, cible_id, motif, ip, cle_idempotence)
      VALUES (${valeurs.id}, ${valeurs.admin_id}, ${valeurs.action}, ${valeurs.cible_type}, ${valeurs.cible_id}, ${valeurs.motif}, ${valeurs.ip}, ${valeurs.cle_idempotence})`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })

  it.each([
    ['un tableau JSON', '[1, 2]'],
    ['une chaîne JSON', '"texte"'],
    ['un nombre JSON', '12'],
  ])('should refuse %s as before/after state (an object is required)', async (_cas, json) => {
    const admin = await creerSuperadmin()

    const erreur = await rejet(db.execute(sql`
      INSERT INTO journal_admin (id, admin_id, action, cible_type, motif, ip, apres)
      VALUES (${randomUUID()}, ${admin.id}, 'compte.suspendre', 'utilisateur', 'Motif de test valide', '203.0.113.9', ${json}::jsonb)`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should accept the limits exactly: motive of 5 and 500 characters, identifier and IP of 64, key of 8 and 128', async () => {
    const admin = await creerSuperadmin()
    const inserer = (motif: string, cleId: string, ip: string, cle: string) => db.execute(sql`
      INSERT INTO journal_admin (id, admin_id, action, cible_type, cible_id, motif, ip, cle_idempotence)
      VALUES (${randomUUID()}, ${admin.id}, 'compte.suspendre', 'utilisateur', ${cleId}, ${motif}, ${ip}, ${cle})`)

    await inserer('abcde', 'c'.repeat(64), 'i'.repeat(64), 'k'.repeat(8))
    await inserer('a'.repeat(500), 'c', '1', 'k'.repeat(128))

    expect(await lireJournal()).toHaveLength(2)
  })

  it.each([
    ['essais négatifs', { essais: -1 }],
    ['quatre essais', { essais: 4 }],
    ['empreinte qui n\'est pas hexadécimale', { code_empreinte: 'z'.repeat(64) }],
    ['empreinte trop courte', { code_empreinte: 'a'.repeat(63) }],
    ['empreinte en majuscules', { code_empreinte: 'A'.repeat(64) }],
    ['action mal formée', { action: 'Compte-Supprimer' }],
    ['type de cible mal formé', { cible_type: 'Utilisateur1' }],
    ['identifiant de cible de 65 caractères', { cible_id: 'x'.repeat(65) }],
  ])('should refuse a re-authentication row with %s (23514)', async (_cas, surcharge) => {
    const admin = await creerSuperadmin()
    const v = { essais: 0, code_empreinte: HEX_64, action: 'compte.supprimer', cible_type: 'utilisateur', cible_id: null as string | null, ...surcharge }

    const erreur = await rejet(db.execute(sql`
      INSERT INTO admin_reauth (id, admin_id, action, cible_type, cible_id, code_empreinte, essais, expire_le)
      VALUES (${randomUUID()}, ${admin.id}, ${v.action}, ${v.cible_type}, ${v.cible_id}, ${v.code_empreinte}, ${v.essais}, now() + interval '10 minutes')`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should refuse a re-authentication row for an unknown account (23503)', async () => {
    const erreur = await rejet(db.execute(sql`
      INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le)
      VALUES (${randomUUID()}, 'compte-inconnu', 'compte.supprimer', 'utilisateur', ${HEX_64}, now() + interval '10 minutes')`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(FK_VIOLATION)
  })

  it('should keep a re-authentication row modifiable (consumption and attempts are updates), unlike the journal', async () => {
    const admin = await creerSuperadmin()
    await db.execute(sql`INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le) VALUES ('reauth-modifiable', ${admin.id}, 'compte.supprimer', 'utilisateur', ${HEX_64}, now() + interval '10 minutes')`)

    await db.execute(sql`UPDATE admin_reauth SET essais = essais + 1, consomme_le = now() WHERE id = 'reauth-modifiable'`)

    expect((await lignesReauth(admin.id))[0]).toMatchObject({ essais: 1 })
  })

  it('should enforce the idempotency key uniqueness per administrator at the database level (23505)', async () => {
    const admin = await creerSuperadmin()
    const inserer = () => db.execute(sql`INSERT INTO journal_admin (id, admin_id, action, cible_type, motif, ip, cle_idempotence) VALUES (${randomUUID()}, ${admin.id}, 'compte.suspendre', 'utilisateur', 'Motif de test valide', '203.0.113.9', 'cle-migration-1')`)
    await inserer()

    const erreur = await rejet(inserer())

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'journal_admin_idempotence_unique' })
  })
})

describe('migration 0028 : index', () => {
  it('should create the partial index of privileged accounts (only roles other than user)', async () => {
    const indexes = await indexDe('users')

    expect(indexes.users_role_privilegie_idx).toMatch(/\(role\)/)
    expect(indexes.users_role_privilegie_idx).toMatch(/WHERE .*role.*<> 'user'/)
  })

  it('should create the journal indexes: most recent first, by target, and the partial unique one for idempotency', async () => {
    const indexes = await indexDe('journal_admin')

    expect(indexes.journal_admin_cree_le_idx).toMatch(/cree_le DESC/)
    expect(indexes.journal_admin_cible_idx).toMatch(/\(cible_type, cible_id\)/)
    expect(indexes.journal_admin_idempotence_unique).toMatch(/UNIQUE INDEX/)
    expect(indexes.journal_admin_idempotence_unique).toMatch(/\(admin_id, cle_idempotence\)/)
    expect(indexes.journal_admin_idempotence_unique).toMatch(/WHERE .*cle_idempotence IS NOT NULL/)
  })

  it('should create the partial index of open re-authentications (not consumed)', async () => {
    const indexes = await indexDe('admin_reauth')

    expect(indexes.admin_reauth_ouvert_idx).toMatch(/\(admin_id, action, cible_type, cible_id\)/)
    expect(indexes.admin_reauth_ouvert_idx).toMatch(/WHERE .*consomme_le IS NULL/)
  })
})

describe('migration 0028 : déclencheurs et fonctions du journal', () => {
  it('should install exactly three triggers, all enabled', async () => {
    expect(await etatDeclencheurs()).toEqual({
      journal_admin_chainer: 'O',
      journal_admin_sans_modif: 'O',
      journal_admin_sans_vidage: 'O',
    })
  })

  it('should wire each trigger to the right event: chain before insert, refuse before update or delete, refuse before truncate', async () => {
    const resultat = await db.execute<{ tgname: string, tgtype: number, fonction: string }>(sql`
      SELECT tgname, tgtype::int AS tgtype, tgfoid::regproc::text AS fonction FROM pg_trigger
      WHERE tgrelid = 'journal_admin'::regclass AND NOT tgisinternal ORDER BY tgname`)
    const parNom = Object.fromEntries(resultat.rows.map((r) => [r.tgname, r]))

    expect(parNom.journal_admin_chainer).toMatchObject({ tgtype: AVANT_LIGNE_INSERT, fonction: 'journal_admin_chainer' })
    expect(parNom.journal_admin_sans_modif).toMatchObject({ tgtype: AVANT_LIGNE_MODIF_SUPPRESSION, fonction: 'journal_admin_interdire' })
    expect(parNom.journal_admin_sans_vidage).toMatchObject({ tgtype: AVANT_INSTRUCTION_VIDAGE, fonction: 'journal_admin_interdire' })
  })

  it('should define the three functions', async () => {
    const resultat = await db.execute<{ proname: string }>(sql`
      SELECT proname FROM pg_proc WHERE pronamespace = current_schema()::regnamespace
        AND proname IN ('journal_admin_empreinte', 'journal_admin_chainer', 'journal_admin_interdire') ORDER BY proname`)

    expect(resultat.rows.map((r) => r.proname)).toEqual(['journal_admin_chainer', 'journal_admin_empreinte', 'journal_admin_interdire'])
  })

  it('should compute the same fingerprint when the function is called directly (deterministic, 64 hexadecimal characters)', async () => {
    const appel = () => db.execute<{ empreinte: string }>(sql`
      SELECT journal_admin_empreinte(${'0'.repeat(64)}, 1::bigint, 'id', 'admin', 'compte.suspendre', 'utilisateur', 'cible', NULL::jsonb, '{"a":1}'::jsonb,
        'Motif de test', '203.0.113.9', NULL, '2026-11-14T10:00:00Z'::timestamptz) AS empreinte`)

    const [premier, second] = [await appel(), await appel()]

    expect(premier.rows[0]?.empreinte).toMatch(/^[0-9a-f]{64}$/)
    expect(premier.rows[0]?.empreinte).toBe(second.rows[0]?.empreinte)
  })

  it('should change the fingerprint when any single input changes (no field is left out of the hash)', async () => {
    const base = ['0'.repeat(64), '1', 'id', 'admin', 'compte.suspendre', 'utilisateur', 'cible', '{"a":1}', '{"a":2}', 'Motif de test', '203.0.113.9', 'cle-idempotence', '2026-11-14T10:00:00Z']
    const calcul = async (v: string[]) => {
      const r = await db.execute<{ e: string }>(sql`
        SELECT journal_admin_empreinte(${v[0]}, ${v[1]}::bigint, ${v[2]}, ${v[3]}, ${v[4]}, ${v[5]}, ${v[6]}, ${v[7]}::jsonb, ${v[8]}::jsonb, ${v[9]}, ${v[10]}, ${v[11]}, ${v[12]}::timestamptz) AS e`)
      return r.rows[0]!.e
    }
    const reference = await calcul(base)
    const variantes = [
      ['1'.repeat(64)], ['2'], ['id2'], ['admin2'], ['compte.autre'], ['autre'], ['cible2'], ['{"a":3}'], ['{"a":4}'], ['Motif autre'], ['198.51.100.1'], ['autre-cle-12'], ['2026-11-14T10:00:01Z'],
    ]

    for (const [i, [valeur]] of variantes.entries()) {
      const modifiee = [...base]
      modifiee[i] = valeur!
      expect(await calcul(modifiee), `champ n°${i + 1}`).not.toBe(reference)
    }
  })
})

describe('migration 0028 : parité entre le schéma Drizzle et la base', () => {
  it.each([
    ['journal_admin', journalAdmin],
    ['admin_reauth', adminReauth],
  ] as const)('should declare in Drizzle exactly the columns of the table %s', async (nom, table) => {
    const enBase = Object.keys(await colonnes(nom)).sort()
    const enDrizzle = getTableConfig(table).columns.map((c) => c.name).sort()

    expect(enDrizzle).toEqual(enBase)
  })

  it('should declare the new columns of users and sessions in Drizzle', () => {
    const nomsUsers = getTableConfig(users).columns.map((c) => c.name)
    const nomsSessions = getTableConfig(sessions).columns.map((c) => c.name)

    expect(nomsUsers).toEqual(expect.arrayContaining(['role', 'suspendu', 'motif_suspension', 'suspension_fin']))
    expect(nomsSessions).toEqual(expect.arrayContaining(['incarne_par', 'admin']))
  })

  it('should map the Better Auth admin plugin field names onto the French columns', () => {
    const colonnesUsers = Object.fromEntries(getTableConfig(users).columns.map((c) => [c.name, c]))

    expect(users.banned.name).toBe('suspendu')
    expect(users.banReason.name).toBe('motif_suspension')
    expect(users.banExpires.name).toBe('suspension_fin')
    expect(users.role.name).toBe('role')
    expect(sessions.impersonatedBy.name).toBe('incarne_par')
    expect(colonnesUsers.suspendu?.notNull).toBe(true)
  })
})

describe('migration 0028 : rejouabilité', () => {
  async function rejouer(): Promise<void> {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    const instructions = contenu
      .split(BREAKPOINT)
      .map((bloc) => bloc.trim())
      .filter((bloc) => bloc.split('\n').some((ligne) => ligne.trim() !== '' && !ligne.trimStart().startsWith('--')))
    await db.transaction(async (tx) => {
      for (const instruction of instructions) await tx.execute(sql.raw(instruction))
    })
  }

  it('should replay without error and without losing any data, journal and chain included', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await db.execute(sql`INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le) VALUES ('reauth-rejouee', ${admin.id}, 'compte.supprimer', 'utilisateur', ${HEX_64}, now() + interval '10 minutes')`)
    const avant = await lireJournal()

    await rejouer()
    await rejouer()

    expect(await lireJournal()).toEqual(avant)
    expect(await lignesReauth(admin.id)).toHaveLength(1)
    const [relu] = await db.select({ role: users.role }).from(users).where(eq(users.id, admin.id))
    expect(relu?.role).toBe('superadmin')
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should keep the triggers enabled and effective after a replay', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    await rejouer()

    expect(await etatDeclencheurs()).toEqual({ journal_admin_chainer: 'O', journal_admin_sans_modif: 'O', journal_admin_sans_vidage: 'O' })
    const erreur = await rejet(db.execute(sql`UPDATE journal_admin SET motif = 'Motif réécrit après coup'`))
    expect(erreurPostgres(erreur.brute).sqlstate).toBe('42501')
    expect(await journaliser(admin.id)).toMatchObject({ numero: 2 })
  })

  it('should keep the constraints validated after a replay', async () => {
    await rejouer()

    expect((await contraintes('users')).users_role_check?.validee).toBe(true)
    expect((await contraintes('sessions')).sessions_sans_incarnation_check?.validee).toBe(true)
  })
})
