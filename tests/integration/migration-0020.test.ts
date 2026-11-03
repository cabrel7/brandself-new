import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TRANSACTIONAL_EMAIL_TYPES } from '../../shared/jobs'
import { EMAIL_CATEGORIES, EMAIL_STATUTS } from '../../shared/notifications'
import { NEXT_STEPS } from '../../shared/vitrine'

// S9 §2 / CA01 à CA06 : la migration 0020 (préférence « rendez-vous du jour », étapes ignorées, partage, outbox
// planifiée). Elle tourne dans un schéma jetable (`mig0020_test`) de la base de test : la base partagée et son
// journal drizzle ne sont jamais touchés. RÈGLE : toute instruction de 0020 et de son ROLLBACK est QUALIFIÉE par ce
// schéma avant exécution (`qualifier`), donc un nom d'objet absent du schéma jetable fait ÉCHOUER l'instruction au
// lieu de viser l'objet homonyme de `public` (jamais de DROP / ALTER / DELETE non qualifié).
// La ligne « DELETE FROM drizzle.__drizzle_migrations » du ROLLBACK n'est jamais exécutée (elle viserait le vrai
// journal) : on vérifie seulement qu'elle cible le `when` de l'entrée idx 20 de meta/_journal.json.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0020_test'
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const NO_UNIQUE_FOR_ON_CONFLICT = '42P10'
const LIGNE_ROLLBACK = /^-- (BEGIN|ALTER|DELETE|COMMIT|DROP|CREATE)\b/
const NOUVEAUX_TYPES = ['reservation_visiteur_rappel', 'utilisateur_resume_hebdo', 'utilisateur_rappel_journee'] as const
const TABLES_SUIVIES = ['users', 'vitrines', 'emails_transactionnels'] as const

