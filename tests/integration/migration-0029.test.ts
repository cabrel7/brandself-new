import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abonnements, emailsTransactionnels, users, vitrines } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'
import { createUser, insertVitrineRow } from './support/fabriques'

// A2 §3 : migration 0029 (blocage admin des vitrines, origine des abonnements, nouveaux types d'e-mail, index des
// listes). État de la base APRÈS la migration, lu dans les catalogues PostgreSQL (jouée par le globalSetup sur la
// vraie base de test), contraintes éprouvées par des écritures réelles, isolation entre deux vitrines, puis
// REJOUABILITÉ (la migration est écrite en IF NOT EXISTS / DROP IF EXISTS).

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const MOTIF_VALIDE = 'Contenu contraire aux conditions'
const TYPES_ADMIN = ['utilisateur_suspendu', 'utilisateur_reactive', 'utilisateur_jours_offerts', 'utilisateur_depubliee'] as const

function fichierMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0029_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0029 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
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
}

async function contraintes(table: string): Promise<Record<string, Contrainte>> {
  const resultat = await db.execute<{ conname: string, contype: string, convalidated: boolean, def: string }>(sql`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = ${`public.${table}`}::regclass`)
  return Object.fromEntries(resultat.rows.map((r) => [r.conname, { type: r.contype, validee: r.convalidated, definition: r.def }]))
}

async function indexDe(table: string): Promise<Record<string, string>> {
  const resultat = await db.execute<{ indexname: string, indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.indexname, r.indexdef]))
}

/** Plan d'exécution d'une requête dont le balayage séquentiel est interdit : prouve que l'index PEUT servir la requête. */
async function planSansBalayageSequentiel(requete: ReturnType<typeof sql>): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`)
    const resultat = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN ${requete}`)
    return resultat.rows.map((r) => r['QUERY PLAN']).join('\n')
  })
}

async function insererAbonnement(userId: string, origine?: string) {
  const id = randomUUID()
  await db.execute(sql`
    INSERT INTO abonnements (id, user_id, expire_le, premiere_activation_le${origine === undefined ? sql`` : sql`, origine`})
    VALUES (${id}, ${userId}, now() + interval '30 days', now()${origine === undefined ? sql`` : sql`, ${origine}`})`)
  return id
}

async function insererEmail(surcharges: { type: string, entiteType?: string, entiteId?: string, occurrence?: string }) {
  await db.execute(sql`
    INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence)
    VALUES (${randomUUID()}, ${surcharges.type}, ${surcharges.entiteType ?? 'utilisateur'}, ${surcharges.entiteId ?? 'compte-1'}, ${surcharges.occurrence ?? '1'})`)
}

