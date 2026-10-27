import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// S4-CA01 — la migration 0011 sur des données réelles : base en 0010, données « sales », application
// de 0011, vérification, puis ROLLBACK (bloc commenté du fichier) et ré-application.
//
// Isolation : un SCHÉMA temporaire (jamais le schéma public des autres tests). Les fichiers de
// migration sont rejoués à la main (les mêmes que ceux de drizzle, découpés sur `--> statement-breakpoint`)
// avec `search_path` limité au schéma temporaire. Aucune autorisation CREATEDB n'est requise.

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0011_test'
const SEPARATEUR = '--> statement-breakpoint'
const FICHIER = '0011_s4_realisations.sql'
const NB_CHECK_REALISATIONS = 5

let client: Client

function fichiersDeMigration(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
}

async function appliquer(fichier: string): Promise<void> {
  const sql = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf-8').replaceAll('"public".', '')
  for (const instruction of sql.split(SEPARATEUR)) {
    if (instruction.trim() !== '') await client.query(instruction)
  }
}

/** Bloc ROLLBACK de 0011 : lignes `-- ...` entre `-- BEGIN;` et `-- COMMIT;`, sans la ligne du journal drizzle. */
function sqlDeRollback(): string {
  const lignes = readFileSync(path.join(DOSSIER_MIGRATIONS, FICHIER), 'utf-8').split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin === -1) throw new Error('Bloc ROLLBACK (-- BEGIN; ... -- COMMIT;) introuvable dans 0011.')
  return lignes
    .slice(debut + 1, fin)
    .filter((l) => !l.includes('__drizzle_migrations'))
    .map((l) => l.replace(/^--\s?/, ''))
    .join('\n')
}

const hex8 = (id: string) => createHash('md5').update(id).digest('hex').slice(0, 8)

async function tableExiste(table: string): Promise<boolean> {
  const r = await client.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [SCHEMA, table])
  return r.rowCount === 1
}

async function contraintes(table: string) {
  const r = await client.query<{ conname: string, convalidated: boolean, contype: string }>(
    `SELECT c.conname, c.convalidated, c.contype FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2`,
    [SCHEMA, table],
  )
  return r.rows
}

async function nomsIndex(table: string): Promise<string[]> {
  const r = await client.query<{ indexname: string }>('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2', [SCHEMA, table])
  return r.rows.map((l) => l.indexname)
}

async function realisation(id: string) {
  const r = await client.query('SELECT * FROM realisations WHERE id = $1', [id])
  return r.rows[0] as Record<string, unknown> | undefined
}

