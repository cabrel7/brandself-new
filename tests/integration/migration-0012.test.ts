import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Migration 0012 (S6 liens) : ajoute les compteurs hebdomadaires `clics_semaine` et `semaine_debut`
// à `liens`. Le test rejoue la chaîne réelle des migrations jusqu'à 0011 dans un schéma isolé,
// insère des liens EXISTANTS, applique 0012 et vérifie colonnes, défauts, NOT NULL et rétro-remplissage.
// Aucun bloc ROLLBACK n'est fourni par 0012 (SQL forward seul, convention des migrations 0013-0016) :
// il n'y a donc pas d'aller-retour à rejouer.

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0012_test'
const SEPARATEUR = '--> statement-breakpoint'
const PG_NOT_NULL_VIOLATION = '23502'

let client: Client

function fichiersDeMigration(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((fichier) => /^\d{4}_.*\.sql$/.test(fichier))
    .sort()
}

function fichier0012(): string {
  const fichiers = fichiersDeMigration().filter((fichier) => fichier.startsWith('0012_'))
  if (fichiers.length !== 1) {
    throw new Error(`Une seule migration 0012 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  }
  return fichiers[0]!
}

async function appliquer(fichier: string): Promise<void> {
  const contenu = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf-8').replaceAll('"public".', '')
  for (const instruction of contenu.split(SEPARATEUR)) {
    if (instruction.trim() !== '') await client.query(instruction)
  }
}

async function preparerBaseEn0011(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  for (const fichier of fichiersDeMigration().filter((nom) => nom < '0012')) await appliquer(fichier)

  await client.query("INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test')")
  await client.query(
    `INSERT INTO vitrines (id, user_id, username, prenom, nom, metier)
     VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier')`,
  )
  await client.query(
    `INSERT INTO liens (id, vitrine_id, libelle, url, type, slug, clics)
     VALUES ('l-1', 'v-a', 'Site', 'https://exemple.test', 'site', 'site', 42),
            ('l-2', 'v-a', 'Email', 'mailto:a@exemple.test', 'email', 'email', 0)`,
  )
}

interface ColonneLiens {
  nullable: string
  defaut: string | null
  type: string
}

async function colonnesLiens(): Promise<Map<string, ColonneLiens>> {
  const resultat = await client.query<{ column_name: string, is_nullable: string, column_default: string | null, data_type: string }>(
    `SELECT column_name, is_nullable, column_default, data_type
     FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'liens'`,
    [SCHEMA],
  )
  return new Map(resultat.rows.map((ligne) => [
    ligne.column_name,
    { nullable: ligne.is_nullable, defaut: ligne.column_default, type: ligne.data_type },
  ]))
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(preparerBaseEn0011)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0012 : compteurs hebdomadaires de clics des liens', () => {
  it('n’expose pas les colonnes avant 0012 (état de départ prouvé)', async () => {
    const colonnes = await colonnesLiens()

    expect(colonnes.has('clics')).toBe(true)
    expect(colonnes.has('clics_semaine')).toBe(false)
    expect(colonnes.has('semaine_debut')).toBe(false)
  })

  it('ajoute clics_semaine (integer NOT NULL DEFAULT 0) et semaine_debut (date NOT NULL DEFAULT CURRENT_DATE)', async () => {
    await appliquer(fichier0012())

    const colonnes = await colonnesLiens()
    expect(colonnes.get('clics_semaine')).toMatchObject({ type: 'integer', nullable: 'NO' })
    expect(colonnes.get('clics_semaine')?.defaut).toBe('0')
    expect(colonnes.get('semaine_debut')).toMatchObject({ type: 'date', nullable: 'NO' })
    expect(colonnes.get('semaine_debut')?.defaut).toMatch(/CURRENT_DATE/i)
  })

  it('rétro-remplit les liens existants (clics_semaine = 0, semaine_debut = jour d’application) sans toucher au cumul des clics', async () => {
    await appliquer(fichier0012())

    const lignes = await client.query<{ id: string, clics: number, clics_semaine: number, jour_ok: boolean }>(
      `SELECT id, clics, clics_semaine, semaine_debut = CURRENT_DATE AS jour_ok FROM liens ORDER BY id`,
    )
    expect(lignes.rows).toEqual([
      { id: 'l-1', clics: 42, clics_semaine: 0, jour_ok: true },
      { id: 'l-2', clics: 0, clics_semaine: 0, jour_ok: true },
    ])
  })

  it('applique les défauts à un lien créé après la migration sans fournir les nouvelles colonnes', async () => {
    await appliquer(fichier0012())

    await client.query(
      `INSERT INTO liens (id, vitrine_id, libelle, url, type, slug) VALUES ('l-3', 'v-a', 'Autre', 'https://autre.test', 'autre', 'autre')`,
    )

    const ligne = await client.query<{ clics_semaine: number, jour_ok: boolean }>(
      `SELECT clics_semaine, semaine_debut = CURRENT_DATE AS jour_ok FROM liens WHERE id = 'l-3'`,
    )
    expect(ligne.rows[0]).toEqual({ clics_semaine: 0, jour_ok: true })
  })

  it('refuse un NULL explicite sur les deux colonnes (23502)', async () => {
    await appliquer(fichier0012())

    await expect(client.query(`UPDATE liens SET clics_semaine = NULL WHERE id = 'l-1'`))
      .rejects.toMatchObject({ code: PG_NOT_NULL_VIOLATION })
    await expect(client.query(`UPDATE liens SET semaine_debut = NULL WHERE id = 'l-1'`))
      .rejects.toMatchObject({ code: PG_NOT_NULL_VIOLATION })
  })

  it('accepte la remise à zéro hebdomadaire du compteur (écriture de clics_semaine et semaine_debut)', async () => {
    await appliquer(fichier0012())

    await client.query(`UPDATE liens SET clics_semaine = 7, semaine_debut = DATE '2026-10-26' WHERE id = 'l-1'`)

    const ligne = await client.query<{ clics_semaine: number, semaine_debut: string }>(
      `SELECT clics_semaine, to_char(semaine_debut, 'YYYY-MM-DD') AS semaine_debut FROM liens WHERE id = 'l-1'`,
    )
    expect(ligne.rows[0]).toEqual({ clics_semaine: 7, semaine_debut: '2026-10-26' })
  })
})
