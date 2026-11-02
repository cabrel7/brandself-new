import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0014_test'
const SEPARATEUR = '--> statement-breakpoint'

let client: Client

function fichiersDeMigration(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
}

function fichier0014(): string {
  const fichiers = fichiersDeMigration().filter((f) => f.startsWith('0014_'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0014 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return fichiers[0]!
}

async function appliquer(fichier: string): Promise<void> {
  const contenu = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf-8').replaceAll('"public".', '')
  for (const instruction of contenu.split(SEPARATEUR)) {
    if (instruction.trim() !== '') await client.query(instruction)
  }
}

async function preparerBaseEn0013(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  for (const fichier of fichiersDeMigration().filter((f) => f < '0014')) await appliquer(fichier)

  await client.query("INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test'), ('u-b', 'B', 'b@exemple.test')")
  await client.query(
    `INSERT INTO vitrines (id, user_id, username, prenom, nom, metier)
     VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier'),
            ('v-b', 'u-b', 'vitrine-b', 'B', 'B', 'Métier')`,
  )
  await client.query(
    `INSERT INTO temoignages (id, vitrine_id, slug, auteur, texte)
     VALUES ('t-a', 'v-a', 'avis-partage', 'Alice', 'Avis A'),
            ('t-b', 'v-b', 'avis-distinct', 'Alice', 'Avis B')`,
  )
}

async function nomsIndex(): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'temoignages' ORDER BY indexname",
    [SCHEMA],
  )
  return result.rows.map((row) => row.indexname)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(preparerBaseEn0013)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0014 : slug témoignage unique par vitrine', () => {
  it('crée le nouvel index avant de supprimer l’index global', () => {
    const sql = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier0014()), 'utf-8')
    const creation = sql.indexOf('CREATE UNIQUE INDEX "temoignages_vitrine_id_slug_unique"')
    const suppression = sql.indexOf('DROP INDEX "temoignages_slug_idx"')

    expect(creation).toBeGreaterThanOrEqual(0)
    expect(suppression).toBeGreaterThan(creation)
  })

  it('autorise le même slug entre vitrines et le refuse dans une même vitrine sur PostgreSQL réel', async () => {
    await appliquer(fichier0014())

    expect(await nomsIndex()).toContain('temoignages_vitrine_id_slug_unique')
    expect(await nomsIndex()).not.toContain('temoignages_slug_idx')
    await expect(
      client.query("INSERT INTO temoignages (id, vitrine_id, slug, auteur, texte) VALUES ('t-b-2', 'v-b', 'avis-partage', 'Alice', 'Même slug ailleurs')"),
    ).resolves.toBeTruthy()
    await expect(
      client.query("INSERT INTO temoignages (id, vitrine_id, slug, auteur, texte) VALUES ('t-a-2', 'v-a', 'avis-partage', 'Alice', 'Doublon local')"),
    ).rejects.toMatchObject({ code: '23505', constraint: 'temoignages_vitrine_id_slug_unique' })
  })
})
