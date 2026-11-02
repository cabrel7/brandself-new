import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0016_test'
const BREAKPOINT = '--> statement-breakpoint'

let client: Client

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0016(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0016_'))
  if (files.length !== 1) throw new Error(`Une seule migration 0016 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
  return files[0]!
}

async function apply(file: string): Promise<void> {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replaceAll('"public".', '')
  for (const statement of sql.split(BREAKPOINT)) {
    if (statement.trim() !== '') await client.query(statement)
  }
}

async function prepareAt0015(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0016')) await apply(file)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(prepareAt0015)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0016 : emails transactionnels', () => {
  it('est l’unique migration suivant 0015 et crée l’outbox typée', async () => {
    // S7-bis : la suite 0017 existe désormais ; ce test reste l'unique 0016.
    expect(migrationFiles().filter((file) => file.startsWith('0016_'))).toHaveLength(1)
    expect(migrationFiles().filter((file) => file.startsWith('0015_'))).toHaveLength(1)
    await apply(migration0016())

    const columns = await client.query<{ column_name: string, is_nullable: string, data_type: string }>(
      `SELECT column_name, is_nullable, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'emails_transactionnels'
       ORDER BY ordinal_position`,
      [SCHEMA],
    )
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      'id',
      'type',
      'entite_type',
      'entite_id',
      'statut',
      'tentatives',
      'prochaine_tentative',
      'erreur_code',
      'envoye_le',
      'created_at',
      'updated_at',
    ])
    expect(columns.rows.find(({ column_name }) => column_name === 'prochaine_tentative')?.data_type)
      .toBe('timestamp with time zone')
  })

  it('garantit les statuts, l’unicité logique et l’index partiel des lignes en attente', async () => {
    await apply(migration0016())
    const insert = `INSERT INTO emails_transactionnels
      (id, type, entite_type, entite_id)
      VALUES ($1, 'reservation_visiteur_recue', 'reservation', 'reservation-a')`

    await client.query(insert, ['email-a'])
    await expect(client.query(insert, ['email-b'])).rejects.toMatchObject({ code: '23505' })
    await expect(client.query(
      `INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, statut)
       VALUES ('email-c', 'reservation_visiteur_recue', 'reservation', 'reservation-b', 'inconnu')`,
    )).rejects.toMatchObject({ code: '23514' })

    const indexes = await client.query<{ indexname: string, indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'emails_transactionnels'`,
      [SCHEMA],
    )
    expect(indexes.rows.find(({ indexname }) => indexname === 'emails_transactionnels_pending_idx')?.indexdef)
      .toMatch(/WHERE \(statut = 'en_attente'/i)
    expect(indexes.rows.find(({ indexname }) => indexname === 'emails_transactionnels_entite_evenement_unique')?.indexdef)
      .toMatch(/UNIQUE.*entite_type.*entite_id.*type/i)
  })
})