let client: Client

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0020(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0020_'))
  if (files.length !== 1) {
    throw new Error(`Une seule migration 0020 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
  }
  return files[0]!
}

function lireBrut(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
}

/** Migrations antérieures : DDL non qualifié, résolu dans le schéma jetable grâce au search_path. */
function lireAnterieure(file: string): string {
  return lireBrut(file).replaceAll('"public".', '')
}

/** Qualifie par le schéma jetable chaque table, index et cible de DELETE nommés par 0020 ou son ROLLBACK. */
function qualifier(sql: string): string {
  return sql
    .replaceAll('"public".', '')
    .replace(/\b(ALTER TABLE|DELETE FROM|FROM|ON) "(\w+)"/g, `$1 ${SCHEMA}."$2"`)
    .replace(/\bDROP INDEX "(\w+)"/g, `DROP INDEX ${SCHEMA}."$1"`)
}

async function assertSchemaJetable(): Promise<void> {
  const resultat = await client.query<{ present: string | null }>('SELECT to_regclass($1) AS present', [`${SCHEMA}.emails_transactionnels`])
  if (resultat.rows[0]?.present === null) {
    throw new Error(`${SCHEMA}.emails_transactionnels introuvable : refus d'exécuter du DDL (il viserait le schéma public).`)
  }
}

async function executer(sql: string, qualifie: boolean): Promise<void> {
  for (const statement of sql.split(BREAKPOINT)) {
    if (statement.trim() !== '') await client.query(qualifie ? qualifier(statement) : statement)
  }
}

async function appliquer0020(): Promise<void> {
  await assertSchemaJetable()
  await executer(lireBrut(migration0020()), true)
}

interface Rollback {
  /** BEGIN, instructions, COMMIT, sans la ligne de journal. */
  executables: string[]
  ligneJournal: string | undefined
}

function rollback(): Rollback {
  const instructions = lireBrut(migration0020())
    .split('\n')
    .filter((ligne) => LIGNE_ROLLBACK.test(ligne))
    .map((ligne) => ligne.replace(/^-- /, '').replace(/\s*--\s.*$/, ''))
  return {
    executables: instructions.filter((ligne) => !ligne.startsWith('DELETE FROM drizzle.')),
    ligneJournal: instructions.find((ligne) => ligne.startsWith('DELETE FROM drizzle.')),
  }
}

async function executerRollback(): Promise<void> {
  await assertSchemaJetable()
  try {
    for (const instruction of rollback().executables) await client.query(qualifier(instruction))
  } catch (erreur) {
    await client.query('ROLLBACK')
    throw erreur
  }
}

async function prepareAt0019(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0020')) await executer(lireAnterieure(file), false)
  await client.query(`INSERT INTO ${SCHEMA}.users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test')`)
  await client.query(`
    INSERT INTO ${SCHEMA}.vitrines (id, user_id, username, prenom, nom, metier)
    VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier')`)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(prepareAt0019)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

interface LigneOutbox {
  type?: string
  entite_type?: string
  entite_id?: string
  occurrence?: string
  categorie?: string
  statut?: string
  erreur_code?: string | null
}

/** Insère une ligne d'outbox ; `envoye_le` suit le statut (CHECK d'origine). */
async function outbox(valeurs: LigneOutbox = {}): Promise<string> {
  const id = randomUUID()
  const colonnes: Record<string, unknown> = {
    id,
    type: 'reservation_visiteur_recue',
    entite_type: 'reservation',
    entite_id: `r-${id}`,
    ...valeurs,
  }
  if (colonnes.statut === 'envoye') colonnes.envoye_le = new Date('2026-11-02T08:00:00Z')
  const noms = Object.keys(colonnes)
  await client.query(
    `INSERT INTO ${SCHEMA}.emails_transactionnels (${noms.join(', ')}) VALUES (${noms.map((_, i) => `$${i + 1}`).join(', ')})`,
    noms.map((nom) => colonnes[nom]),
  )
  return id
}

function ligneUtilisateur(type: (typeof NOUVEAUX_TYPES)[number] | 'utilisateur_resume_hebdo', surcharge: LigneOutbox = {}): LigneOutbox {
  return {
    type,
    entite_type: 'utilisateur',
    entite_id: 'u-a',
    occurrence: '2026-W44',
    categorie: type === 'utilisateur_resume_hebdo' ? 'relationnel' : 'transactionnel',
    ...surcharge,
  }
}

async function compter(sql: string): Promise<number> {
  const resultat = await client.query<{ n: string }>(sql)
  return Number(resultat.rows[0]!.n)
}

async function structure(): Promise<unknown> {
  const sortie: Record<string, unknown> = {}
  for (const table of TABLES_SUIVIES) {
    const colonnes = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [SCHEMA, table],
    )
    const contraintes = await client.query(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = $2 ORDER BY c.conname`,
      [SCHEMA, table],
    )
    const index = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [SCHEMA, table],
    )
    sortie[table] = { colonnes: colonnes.rows, contraintes: contraintes.rows, index: index.rows }
  }
  return sortie
}

/** Valeurs entre apostrophes d'une contrainte nommée dans le fichier 0020 (ajout seulement). */
function valeursContrainte(nom: string): string[] {
  const contenu = lireBrut(migration0020())
  const debut = contenu.indexOf(`ADD CONSTRAINT "${nom}"`)
  if (debut === -1) throw new Error(`Contrainte ${nom} absente de 0020.`)
  const fin = contenu.indexOf(`;${BREAKPOINT}`, debut)
  const corps = contenu.slice(debut, fin === -1 ? contenu.indexOf(';\n', debut) : fin)
  return [...corps.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('migration 0020 : fichier, journal et synchronisation avec shared/', () => {
  it('est l’unique migration 0020, sans trou dans la numérotation, et laisse 0019 en place', () => {
    const numeros = migrationFiles().map((file) => Number(file.slice(0, 4)))

    expect(migrationFiles().filter((file) => file.startsWith('0020_'))).toHaveLength(1)
    expect(migration0020()).toMatch(/^0020_.*\.sql$/)
    expect(numeros).toEqual(numeros.map((_, index) => index))
    expect(migrationFiles().filter((file) => file.startsWith('0019_'))).toHaveLength(1)
  })

  it('est enregistrée à l’index 20 du journal drizzle, et le ROLLBACK retire cette même entrée', () => {
    const journal = JSON.parse(lireBrut('meta/_journal.json')) as { entries: Array<{ idx: number, tag: string, when: number }> }
    const entree = journal.entries.find((candidate) => candidate.idx === 20)
    const precedente = journal.entries.find((candidate) => candidate.idx === 19)

    expect(entree?.tag).toBe(migration0020().replace(/\.sql$/, ''))
    expect(entree!.when).toBeGreaterThan(precedente!.when)
    expect(rollback().ligneJournal).toContain(String(entree?.when))
  })

  it('reste dans la transaction de drizzle (aucun CONCURRENTLY) et ne contient aucun DROP TABLE', () => {
    const instructions = lireBrut(migration0020())
      .split('\n')
      .filter((ligne) => !ligne.startsWith('--'))
      .join('\n')

    expect(instructions).not.toMatch(/CONCURRENTLY/i)
    expect(instructions).not.toMatch(/DROP TABLE/i)
    expect(instructions).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('commence par le contrôle préalable du nom d’utilisateur réservé « desabonnement » (CA06)', () => {
    const code = lireBrut(migration0020()).split('\n').filter((ligne) => !ligne.startsWith('--')).join('\n').trim()

    expect(code.startsWith('DO $$')).toBe(true)
    expect(code).toMatch(/"username" = 'desabonnement'/)
    expect(code).toMatch(/RAISE EXCEPTION 'username réservé desabonnement déjà utilisé'/)
  })

  it('recopie exactement TRANSACTIONAL_EMAIL_TYPES dans la CHECK des types', () => {
    expect(valeursContrainte('emails_transactionnels_type_check')).toEqual([...TRANSACTIONAL_EMAIL_TYPES])
  })

  it('recopie exactement EMAIL_STATUTS et EMAIL_CATEGORIES dans leurs CHECK', () => {
    expect(valeursContrainte('emails_transactionnels_statut_check')).toEqual([...EMAIL_STATUTS])
    expect(valeursContrainte('emails_transactionnels_categorie_check')).toEqual([...EMAIL_CATEGORIES])
  })

  it('recopie exactement NEXT_STEPS dans la CHECK des étapes ignorées', () => {
    expect(valeursContrainte('vitrines_etapes_ignorees_check')).toEqual([...NEXT_STEPS])
  })

  it('exige une occurrence pour les trois nouveaux types, et seulement eux', () => {
    expect(valeursContrainte('emails_transactionnels_occurrence_requise_check')).toEqual([...NOUVEAUX_TYPES])
    expect(NOUVEAUX_TYPES.every((type) => (TRANSACTIONAL_EMAIL_TYPES as readonly string[]).includes(type))).toBe(true)
  })

  it('lie la catégorie relationnelle au seul résumé hebdomadaire', () => {
    expect(valeursContrainte('emails_transactionnels_categorie_type_check')).toContain('utilisateur_resume_hebdo')
    expect(valeursContrainte('emails_transactionnels_categorie_type_check')).toContain('relationnel')
  })

  it('a un snapshot qui décrit les nouvelles colonnes (le dernier snapshot reflète le schéma)', () => {
    const snapshot = JSON.parse(lireBrut('meta/0020_snapshot.json')) as { tables: Record<string, { columns: Record<string, unknown> }> }

    expect(Object.keys(snapshot.tables['public.emails_transactionnels']!.columns)).toEqual(expect.arrayContaining(['occurrence', 'categorie']))
    expect(Object.keys(snapshot.tables['public.users']!.columns)).toContain('email_rappel_jour')
    expect(Object.keys(snapshot.tables['public.vitrines']!.columns)).toEqual(expect.arrayContaining(['etapes_ignorees', 'partagee_le']))
  })

  it('qualifie toute instruction par le schéma jetable avant exécution (aucun DROP / ALTER visant public)', () => {
    const instructions = [...lireBrut(migration0020()).split(BREAKPOINT), ...rollback().executables]
      .map((s) => qualifier(s))
      .join('\n')
      .split('\n')
      .filter((ligne) => !ligne.trim().startsWith('--'))
      .join('\n')

    expect(instructions).not.toMatch(/\bALTER TABLE "/)
    expect(instructions).not.toMatch(/\bDROP INDEX "/)
    expect(instructions).not.toMatch(/\bDELETE FROM "/)
  })
})

describe('migration 0020 : état avant (0019 seule)', () => {
  it('n’a aucune des nouvelles colonnes', async () => {
    const resultat = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = $1 AND
        ((table_name = 'emails_transactionnels' AND column_name IN ('occurrence','categorie'))
         OR (table_name = 'users' AND column_name = 'email_rappel_jour')
         OR (table_name = 'vitrines' AND column_name IN ('etapes_ignorees','partagee_le')))`,
      [SCHEMA],
    )

    expect(Number(resultat.rows[0]!.n)).toBe(0)
  })

  it('refuse le statut annule et les types utilisateur_* (23514)', async () => {
    await expect(outbox({ statut: 'annule' })).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox({ type: 'utilisateur_resume_hebdo', entite_type: 'utilisateur' })).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })
})

