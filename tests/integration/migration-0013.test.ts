import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Migration 0013 (S6 liens) : le slug d'un lien n'est plus unique GLOBALEMENT (`liens_slug_idx`) mais
// par vitrine (`liens_vitrine_id_slug_unique` sur (vitrine_id, slug)) : les pages publiques sont
// toujours scopées par username. Le test rejoue la chaîne réelle jusqu'à 0012, prouve le blocage
// inter-vitrines AVANT, applique 0013, puis prouve la coexistence inter-vitrines et l'unicité intra-vitrine.
// Aucun bloc ROLLBACK dans 0013 (SQL forward seul) : pas d'aller-retour à rejouer.

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0013_test'
const SEPARATEUR = '--> statement-breakpoint'
const PG_UNIQUE_VIOLATION = '23505'
const INDEX_GLOBAL = 'liens_slug_idx'
const INDEX_PAR_VITRINE = 'liens_vitrine_id_slug_unique'

let client: Client

function fichiersDeMigration(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((fichier) => /^\d{4}_.*\.sql$/.test(fichier))
    .sort()
}

function fichier0013(): string {
  const fichiers = fichiersDeMigration().filter((fichier) => fichier.startsWith('0013_'))
  if (fichiers.length !== 1) {
    throw new Error(`Une seule migration 0013 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  }
  return fichiers[0]!
}

async function appliquer(fichier: string): Promise<void> {
  const contenu = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf-8').replaceAll('"public".', '')
  for (const instruction of contenu.split(SEPARATEUR)) {
    if (instruction.trim() !== '') await client.query(instruction)
  }
}

async function preparerBaseEn0012(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  for (const fichier of fichiersDeMigration().filter((nom) => nom < '0013')) await appliquer(fichier)

  await client.query("INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test'), ('u-b', 'B', 'b@exemple.test')")
  await client.query(
    `INSERT INTO vitrines (id, user_id, username, prenom, nom, metier)
     VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier'),
            ('v-b', 'u-b', 'vitrine-b', 'B', 'B', 'Métier')`,
  )
  await client.query(
    `INSERT INTO liens (id, vitrine_id, libelle, url, type, slug)
     VALUES ('l-a', 'v-a', 'Site A', 'https://a.test', 'site', 'site')`,
  )
}

async function insererLien(id: string, vitrineId: string, slug: string): Promise<void> {
  await client.query(
    `INSERT INTO liens (id, vitrine_id, libelle, url, type, slug) VALUES ($1, $2, 'Lien', 'https://exemple.test', 'site', $3)`,
    [id, vitrineId, slug],
  )
}

async function definitionsIndex(): Promise<Map<string, string>> {
  const resultat = await client.query<{ indexname: string, indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'liens'`,
    [SCHEMA],
  )
  return new Map(resultat.rows.map((ligne) => [ligne.indexname, ligne.indexdef]))
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(preparerBaseEn0012)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0013 : slug des liens unique par vitrine', () => {
  it('bloque avant 0013 le même slug dans deux vitrines (index global liens_slug_idx)', async () => {
    const avant = await definitionsIndex()
    expect(avant.get(INDEX_GLOBAL)).toMatch(/CREATE UNIQUE INDEX .* \(slug\)/i)
    expect(avant.has(INDEX_PAR_VITRINE)).toBe(false)

    await expect(insererLien('l-b', 'v-b', 'site'))
      .rejects.toMatchObject({ code: PG_UNIQUE_VIOLATION, constraint: INDEX_GLOBAL })
  })

  it('remplace l’index global par un index unique sur (vitrine_id, slug)', async () => {
    await appliquer(fichier0013())

    const index = await definitionsIndex()
    expect(index.has(INDEX_GLOBAL)).toBe(false)
    expect(index.get(INDEX_PAR_VITRINE)).toMatch(/CREATE UNIQUE INDEX .* USING btree \(vitrine_id, slug\)/i)
    // Les index non liés au slug survivent à la migration.
    expect(index.has('liens_vitrine_id_idx')).toBe(true)
    expect(index.has('liens_actif_idx')).toBe(true)
  })

  it('autorise le même slug dans deux vitrines après 0013 et conserve les liens existants', async () => {
    await appliquer(fichier0013())

    await expect(insererLien('l-b', 'v-b', 'site')).resolves.toBeUndefined()

    const lignes = await client.query<{ id: string, vitrine_id: string, slug: string }>(
      `SELECT id, vitrine_id, slug FROM liens ORDER BY id`,
    )
    expect(lignes.rows).toEqual([
      { id: 'l-a', vitrine_id: 'v-a', slug: 'site' },
      { id: 'l-b', vitrine_id: 'v-b', slug: 'site' },
    ])
  })

  it('refuse toujours le même slug deux fois dans la même vitrine (23505 sur liens_vitrine_id_slug_unique)', async () => {
    await appliquer(fichier0013())

    await expect(insererLien('l-a2', 'v-a', 'site'))
      .rejects.toMatchObject({ code: PG_UNIQUE_VIOLATION, constraint: INDEX_PAR_VITRINE })
  })

  it('distingue la casse et accepte plusieurs slugs distincts dans une même vitrine', async () => {
    await appliquer(fichier0013())

    await expect(insererLien('l-a2', 'v-a', 'site-2')).resolves.toBeUndefined()
    await expect(insererLien('l-a3', 'v-a', 'Site')).resolves.toBeUndefined()
  })

  it('libère le slug d’une vitrine supprimée (ON DELETE CASCADE) pour la réutiliser ailleurs', async () => {
    await appliquer(fichier0013())
    await client.query(`DELETE FROM vitrines WHERE id = 'v-a'`)

    await expect(insererLien('l-b', 'v-b', 'site')).resolves.toBeUndefined()
  })
})