describe('migration 0029 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, and carry the commented manual rollback', () => {
    const fichier = fichierMigration()

    expect(fichier).toBe('0029_a2_utilisateurs_vitrines.sql')
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0029_snapshot.json'))).toBe(true)
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichier), 'utf-8')
    expect(contenu).toMatch(/ROLLBACK/)
    expect(contenu).toMatch(/--\s*ALTER TABLE vitrines DROP COLUMN IF EXISTS blocage_motif/)
    expect(contenu).toMatch(/--\s*ALTER TABLE abonnements DROP COLUMN IF EXISTS origine/)
    expect(contenu).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
  })

  it('should be registered right after 0028 in the drizzle journal, with a later date (or it would never be applied)', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }
    const { entries } = journal

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[28]).toMatchObject({ idx: 28, tag: '0028_a1_admin_socle' })
    expect(entries[29]).toMatchObject({ idx: 29, tag: '0029_a2_utilisateurs_vitrines', breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0028 and describe the new columns and indexes', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string
      prevId: string
      tables: Record<string, { columns: Record<string, unknown>, indexes: Record<string, unknown> }>
    }
    const precedent = lire('0028_snapshot.json')
    const courant = lire('0029_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(Object.keys(courant.tables['public.vitrines']!.columns)).toEqual(expect.arrayContaining(['blocage_admin', 'blocage_motif']))
    expect(Object.keys(courant.tables['public.abonnements']!.columns)).toContain('origine')
    expect(Object.keys(courant.tables['public.users']!.indexes)).toEqual(expect.arrayContaining(['users_suspendu_idx', 'users_cree_le_idx', 'users_telephone_idx']))
    expect(Object.keys(courant.tables['public.vitrines']!.indexes)).toContain('vitrines_blocage_idx')
    expect(Object.keys(precedent.tables['public.vitrines']!.columns)).not.toContain('blocage_admin')
  })

  it('should be written to be replayed: every statement is guarded (IF NOT EXISTS, IF EXISTS, NOT VALID)', () => {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    const instructions = contenu
      .split(BREAKPOINT)
      .map((bloc) => bloc.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n').trim())
      .filter((bloc) => bloc !== '')

    expect(instructions.length).toBeGreaterThan(15)
    for (const instruction of instructions) {
      const nu = instruction.replace(/\s+/g, ' ')
      if (/^ALTER TABLE .* ADD COLUMN/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD CONSTRAINT/.test(nu)) expect(nu, nu).toContain('NOT VALID')
      else if (/^CREATE (UNIQUE )?INDEX/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE TABLE/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
    }
    // Chaque ADD CONSTRAINT est précédé de son DROP IF EXISTS et suivi de son VALIDATE.
    for (const nom of ['vitrines_blocage_check', 'abonnements_origine_check', 'emails_transactionnels_type_check']) {
      expect(contenu, nom).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS "${nom}"`))
      expect(contenu, nom).toMatch(new RegExp(`VALIDATE CONSTRAINT "${nom}"`))
    }
    // Aucune opération qui bloquerait longuement ou perdrait des données en montée.
    expect(instructions.join('\n')).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i)
  })
})

describe('migration 0029 : colonnes', () => {
  it('should add to vitrines: blocage_admin (not null, false) and blocage_motif (nullable text)', async () => {
    const c = await colonnes('vitrines')

    expect(c.blocage_admin).toMatchObject({ type: 'boolean', nullable: false, defaut: 'false' })
    expect(c.blocage_motif).toMatchObject({ type: 'text', nullable: true })
  })

  it("should add to abonnements: origine (not null, default 'paiement')", async () => {
    const c = await colonnes('abonnements')

    expect(c.origine).toMatchObject({ type: 'text', nullable: false })
    expect(c.origine?.defaut).toContain("'paiement'")
  })

  it('should leave every existing vitrine and abonnement untouched (constant defaults, no backfill)', async () => {
    const compte = await createUser()
    const vitrine = await insertVitrineRow(compte.id, { publiee: true })
    const abonnementId = await insererAbonnement(compte.id)

    const [relue] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    const [abonnement] = await db.select().from(abonnements).where(eq(abonnements.id, abonnementId))

    expect(relue).toMatchObject({ blocageAdmin: false, blocageMotif: null })
    expect(relue?.publieeLe).toBeInstanceOf(Date)
    expect(abonnement?.origine).toBe('paiement')
  })

  it('should not duplicate the suspension: users.suspendu (A1) is the only place, vitrines carries no copy', async () => {
    const colonnesVitrines = Object.keys(await colonnes('vitrines'))

    expect(colonnesVitrines).not.toContain('suspendu')
    expect(colonnesVitrines).not.toContain('motif_suspension')
    expect(Object.keys(await colonnes('users'))).toContain('suspendu')
  })
})

describe('migration 0029 : contraintes de vitrines', () => {
  it('should declare vitrines_blocage_check, validated', async () => {
    const c = await contraintes('vitrines')

    expect(c.vitrines_blocage_check).toMatchObject({ type: 'c', validee: true })
    expect(c.vitrines_blocage_check?.definition).toMatch(/blocage_admin/)
  })

  it('should refuse a blocked vitrine without a reason, with a short, a blank or a too long one (23514)', async () => {
    const compte = await createUser()
    const vitrine = await insertVitrineRow(compte.id, { publiee: true })
    const bloquer = (motif: string | null) => db.execute(sql`UPDATE vitrines SET blocage_admin = true, blocage_motif = ${motif} WHERE id = ${vitrine.id}`)

    for (const motif of [null, '', 'abcd', '          ', ' ab ', 'x'.repeat(501)]) {
      const erreur = await rejet(bloquer(motif))
      expect(erreurPostgres(erreur.brute), JSON.stringify(motif)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'vitrines_blocage_check' })
    }
    const [relue] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    expect(relue).toMatchObject({ blocageAdmin: false, blocageMotif: null })
  })

  it('should refuse a reason on a vitrine that is not blocked (a stale reason can never survive a republication)', async () => {
    const compte = await createUser()
    const vitrine = await insertVitrineRow(compte.id, { publiee: true })

    const erreur = await rejet(db.execute(sql`UPDATE vitrines SET blocage_motif = ${MOTIF_VALIDE} WHERE id = ${vitrine.id}`))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'vitrines_blocage_check' })
  })

  it('should accept a reason of 5 and of 500 characters, then a republication that clears both columns, and keep publiee_le', async () => {
    const compte = await createUser()
    const vitrine = await insertVitrineRow(compte.id, { publiee: true })
    const [avant] = await db.select({ publieeLe: vitrines.publieeLe }).from(vitrines).where(eq(vitrines.id, vitrine.id))

    await db.execute(sql`UPDATE vitrines SET blocage_admin = true, blocage_motif = ${'abcde'} WHERE id = ${vitrine.id}`)
    await db.execute(sql`UPDATE vitrines SET blocage_motif = ${'y'.repeat(500)} WHERE id = ${vitrine.id}`)
    const [bloquee] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    await db.execute(sql`UPDATE vitrines SET blocage_admin = false, blocage_motif = NULL WHERE id = ${vitrine.id}`)
    const [republiee] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))

    expect(bloquee).toMatchObject({ blocageAdmin: true, blocageMotif: 'y'.repeat(500) })
    expect(bloquee?.publieeLe?.getTime()).toBe(avant?.publieeLe?.getTime())
    expect(republiee).toMatchObject({ blocageAdmin: false, blocageMotif: null })
    expect(republiee?.publieeLe?.getTime()).toBe(avant?.publieeLe?.getTime())
  })

  it('should isolate two vitrines (two tenants): blocking one never changes the other', async () => {
    const compteA = await createUser()
    const compteB = await createUser()
    const vitrineA = await insertVitrineRow(compteA.id, { publiee: true })
    const vitrineB = await insertVitrineRow(compteB.id, { publiee: true })

    await db.execute(sql`UPDATE vitrines SET blocage_admin = true, blocage_motif = ${MOTIF_VALIDE} WHERE id = ${vitrineA.id}`)

    const lignes = await db.select({ id: vitrines.id, blocageAdmin: vitrines.blocageAdmin, blocageMotif: vitrines.blocageMotif }).from(vitrines)
    expect(lignes.find((l) => l.id === vitrineA.id)).toMatchObject({ blocageAdmin: true, blocageMotif: MOTIF_VALIDE })
    expect(lignes.find((l) => l.id === vitrineB.id)).toMatchObject({ blocageAdmin: false, blocageMotif: null })
  })
})

describe('migration 0029 : abonnements.origine', () => {
  it('should declare abonnements_origine_check, validated', async () => {
    expect((await contraintes('abonnements')).abonnements_origine_check).toMatchObject({ type: 'c', validee: true })
  })

  it.each(['paiement', 'offert', 'admin'])('should accept the origin %s', async (origine) => {
    const compte = await createUser()

    const id = await insererAbonnement(compte.id, origine)

    const [relu] = await db.select({ origine: abonnements.origine }).from(abonnements).where(eq(abonnements.id, id))
    expect(relu?.origine).toBe(origine)
  })

  it.each(['autre', 'Paiement', 'OFFERT', '', 'gratuit'])('should refuse the origin %j (23514)', async (origine) => {
    const compte = await createUser()

    const erreur = await rejet(insererAbonnement(compte.id, origine))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'abonnements_origine_check' })
  })

  it('should refuse to turn an existing abonnement into an unknown origin by UPDATE', async () => {
    const compte = await createUser()
    const id = await insererAbonnement(compte.id)

    const erreur = await rejet(db.execute(sql`UPDATE abonnements SET origine = 'cadeau' WHERE id = ${id}`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })
})

describe('migration 0029 : emails_transactionnels (4 nouveaux types)', () => {
  it('should keep the type CHECK validated and list the 17 types', async () => {
    const c = (await contraintes('emails_transactionnels')).emails_transactionnels_type_check

    expect(c).toMatchObject({ type: 'c', validee: true })
    for (const type of TYPES_ADMIN) expect(c?.definition, type).toContain(type)
    for (const type of ['reservation_professionnel_nouvelle', 'utilisateur_resume_hebdo', 'abonnement_rappel', 'paiement_confirme']) expect(c?.definition, type).toContain(type)
  })

  it.each(TYPES_ADMIN)('should accept %s for an `utilisateur` entity', async (type) => {
    await insererEmail({ type })

    const lignes = await db.select({ type: emailsTransactionnels.type, categorie: emailsTransactionnels.categorie, statut: emailsTransactionnels.statut }).from(emailsTransactionnels)
    expect(lignes).toEqual([{ type, categorie: 'transactionnel', statut: 'en_attente' }])
  })

  it('should refuse an unknown type (23514) and an admin type attached to another entity kind', async () => {
    const inconnu = await rejet(insererEmail({ type: 'utilisateur_banni' }))
    const mauvaiseEntite = await rejet(insererEmail({ type: 'utilisateur_suspendu', entiteType: 'reservation' }))

    expect(erreurPostgres(inconnu.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_type_check' })
    expect(erreurPostgres(mauvaiseEntite.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_entite_coherence_check' })
  })

  it('should deduplicate on (entite, type, occurrence): the same action cannot be sent twice, a second suspension can', async () => {
    await insererEmail({ type: 'utilisateur_suspendu', occurrence: '41' })

    const doublon = await rejet(insererEmail({ type: 'utilisateur_suspendu', occurrence: '41' }))
    await expect(insererEmail({ type: 'utilisateur_suspendu', occurrence: '57' })).resolves.toBeUndefined()

    expect(erreurPostgres(doublon.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'emails_transactionnels_entite_evenement_unique' })
  })

  it('should document the occurrence limit: a journal UUID (36 characters, lowercase) is refused, the journal number is accepted', async () => {
    const parUuid = await rejet(insererEmail({ type: 'utilisateur_depubliee', occurrence: randomUUID() }))

    expect(erreurPostgres(parUuid.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_occurrence_check' })
    await expect(insererEmail({ type: 'utilisateur_depubliee', occurrence: '12345' })).resolves.toBeUndefined()
  })
})

describe('migration 0029 : index', () => {
  it('should create the four indexes with the expected shape (partial where the table is mostly one value)', async () => {
    const indexUsers = await indexDe('users')
    const indexVitrines = await indexDe('vitrines')

    expect(indexUsers.users_suspendu_idx).toMatch(/\(suspendu\) WHERE suspendu/)
    expect(indexUsers.users_cree_le_idx).toMatch(/\(created_at DESC\)/)
    expect(indexUsers.users_telephone_idx).toMatch(/\(telephone\) WHERE \(telephone IS NOT NULL\)/)
    expect(indexVitrines.vitrines_blocage_idx).toMatch(/\(blocage_admin\) WHERE blocage_admin/)
  })

  it('should serve the real queries of the administration (suspended list, newest first, phone lookup, blocked vitrines)', async () => {
    const suspendus = await planSansBalayageSequentiel(sql`SELECT id FROM users WHERE suspendu`)
    const recents = await planSansBalayageSequentiel(sql`SELECT id FROM users ORDER BY created_at DESC LIMIT 25`)
    const telephone = await planSansBalayageSequentiel(sql`SELECT id FROM users WHERE telephone = '+237653456789'`)
    const bloquees = await planSansBalayageSequentiel(sql`SELECT id FROM vitrines WHERE blocage_admin`)

    expect(suspendus).toContain('users_suspendu_idx')
    expect(recents).toContain('users_cree_le_idx')
    expect(telephone).toContain('users_telephone_idx')
    expect(bloquees).toContain('vitrines_blocage_idx')
  })

  it('should not add an oauth_* index: the three user_id indexes needed by the revocation already exist (0025)', async () => {
    for (const table of ['oauth_access_tokens', 'oauth_refresh_tokens', 'oauth_consents']) {
      const index = await indexDe(table)
      expect(Object.values(index).some((d) => /\(user_id\)/.test(d)), table).toBe(true)
    }
  })
})

describe('migration 0029 : parité entre le schéma Drizzle et la base', () => {
  it.each([
    ['vitrines', vitrines],
    ['abonnements', abonnements],
    ['users', users],
    ['emails_transactionnels', emailsTransactionnels],
  ] as const)('should declare in Drizzle exactly the columns of the table %s', async (nom, table) => {
    const enBase = Object.keys(await colonnes(nom)).sort()
    const enDrizzle = getTableConfig(table).columns.map((c) => c.name).sort()

    expect(enDrizzle).toEqual(enBase)
  })

  it('should declare in Drizzle the indexes and CHECK constraints added by 0029, under the names used in the database', async () => {
    const nomsIndex = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).indexes.map((i) => i.config.name)
    const nomsChecks = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).checks.map((c) => c.name)

    expect(nomsIndex(users)).toEqual(expect.arrayContaining(['users_suspendu_idx', 'users_cree_le_idx', 'users_telephone_idx']))
    expect(nomsIndex(vitrines)).toContain('vitrines_blocage_idx')
    expect(nomsChecks(vitrines)).toContain('vitrines_blocage_check')
    expect(nomsChecks(abonnements)).toContain('abonnements_origine_check')
    for (const nom of [...nomsIndex(users), ...nomsIndex(vitrines)]) expect(Object.keys({ ...(await indexDe('users')), ...(await indexDe('vitrines')) }), nom).toContain(nom)
  })
})

describe('migration 0029 : rejouabilité', () => {
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

  it('should replay twice without error and without losing any data (blocked vitrine, offered abonnement, queued e-mail)', async () => {
    const compte = await createUser()
    const vitrine = await insertVitrineRow(compte.id, { publiee: true })
    await db.execute(sql`UPDATE vitrines SET blocage_admin = true, blocage_motif = ${MOTIF_VALIDE} WHERE id = ${vitrine.id}`)
    const abonnementId = await insererAbonnement(compte.id, 'offert')
    await insererEmail({ type: 'utilisateur_jours_offerts', entiteId: compte.id, occurrence: '7' })

    await rejouer()
    await rejouer()

    const [vitrineRelue] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    const [abonnementRelu] = await db.select().from(abonnements).where(eq(abonnements.id, abonnementId))
    const emails = await db.select({ type: emailsTransactionnels.type, occurrence: emailsTransactionnels.occurrence }).from(emailsTransactionnels)
    expect(vitrineRelue).toMatchObject({ blocageAdmin: true, blocageMotif: MOTIF_VALIDE })
    expect(abonnementRelu?.origine).toBe('offert')
    expect(emails).toEqual([{ type: 'utilisateur_jours_offerts', occurrence: '7' }])
  })

  it('should keep the constraints validated and effective after a replay', async () => {
    await rejouer()

    expect((await contraintes('vitrines')).vitrines_blocage_check?.validee).toBe(true)
    expect((await contraintes('abonnements')).abonnements_origine_check?.validee).toBe(true)
    expect((await contraintes('emails_transactionnels')).emails_transactionnels_type_check?.validee).toBe(true)
    const compte = await createUser()
    const erreur = await rejet(insererAbonnement(compte.id, 'cadeau'))
    expect(erreurPostgres(erreur.brute).sqlstate).toBe(CHECK_VIOLATION)
  })
})