describe('migration 0020 : état après', () => {
  it('s’applique en une passe sur une base en 0019', async () => {
    await expect(appliquer0020()).resolves.toBeUndefined()
  })

  it('ajoute les colonnes avec leurs types, défauts et nullité (users, vitrines, outbox)', async () => {
    await appliquer0020()

    const resultat = await client.query<{ table_name: string, column_name: string, data_type: string, is_nullable: string, column_default: string | null }>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND column_name IN ('email_rappel_jour','etapes_ignorees','partagee_le','occurrence','categorie')
       ORDER BY table_name, column_name`,
      [SCHEMA],
    )
    const colonnes = Object.fromEntries(resultat.rows.map((c) => [`${c.table_name}.${c.column_name}`, c]))

    expect(colonnes['users.email_rappel_jour']).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'true' })
    expect(colonnes['vitrines.etapes_ignorees']).toMatchObject({ data_type: 'ARRAY', is_nullable: 'NO' })
    expect(colonnes['vitrines.etapes_ignorees']!.column_default).toMatch(/^'\{\}'::text\[\]$/)
    expect(colonnes['vitrines.partagee_le']).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null })
    expect(colonnes['emails_transactionnels.occurrence']).toMatchObject({ data_type: 'text', is_nullable: 'NO', column_default: "''::text" })
    expect(colonnes['emails_transactionnels.categorie']).toMatchObject({ data_type: 'text', is_nullable: 'NO', column_default: "'transactionnel'::text" })
  })

  it('donne aux lignes existantes le sens d’avant S9 : occurrence vide, catégorie transactionnelle, préférence active, aucune étape ignorée', async () => {
    const envoyee = await outbox({ statut: 'envoye' })

    await appliquer0020()

    const ligne = await client.query(`SELECT occurrence, categorie, statut FROM ${SCHEMA}.emails_transactionnels WHERE id = $1`, [envoyee])
    expect(ligne.rows[0]).toEqual({ occurrence: '', categorie: 'transactionnel', statut: 'envoye' })
    const user = await client.query(`SELECT email_rappel_jour FROM ${SCHEMA}.users WHERE id = 'u-a'`)
    expect(user.rows[0]).toEqual({ email_rappel_jour: true })
    const vitrine = await client.query(`SELECT etapes_ignorees, partagee_le FROM ${SCHEMA}.vitrines WHERE id = 'v-a'`)
    expect(vitrine.rows[0]).toEqual({ etapes_ignorees: [], partagee_le: null })
  })

  it('refuse un résumé, un rappel visiteur ou un rendez-vous du jour sans occurrence (CA01, occurrence_requise_check)', async () => {
    await appliquer0020()

    for (const type of NOUVEAUX_TYPES) {
      const entite = type === 'reservation_visiteur_rappel' ? { entite_type: 'reservation', entite_id: 'r-1', categorie: 'transactionnel' } : ligneUtilisateur(type)
      await expect(outbox({ ...entite, type, occurrence: '' }), type).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'emails_transactionnels_occurrence_requise_check',
      })
    }
  })

  it('refuse deux fois la même occurrence (CA02) mais accepte une autre semaine, un autre utilisateur, un autre type', async () => {
    await appliquer0020()
    await outbox(ligneUtilisateur('utilisateur_resume_hebdo'))

    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo'))).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'emails_transactionnels_entite_evenement_unique',
    })
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { occurrence: '2026-W45' }))).resolves.toEqual(expect.any(String))
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { entite_id: 'u-b' }))).resolves.toEqual(expect.any(String))
    await expect(outbox(ligneUtilisateur('utilisateur_rappel_journee', { occurrence: '2026-W44' }))).resolves.toEqual(expect.any(String))
  })

  it('n’insère aucune seconde ligne avec ON CONFLICT (…4 colonnes) DO NOTHING (CA02, idempotence par occurrence)', async () => {
    await appliquer0020()
    const insertion = (id: string) => client.query(
      `INSERT INTO ${SCHEMA}.emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie)
       VALUES ($1, 'utilisateur_rappel_journee', 'utilisateur', 'u-a', '2026-11-10', 'transactionnel')
       ON CONFLICT (entite_type, entite_id, type, occurrence) DO NOTHING`,
      [id],
    )

    const premiere = await insertion(randomUUID())
    const seconde = await insertion(randomUUID())

    expect(premiere.rowCount).toBe(1)
    expect(seconde.rowCount).toBe(0)
    expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.emails_transactionnels WHERE type = 'utilisateur_rappel_journee'`)).toBe(1)
  })

  it('garde l’idempotence des types S7 (occurrence vide) : deux lignes identiques sont refusées', async () => {
    await appliquer0020()
    const ligne = { type: 'message_professionnel_nouvelle', entite_type: 'message', entite_id: 'm-1' }
    await outbox(ligne)

    await expect(outbox(ligne)).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })

  it('casse l’ancienne cible ON CONFLICT à 3 colonnes (42P10) : le code S9 doit être déployé avec la migration', async () => {
    await appliquer0020()

    await expect(client.query(
      `INSERT INTO ${SCHEMA}.emails_transactionnels (id, type, entite_type, entite_id)
       VALUES ($1, 'reservation_visiteur_recue', 'reservation', 'r-1')
       ON CONFLICT (entite_type, entite_id, type) DO NOTHING`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: NO_UNIQUE_FOR_ON_CONFLICT })
  })

  it('refuse la catégorie relationnelle sur un rappel visiteur et la catégorie transactionnelle sur un résumé (CA03)', async () => {
    await appliquer0020()

    await expect(outbox({ type: 'reservation_visiteur_rappel', occurrence: '2026-11-12T09:00:00.000Z', categorie: 'relationnel' }))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_type_check' })
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { categorie: 'transactionnel' })))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_type_check' })
    await expect(outbox({ categorie: 'relationnel' }))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_type_check' })
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo'))).resolves.toEqual(expect.any(String))
  })

  it('refuse une catégorie inconnue', async () => {
    await appliquer0020()

    await expect(outbox({ categorie: 'promotionnel' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_check' })
  })

  it.each([
    ['majuscules seulement : minuscule refusée', 'abc', false],
    ['espace refusé', '2026 W44', false],
    ['33 caractères refusés', 'A'.repeat(33), false],
    ['32 caractères acceptés', 'A'.repeat(32), true],
    ['semaine ISO', '2026-W44', true],
    ['date locale', '2026-11-10', true],
    ['début en ISO UTC', '2026-11-12T09:00:00.000Z', true],
    ['caractère accentué refusé', '2026-É44', false],
    ['saut de ligne refusé', '2026-W44\n', false],
  ])('contrôle le format de l’occurrence : %s', async (_libelle, occurrence, accepte) => {
    await appliquer0020()
    const insertion = outbox(ligneUtilisateur('utilisateur_rappel_journee', { occurrence }))

    if (accepte) await expect(insertion).resolves.toEqual(expect.any(String))
    else await expect(insertion).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('accepte l’entité « utilisateur » seulement avec un type utilisateur_* et refuse les croisements', async () => {
    await appliquer0020()

    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { entite_type: 'reservation' })))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
    await expect(outbox({ type: 'message_professionnel_nouvelle', entite_type: 'utilisateur', entite_id: 'u-a' }))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
    await expect(outbox({ type: 'reservation_visiteur_rappel', entite_type: 'demande', occurrence: '2026-11-12T09:00:00.000Z' }))
      .rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { entite_type: 'compte' })))
      // « compte » viole entite_type_check ET entite_coherence_check : Postgres rapporte le premier par ordre alphabétique.
      .rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox({ type: 'utilisateur_inconnu', entite_type: 'utilisateur', occurrence: 'X' }))
      .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_type_check' })
  })

  it('accepte le statut annule avec un code de motif, et refuse un statut inconnu', async () => {
    await appliquer0020()

    await expect(outbox({ statut: 'annule', erreur_code: 'RESERVATION_ANNULEE' })).resolves.toEqual(expect.any(String))
    await expect(outbox({ statut: 'perdu' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_statut_check' })
  })

  it('refuse une étape ignorée inconnue et accepte tout sous-ensemble des cinq étapes (CA04)', async () => {
    await appliquer0020()
    const maj = (valeur: string) => client.query(`UPDATE ${SCHEMA}.vitrines SET etapes_ignorees = $1::text[] WHERE id = 'v-a'`, [valeur])

    await expect(maj('{autre}')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'vitrines_etapes_ignorees_check' })
    await expect(maj('{photo,temoignage}')).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(maj('{}')).resolves.toBeDefined()
    await expect(maj('{photo}')).resolves.toBeDefined()
    await expect(maj(`{${NEXT_STEPS.join(',')}}`)).resolves.toBeDefined()
  })

  it('refuse aussi une étape inconnue à l’insertion d’une vitrine', async () => {
    await appliquer0020()
    await client.query(`INSERT INTO ${SCHEMA}.users (id, name, email) VALUES ('u-b', 'B', 'b@exemple.test')`)

    await expect(client.query(
      `INSERT INTO ${SCHEMA}.vitrines (id, user_id, username, prenom, nom, metier, etapes_ignorees)
       VALUES ('v-b', 'u-b', 'vitrine-b', 'B', 'B', 'Métier', '{inconnue}')`,
    )).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('crée les index partiels du plafond relationnel et de la purge, et l’unicité à 4 colonnes', async () => {
    await appliquer0020()

    const resultat = await client.query<{ indexname: string, indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'emails_transactionnels'`,
      [SCHEMA],
    )
    const index = Object.fromEntries(resultat.rows.map((i) => [i.indexname, i.indexdef]))

    expect(index.emails_transactionnels_entite_evenement_unique).toMatch(/UNIQUE.*\(entite_type, entite_id, type, occurrence\)/)
    expect(index.emails_transactionnels_relationnel_idx).toMatch(/\(entite_id, created_at\).*WHERE \(categorie = 'relationnel'/)
    expect(index.emails_transactionnels_terminal_idx).toMatch(/\(updated_at\).*WHERE \(statut = ANY|WHERE \(statut IN/)
    expect(index.emails_transactionnels_pending_idx).toMatch(/WHERE \(statut = 'en_attente'/)
  })

  it('échoue avec un message explicite, sans rien modifier, quand une vitrine porte déjà le nom « desabonnement » (CA06)', async () => {
    await client.query(`INSERT INTO ${SCHEMA}.users (id, name, email) VALUES ('u-d', 'D', 'd@exemple.test')`)
    await client.query(`
      INSERT INTO ${SCHEMA}.vitrines (id, user_id, username, prenom, nom, metier)
      VALUES ('v-d', 'u-d', 'desabonnement', 'D', 'D', 'Métier')`)

    await expect(appliquer0020()).rejects.toThrow(/desabonnement/)

    const colonnes = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'email_rappel_jour'`,
      [SCHEMA],
    )
    expect(colonnes.rows).toHaveLength(0)
  })
})

describe('migration 0020 : ROLLBACK documenté (CA05)', () => {
  it('est un bloc BEGIN … COMMIT, qui commence par supprimer les lignes que l’ancien schéma ne connaît pas', () => {
    const { executables } = rollback()

    expect(executables[0]).toBe('BEGIN;')
    expect(executables.at(-1)).toBe('COMMIT;')
    expect(executables[1]).toMatch(/^DELETE FROM "emails_transactionnels" WHERE .*"statut" = 'annule'.*"occurrence" <> ''/)
    for (const type of NOUVEAUX_TYPES) expect(executables[1]).toContain(`'${type}'`)
    expect(executables.join('\n')).not.toMatch(/DROP TABLE/i)
  })

  it('cible l’entrée idx 20 du journal drizzle (ligne non exécutée ici)', () => {
    expect(rollback().ligneJournal).toMatch(/^DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = \d+/)
  })

  it('documente ses échecs possibles et l’arrêt préalable du worker', () => {
    const contenu = lireBrut(migration0020())

    expect(contenu).toMatch(/ÉCHOUE/)
    expect(contenu).toMatch(/ARRÊTER le worker/)
    expect(contenu).toMatch(/23514/)
    expect(contenu).toMatch(/23505/)
  })

  it('restaure exactement la structure d’avant (colonnes, contraintes, index de users, vitrines et outbox)', async () => {
    const avant = await structure()
    await appliquer0020()
    expect(await structure()).not.toEqual(avant)

    await executerRollback()

    expect(await structure()).toEqual(avant)
  })

  it('supprime les lignes S9 et les annulations, et conserve les e-mails S7 déjà envoyés', async () => {
    const envoyee = await outbox({ statut: 'envoye' })
    const enAttente = await outbox({ type: 'message_professionnel_nouvelle', entite_type: 'message', entite_id: 'm-1' })
    await appliquer0020()
    await outbox(ligneUtilisateur('utilisateur_resume_hebdo'))
    await outbox({ type: 'reservation_visiteur_rappel', occurrence: '2026-11-12T09:00:00.000Z' })
    await outbox({ statut: 'annule', erreur_code: 'RESERVATION_ANNULEE' })

    await executerRollback()

    const restantes = await client.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.emails_transactionnels ORDER BY id`)
    expect(restantes.rows.map((ligne) => ligne.id).sort()).toEqual([envoyee, enAttente].sort())
  })

  it('rétablit l’ancien comportement : statut annule et types S9 refusés, ancienne cible ON CONFLICT à 3 colonnes de nouveau valide', async () => {
    await appliquer0020()
    await executerRollback()

    await expect(client.query(`
      INSERT INTO ${SCHEMA}.emails_transactionnels (id, type, entite_type, entite_id, statut)
      VALUES ('${randomUUID()}', 'reservation_visiteur_recue', 'reservation', 'r-9', 'annule')`)).rejects.toMatchObject({ code: CHECK_VIOLATION })
    const ancienneCible = await client.query(
      `INSERT INTO ${SCHEMA}.emails_transactionnels (id, type, entite_type, entite_id)
       VALUES ($1, 'reservation_visiteur_recue', 'reservation', 'r-9')
       ON CONFLICT (entite_type, entite_id, type) DO NOTHING`,
      [randomUUID()],
    )
    expect(ancienneCible.rowCount).toBe(1)
  })

  it('retire les colonnes S9 de users et vitrines', async () => {
    await appliquer0020()

    await executerRollback()

    const resultat = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = $1 AND
        ((table_name = 'users' AND column_name = 'email_rappel_jour') OR (table_name = 'vitrines' AND column_name IN ('etapes_ignorees','partagee_le')))`,
      [SCHEMA],
    )
    expect(Number(resultat.rows[0]!.n)).toBe(0)
  })

  it('peut se rejouer : montée, ROLLBACK, remontée, puis les contraintes S9 sont de nouveau actives (up / down / up)', async () => {
    await appliquer0020()
    await executerRollback()

    await expect(appliquer0020()).resolves.toBeUndefined()

    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo', { occurrence: '' }))).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox(ligneUtilisateur('utilisateur_resume_hebdo'))).resolves.toEqual(expect.any(String))
    await expect(client.query(`UPDATE ${SCHEMA}.vitrines SET etapes_ignorees = '{autre}' WHERE id = 'v-a'`)).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('échoue (et annule tout) quand une ligne annulée subsiste au moment de recréer l’ancienne CHECK (cas « a » documenté) ; la structure S9 reste en place', async () => {
    await appliquer0020()
    await outbox({ statut: 'annule', erreur_code: 'RESERVATION_ANNULEE' })
    // Simule un worker encore actif : le DELETE initial est sauté, la ligne annulée subsiste.
    const [begin, , ...suite] = rollback().executables
    let echec: unknown

    try {
      await client.query(begin!)
      for (const instruction of suite) await client.query(qualifier(instruction))
    } catch (erreur) {
      echec = erreur
      await client.query('ROLLBACK')
    }

    expect(echec).toMatchObject({ code: CHECK_VIOLATION })
    const colonne = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'emails_transactionnels' AND column_name = 'occurrence'`,
      [SCHEMA],
    )
    expect(colonne.rows).toHaveLength(1)
  })
})