/** Insère une réalisation au schéma 0010 (aucune contrainte métier, aucune FK sur l'image). */
async function insererRealisation(valeurs: Record<string, unknown>): Promise<void> {
  const defauts = { titre: 'Titre', vitrine_id: 'v-a' }
  const ligne = { ...defauts, ...valeurs }
  const cles = Object.keys(ligne)
  await client.query(
    `INSERT INTO realisations (${cles.join(', ')}) VALUES (${cles.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(ligne),
  )
}

async function preparerBaseEn0010(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  for (const fichier of fichiersDeMigration().filter((f) => f < '0011')) {
    await appliquer(fichier)
  }
}

async function insererDonneesSales(): Promise<void> {
  await client.query(`INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.com'), ('u-b', 'B', 'b@exemple.com')`)
  await client.query(
    `INSERT INTO vitrines (id, user_id, username, prenom, nom, metier, titre, ville, pays)
     VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier', 'dr', 'Douala', 'CM'),
            ('v-b', 'u-b', 'vitrine-b', 'B', 'B', 'Métier', 'dr', 'Douala', 'CM')`,
  )
  await client.query(
    `INSERT INTO medias (id, user_id, chemin, mime, taille) VALUES
       ('m-a', 'u-a', 'u-a/m-a', 'image/webp', 100), ('m-b', 'u-b', 'u-b/m-b', 'image/webp', 100)`,
  )

  // Vitrine A : slugs.
  await insererRealisation({ id: 'r-dup-1', slug: 'projet', titre: 'Projet 1' })
  await insererRealisation({ id: 'r-dup-2', slug: 'projet', titre: 'Projet 2' })
  await insererRealisation({ id: 'r-slug-invalide', slug: 'Mon Slug!' })
  await insererRealisation({ id: 'r-slug-vide', slug: '' })
  await insererRealisation({ id: 'r-slug-long', slug: 'a'.repeat(81) })
  await insererRealisation({ id: 'r-slug-ok', slug: 'un-slug-correct' })
  // Vitrine B : le même slug dans une AUTRE vitrine est légitime et ne doit pas être touché.
  await insererRealisation({ id: 'r-b-projet', slug: 'projet', vitrine_id: 'v-b' })

  // Images.
  await insererRealisation({ id: 'r-image-de-b', slug: 'image-de-b', image_media_id: 'm-b' })
  await insererRealisation({ id: 'r-image-de-a', slug: 'image-de-a', image_media_id: 'm-a' })
  await insererRealisation({ id: 'r-image-fantome', slug: 'image-fantome', image_media_id: 'm-n-existe-pas' })

  // Liens (javascript: dans un href public = vecteur XSS).
  await insererRealisation({ id: 'r-lien-js', slug: 'lien-js', lien: 'javascript:alert(1)' })
  await insererRealisation({ id: 'r-lien-www', slug: 'lien-www', lien: 'www.chu-douala.cm' })
  await insererRealisation({ id: 'r-lien-espaces', slug: 'lien-espaces', lien: '  https://x.cm  ' })
  await insererRealisation({ id: 'r-lien-ftp', slug: 'lien-ftp', lien: 'ftp://x.cm' })
  await insererRealisation({ id: 'r-lien-mailto', slug: 'lien-mailto', lien: 'mailto:a@b.cm' })
  await insererRealisation({ id: 'r-lien-vide', slug: 'lien-vide', lien: '' })
  await insererRealisation({ id: 'r-lien-blanc', slug: 'lien-blanc', lien: '   ' })
  await insererRealisation({ id: 'r-lien-sans-point', slug: 'lien-sans-point', lien: 'localhost' })
  await insererRealisation({ id: 'r-lien-espace-interne', slug: 'lien-espace-interne', lien: 'https://x.cm/a b' })
  await insererRealisation({ id: 'r-lien-long', slug: 'lien-long', lien: `https://x.cm/${'a'.repeat(500)}` })
  await insererRealisation({ id: 'r-lien-majuscules', slug: 'lien-majuscules', lien: 'HTTP://X.CM' })
  await insererRealisation({ id: 'r-lien-ok', slug: 'lien-ok', lien: 'https://chu-douala.cm/projet?a=1#b' })

  // Année, ordre, textes.
  await insererRealisation({ id: 'r-annee-1800', slug: 'annee-1800', annee: 1800 })
  await insererRealisation({ id: 'r-annee-2101', slug: 'annee-2101', annee: 2101 })
  await insererRealisation({ id: 'r-annee-1900', slug: 'annee-1900', annee: 1900 })
  await insererRealisation({ id: 'r-annee-2100', slug: 'annee-2100', annee: 2100 })
  await insererRealisation({ id: 'r-ordre-negatif', slug: 'ordre-negatif', ordre: -1 })
  await insererRealisation({ id: 'r-description-blanche', slug: 'description-blanche', description: '  ' })
  await insererRealisation({ id: 'r-description-ok', slug: 'description-ok', description: 'Un texte' })
  await insererRealisation({ id: 'r-lieu-role', slug: 'lieu-role', lieu: ' Douala ', role: '   ' })
  await insererRealisation({ id: 'r-lieu-blanc', slug: 'lieu-blanc', lieu: '  ', role: ' Chef de projet ' })

  // Vedette masquée.
  await insererRealisation({ id: 'r-vedette-masquee', slug: 'vedette-masquee', actif: false, en_vedette: true })

  // Vitrine B : quatre vedettes (seules les trois premières par ordre doivent rester).
  for (const [ordre, id] of ['r-vedette-1', 'r-vedette-2', 'r-vedette-3', 'r-vedette-4'].entries()) {
    await insererRealisation({ id, slug: id, vitrine_id: 'v-b', en_vedette: true, ordre, created_at: new Date(Date.UTC(2026, 0, 1, ordre)) })
  }
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0011 (S4-CA01)', () => {
  beforeEach(async () => {
    await preparerBaseEn0010()
    await insererDonneesSales()
  })

  it('CA01 should start from a 0010 database where the dirty data is accepted (no CHECK, no gallery table, no image FK)', async () => {
    const existantes = await contraintes('realisations')

    expect(existantes.filter((c) => c.contype === 'c')).toHaveLength(0)
    expect(existantes.map((c) => c.conname)).not.toContain('realisations_image_media_id_medias_id_fk')
    expect(await tableExiste('realisation_images')).toBe(false)
    expect(await nomsIndex('realisations')).toEqual(expect.arrayContaining(['realisations_slug_idx', 'realisations_actif_idx', 'realisations_vitrine_id_idx']))
  })

  it('CA01 should rename the duplicate slug of the same vitrine to projet-<8 hex> and keep the first one and the other vitrine one', async () => {
    await appliquer(FICHIER)

    expect((await realisation('r-dup-1'))?.slug).toBe('projet')
    expect((await realisation('r-dup-2'))?.slug).toBe(`projet-${hex8('r-dup-2')}`)
    expect((await realisation('r-dup-2'))?.slug).toMatch(/^projet-[0-9a-f]{8}$/)
    expect((await realisation('r-b-projet'))?.slug).toBe('projet')
  })

  it('CA01 should replace an invalid, empty or too long slug by realisation-<8 hex> and leave a valid one alone', async () => {
    await appliquer(FICHIER)

    for (const id of ['r-slug-invalide', 'r-slug-vide', 'r-slug-long']) {
      expect((await realisation(id))?.slug).toBe(`realisation-${hex8(id)}`)
    }
    expect((await realisation('r-slug-ok'))?.slug).toBe('un-slug-correct')
  })

  it('CA01 should reset an image belonging to another user, or to no media, to NULL and keep the owner image', async () => {
    await appliquer(FICHIER)

    expect((await realisation('r-image-de-b'))?.image_media_id).toBeNull()
    expect((await realisation('r-image-fantome'))?.image_media_id).toBeNull()
    expect((await realisation('r-image-de-a'))?.image_media_id).toBe('m-a')
  })

  it('CA01 should keep only the first three vedettes by order and withdraw the vedette of a masked realisation', async () => {
    await appliquer(FICHIER)

    const vedettes = await client.query<{ id: string }>(`SELECT id FROM realisations WHERE vitrine_id = 'v-b' AND en_vedette ORDER BY ordre`)
    expect(vedettes.rows.map((r) => r.id)).toEqual(['r-vedette-1', 'r-vedette-2', 'r-vedette-3'])
    expect((await realisation('r-vedette-4'))?.en_vedette).toBe(false)
    expect(await realisation('r-vedette-masquee')).toMatchObject({ actif: false, en_vedette: false })
  })

  it('CA01 should erase every link that is not http(s) (javascript:, ftp:, mailto:, no host, blank, spaces inside, over 500 characters)', async () => {
    await appliquer(FICHIER)

    for (const id of ['r-lien-js', 'r-lien-ftp', 'r-lien-mailto', 'r-lien-vide', 'r-lien-blanc', 'r-lien-sans-point', 'r-lien-espace-interne', 'r-lien-long']) {
      expect((await realisation(id))?.lien, id).toBeNull()
    }
  })

  it('CA01 should prefix a scheme-less host with https://, trim the spaces and keep the valid links', async () => {
    await appliquer(FICHIER)

    expect((await realisation('r-lien-www'))?.lien).toBe('https://www.chu-douala.cm')
    expect((await realisation('r-lien-espaces'))?.lien).toBe('https://x.cm')
    expect((await realisation('r-lien-majuscules'))?.lien).toBe('HTTP://X.CM')
    expect((await realisation('r-lien-ok'))?.lien).toBe('https://chu-douala.cm/projet?a=1#b')
  })

  it('CA01 should bring year, order and texts back within the bounds', async () => {
    await appliquer(FICHIER)

    expect((await realisation('r-annee-1800'))?.annee).toBeNull()
    expect((await realisation('r-annee-2101'))?.annee).toBeNull()
    expect((await realisation('r-annee-1900'))?.annee).toBe(1900)
    expect((await realisation('r-annee-2100'))?.annee).toBe(2100)
    expect((await realisation('r-ordre-negatif'))?.ordre).toBe(0)
    expect((await realisation('r-description-blanche'))?.description).toBeNull()
    expect((await realisation('r-description-ok'))?.description).toBe('Un texte')
    expect(await realisation('r-lieu-role')).toMatchObject({ lieu: 'Douala', role: null })
    expect(await realisation('r-lieu-blanc')).toMatchObject({ lieu: null, role: 'Chef de projet' })
  })

  it('CA01 should create an empty realisation_images table and validate every constraint', async () => {
    await appliquer(FICHIER)

    expect(await tableExiste('realisation_images')).toBe(true)
    expect((await client.query('SELECT count(*)::int AS n FROM realisation_images')).rows[0]).toEqual({ n: 0 })
    const surRealisations = await contraintes('realisations')
    expect(surRealisations.filter((c) => c.contype === 'c')).toHaveLength(NB_CHECK_REALISATIONS)
    expect(surRealisations.every((c) => c.convalidated)).toBe(true)
    expect(surRealisations.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'realisations_image_media_id_medias_id_fk',
        'realisations_slug_format_check',
        'realisations_annee_check',
        'realisations_lien_check',
        'realisations_ordre_check',
        'realisations_vedette_actif_check',
      ]),
    )
    const surGalerie = await contraintes('realisation_images')
    expect(surGalerie.every((c) => c.convalidated)).toBe(true)
    expect(surGalerie.filter((c) => c.contype === 'c').map((c) => c.conname)).toEqual(['realisation_images_ordre_check'])
    expect(surGalerie.filter((c) => c.contype === 'f').map((c) => c.conname).sort()).toEqual([
      'realisation_images_media_id_medias_id_fk',
      'realisation_images_realisation_id_realisations_id_fk',
    ])
  })

  it('CA01 should replace the three old indexes by the per-vitrine unique slug index and add the gallery indexes', async () => {
    await appliquer(FICHIER)

    const index = await nomsIndex('realisations')
    expect(index).toEqual(expect.arrayContaining(['realisations_vitrine_id_slug_unique', 'realisations_image_media_id_idx']))
    for (const ancien of ['realisations_slug_idx', 'realisations_actif_idx', 'realisations_vitrine_id_idx']) {
      expect(index).not.toContain(ancien)
    }
    expect(await nomsIndex('realisation_images')).toEqual(
      expect.arrayContaining([
        'realisation_images_realisation_id_ordre_unique',
        'realisation_images_realisation_id_media_id_unique',
        'realisation_images_media_id_idx',
      ]),
    )
  })

  it('CA01 should be idempotent on already conforming data (a second application of the data fixes changes nothing)', async () => {
    await appliquer(FICHIER)
    const avant = (await client.query('SELECT * FROM realisations ORDER BY id')).rows

    await client.query(sqlDeRollback())
    await appliquer(FICHIER)

    expect((await client.query('SELECT * FROM realisations ORDER BY id')).rows).toEqual(avant)
  })

  it('CA01 should go up -> down -> up: the rollback removes the gallery table, the 5 checks, the FK and the unique index; the re-application restores them', async () => {
    await appliquer(FICHIER)

    await client.query(sqlDeRollback())

    expect(await tableExiste('realisation_images')).toBe(false)
    const apresDown = await contraintes('realisations')
    expect(apresDown.filter((c) => c.contype === 'c')).toHaveLength(0)
    expect(apresDown.map((c) => c.conname)).not.toContain('realisations_image_media_id_medias_id_fk')
    const indexDown = await nomsIndex('realisations')
    expect(indexDown).not.toContain('realisations_vitrine_id_slug_unique')
    expect(indexDown).toEqual(expect.arrayContaining(['realisations_slug_idx', 'realisations_actif_idx', 'realisations_vitrine_id_idx']))

    await appliquer(FICHIER)

    expect(await tableExiste('realisation_images')).toBe(true)
    expect((await contraintes('realisations')).filter((c) => c.contype === 'c')).toHaveLength(NB_CHECK_REALISATIONS)
    expect(await nomsIndex('realisations')).toContain('realisations_vitrine_id_slug_unique')
  })

  it('CA01 should apply on an empty realisations table and reject non-conforming rows afterwards', async () => {
    await client.query('DELETE FROM realisations')

    await appliquer(FICHIER)

    await expect(insererRealisation({ id: 'r-mauvais', slug: 'Bad Slug' })).rejects.toMatchObject({ code: '23514' })
    await expect(insererRealisation({ id: 'r-mauvais-lien', slug: 'mauvais-lien', lien: 'javascript:alert(1)' })).rejects.toMatchObject({ code: '23514' })
    await expect(insererRealisation({ id: 'r-bon', slug: 'bon-slug' })).resolves.toBeUndefined()
    await expect(insererRealisation({ id: 'r-doublon', slug: 'bon-slug' })).rejects.toMatchObject({ code: '23505' })
  })

  it('CA01 should enforce the gallery cap on the migrated table (seven images in a row are impossible)', async () => {
    await appliquer(FICHIER)
    for (let i = 0; i < 7; i += 1) {
      await client.query(`INSERT INTO medias (id, user_id, chemin, mime, taille) VALUES ($1, 'u-a', $2, 'image/webp', 1)`, [`m-g${i}`, `u-a/m-g${i}`])
    }
    for (let i = 0; i < 6; i += 1) {
      await client.query(`INSERT INTO realisation_images (id, realisation_id, media_id, ordre) VALUES ($1, 'r-slug-ok', $2, $3)`, [`i-${i}`, `m-g${i}`, i])
    }

    await expect(
      client.query(`INSERT INTO realisation_images (id, realisation_id, media_id, ordre) VALUES ('i-6', 'r-slug-ok', 'm-g6', 6)`),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query(`INSERT INTO realisation_images (id, realisation_id, media_id, ordre) VALUES ('i-6b', 'r-slug-ok', 'm-g6', 0)`),
    ).rejects.toMatchObject({ code: '23505' })
  })
})
