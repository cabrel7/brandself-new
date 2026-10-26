import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// S3-CA01 — la migration 0010 sur des données réelles : base en 0009, données « sales », application
// de 0010, vérification, puis ROLLBACK (bloc commenté du fichier) et ré-application.
//
// Isolation : un SCHÉMA temporaire (jamais le schéma public des autres tests). Les fichiers de
// migration sont rejoués à la main (les mêmes que ceux de drizzle, découpés sur `--> statement-breakpoint`)
// avec `search_path` limité au schéma temporaire. Aucune autorisation CREATEDB n'est requise.

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0010_test'
const SEPARATEUR = '--> statement-breakpoint'
const NB_CHECK_SERVICES = 18

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

/** Bloc ROLLBACK de 0010 : lignes `-- ...` entre `-- BEGIN;` et `-- COMMIT;`, sans la ligne du journal drizzle. */
function sqlDeRollback(): string {
  const lignes = readFileSync(path.join(DOSSIER_MIGRATIONS, '0010_s3_services.sql'), 'utf-8').split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin === -1) throw new Error('Bloc ROLLBACK (-- BEGIN; ... -- COMMIT;) introuvable dans 0010.')
  return lignes
    .slice(debut + 1, fin)
    .filter((l) => !l.includes('__drizzle_migrations'))
    .map((l) => l.replace(/^--\s?/, ''))
    .join('\n')
}

const hex8 = (id: string) => createHash('md5').update(id).digest('hex').slice(0, 8)

async function colonnes(table: string) {
  const r = await client.query<{ column_name: string, is_nullable: string }>(
    'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [SCHEMA, table],
  )
  return new Map(r.rows.map((l) => [l.column_name, l.is_nullable]))
}

async function contraintesDeServices() {
  const r = await client.query<{ conname: string, convalidated: boolean, contype: string }>(
    `SELECT c.conname, c.convalidated, c.contype FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = 'services'`,
    [SCHEMA],
  )
  return r.rows
}

async function service(id: string) {
  const r = await client.query('SELECT * FROM services WHERE id = $1', [id])
  return r.rows[0] as Record<string, unknown> | undefined
}

/** Insère un service au schéma 0009 (durée obligatoire, aucune contrainte métier). */
async function insererService(valeurs: Record<string, unknown>): Promise<void> {
  const defauts = { type: 'rdv', duree_min: 30, tarif: 'gratuit', titre: 'Titre', vitrine_id: 'v-a' }
  const ligne = { ...defauts, ...valeurs }
  const cles = Object.keys(ligne)
  await client.query(
    `INSERT INTO services (${cles.join(', ')}) VALUES (${cles.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(ligne),
  )
}

async function preparerBaseEn0009(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}`)
  for (const fichier of fichiersDeMigration().filter((f) => f < '0010')) {
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

  // Vitrine A : cas de normalisation.
  await insererService({ id: 'svc-payant-sans-prix', slug: 'payant-sans-prix', tarif: 'payant' })
  await insererService({ id: 'svc-devis-payant', slug: 'devis-payant', type: 'devis', tarif: 'payant', prix_montant: 5000, prix_devise: 'XAF', paiement_mode: 'sur_place' })
  await insererService({ id: 'svc-dup-1', slug: 'consultation', titre: 'Consultation 1' })
  await insererService({ id: 'svc-dup-2', slug: 'consultation', titre: 'Consultation 2' })
  await insererService({ id: 'svc-slug-invalide', slug: 'Mon Slug!' })
  await insererService({ id: 'svc-image-de-b', slug: 'image-de-b', image_media_id: 'm-b' })
  await insererService({ id: 'svc-image-de-a', slug: 'image-de-a', image_media_id: 'm-a' })
  await insererService({ id: 'svc-image-fantome', slug: 'image-fantome', image_media_id: 'm-n-existe-pas' })
  await insererService({ id: 'svc-vedette-masque', slug: 'vedette-masque', actif: false, en_vedette: true })
  await insererService({ id: 'svc-rythme-maj', slug: 'rythme-maj', type: 'accompagnement', nb_seances: 6, rythme: 'Hebdomadaire' })
  await insererService({ id: 'svc-rythme-mensuel', slug: 'rythme-mensuel', type: 'accompagnement', nb_seances: 4, rythme: 'Mensuel' })
  await insererService({ id: 'svc-rythme-inconnu', slug: 'rythme-inconnu', type: 'accompagnement', nb_seances: 4, rythme: 'quotidien' })
  await insererService({ id: 'svc-type-inconnu', slug: 'type-inconnu', type: 'consultation' })
  await insererService({ id: 'svc-seances-absentes', slug: 'seances-absentes', type: 'accompagnement', nb_seances: null })
  await insererService({ id: 'svc-seances-sur-rdv', slug: 'seances-sur-rdv', type: 'rdv', nb_seances: 6, rythme: 'mensuel' })
  await insererService({ id: 'svc-duree-courte', slug: 'duree-courte', duree_min: 3 })
  await insererService({ id: 'svc-duree-longue', slug: 'duree-longue', duree_min: 5000 })
  await insererService({ id: 'svc-ordre-negatif', slug: 'ordre-negatif', ordre: -4 })
  await insererService({ id: 'svc-gratuit-avec-prix', slug: 'gratuit-avec-prix', tarif: 'gratuit', prix_montant: 100, prix_devise: 'XAF', paiement_mode: 'sur_place' })

  // Vitrine B : quatre vedettes (seules les trois premières par ordre doivent rester).
  for (const [ordre, id] of ['svc-vedette-1', 'svc-vedette-2', 'svc-vedette-3', 'svc-vedette-4'].entries()) {
    await insererService({ id, slug: id, vitrine_id: 'v-b', en_vedette: true, ordre, created_at: new Date(Date.UTC(2026, 0, 1, ordre)) })
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

describe('migration 0010 (S3-CA01)', () => {
  beforeEach(async () => {
    await preparerBaseEn0009()
    await insererDonneesSales()
  })

  it('CA01 should start from a 0009 database where the dirty data is accepted (no CHECK yet, inclus absent)', async () => {
    const cols = await colonnes('services')

    expect(cols.has('inclus')).toBe(false)
    expect(cols.get('duree_min')).toBe('NO')
    expect((await contraintesDeServices()).filter((c) => c.contype === 'c')).toHaveLength(0)
  })

  it('CA01 should turn a paid service without price into a devis tarif with no price', async () => {
    await appliquer('0010_s3_services.sql')

    expect(await service('svc-payant-sans-prix')).toMatchObject({ tarif: 'devis', prix_montant: null, prix_devise: null, paiement_mode: null })
  })

  it('CA01 should force the devis tarif on a devis type and drop its price', async () => {
    await appliquer('0010_s3_services.sql')

    expect(await service('svc-devis-payant')).toMatchObject({ type: 'devis', tarif: 'devis', prix_montant: null, prix_devise: null, paiement_mode: null })
  })

  it('CA01 should rename the duplicate slug of the same vitrine to consultation-<8 hex> and keep the first one', async () => {
    await appliquer('0010_s3_services.sql')

    expect((await service('svc-dup-1'))?.slug).toBe('consultation')
    expect((await service('svc-dup-2'))?.slug).toBe(`consultation-${hex8('svc-dup-2')}`)
    expect((await service('svc-dup-2'))?.slug).toMatch(/^consultation-[0-9a-f]{8}$/)
  })

  it('CA01 should replace an invalid slug by service-<8 hex>', async () => {
    await appliquer('0010_s3_services.sql')

    expect((await service('svc-slug-invalide'))?.slug).toBe(`service-${hex8('svc-slug-invalide')}`)
  })

  it('CA01 should reset an image belonging to another user, or to no media, to NULL and keep the owner image', async () => {
    await appliquer('0010_s3_services.sql')

    expect((await service('svc-image-de-b'))?.image_media_id).toBeNull()
    expect((await service('svc-image-fantome'))?.image_media_id).toBeNull()
    expect((await service('svc-image-de-a'))?.image_media_id).toBe('m-a')
  })

  it('CA01 should keep only the first three vedettes by order and withdraw the vedette of a masked service', async () => {
    await appliquer('0010_s3_services.sql')

    const vedettes = await client.query<{ id: string }>(`SELECT id FROM services WHERE vitrine_id = 'v-b' AND en_vedette ORDER BY ordre`)
    expect(vedettes.rows.map((r) => r.id)).toEqual(['svc-vedette-1', 'svc-vedette-2', 'svc-vedette-3'])
    expect((await service('svc-vedette-4'))?.en_vedette).toBe(false)
    expect((await service('svc-vedette-masque'))).toMatchObject({ actif: false, en_vedette: false })
  })

  it('CA01 should normalise the rhythm to the closed list (Hebdomadaire -> hebdomadaire, unknown -> NULL)', async () => {
    await appliquer('0010_s3_services.sql')

    expect((await service('svc-rythme-maj'))?.rythme).toBe('hebdomadaire')
    expect((await service('svc-rythme-mensuel'))?.rythme).toBe('mensuel')
    expect((await service('svc-rythme-inconnu'))?.rythme).toBeNull()
  })

  it('CA01 should bring type, sessions, duration, order and prices back within the bounds', async () => {
    await appliquer('0010_s3_services.sql')

    expect((await service('svc-type-inconnu'))?.type).toBe('rdv')
    expect((await service('svc-seances-absentes'))?.nb_seances).toBe(2)
    expect(await service('svc-seances-sur-rdv')).toMatchObject({ nb_seances: null, rythme: null })
    expect((await service('svc-duree-courte'))?.duree_min).toBe(5)
    expect((await service('svc-duree-longue'))?.duree_min).toBe(1440)
    expect((await service('svc-ordre-negatif'))?.ordre).toBe(0)
    expect(await service('svc-gratuit-avec-prix')).toMatchObject({ prix_montant: null, prix_devise: null, paiement_mode: null })
  })

  it('CA01 should add the inclus column (default empty array), make duree_min optional and validate every constraint', async () => {
    await appliquer('0010_s3_services.sql')

    const cols = await colonnes('services')
    expect(cols.has('inclus')).toBe(true)
    expect(cols.get('duree_min')).toBe('YES')
    expect((await service('svc-dup-1'))?.inclus).toEqual([])
    const contraintes = await contraintesDeServices()
    const checks = contraintes.filter((c) => c.contype === 'c')
    expect(checks).toHaveLength(NB_CHECK_SERVICES)
    expect(contraintes.every((c) => c.convalidated)).toBe(true)
    expect(contraintes.map((c) => c.conname)).toContain('services_image_media_id_medias_id_fk')
    const index = await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'services'`, [SCHEMA])
    expect(index.rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(['services_vitrine_id_slug_unique', 'services_image_media_id_idx']))
    expect(index.rows.map((r) => r.indexname)).not.toContain('services_slug_idx')
  })

  it('CA01 should be idempotent on already conforming data (a second application of the data fixes changes nothing)', async () => {
    await appliquer('0010_s3_services.sql')
    const avant = (await client.query('SELECT * FROM services ORDER BY id')).rows

    await client.query(sqlDeRollback())
    await appliquer('0010_s3_services.sql')

    expect((await client.query('SELECT * FROM services ORDER BY id')).rows).toEqual(avant)
  })

  it('CA01 should go up -> down -> up: the rollback removes the 18 checks, the FK, the unique index and the inclus column; the re-application restores them', async () => {
    await appliquer('0010_s3_services.sql')

    await client.query(sqlDeRollback())

    const apresDown = await contraintesDeServices()
    expect(apresDown.filter((c) => c.contype === 'c')).toHaveLength(0)
    expect(apresDown.map((c) => c.conname)).not.toContain('services_image_media_id_medias_id_fk')
    const colsDown = await colonnes('services')
    expect(colsDown.has('inclus')).toBe(false)
    expect(colsDown.get('duree_min')).toBe('NO')
    const indexDown = await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'services'`, [SCHEMA])
    expect(indexDown.rows.map((r) => r.indexname)).not.toContain('services_vitrine_id_slug_unique')

    await appliquer('0010_s3_services.sql')

    const apresUp = await contraintesDeServices()
    expect(apresUp.filter((c) => c.contype === 'c')).toHaveLength(NB_CHECK_SERVICES)
    expect((await colonnes('services')).has('inclus')).toBe(true)
  })

  it('CA01 should apply on an empty services table and reject non-conforming rows afterwards', async () => {
    await client.query('DELETE FROM services')

    await appliquer('0010_s3_services.sql')

    await expect(insererService({ id: 'svc-mauvais', slug: 'Bad Slug' })).rejects.toMatchObject({ code: '23514' })
    await expect(insererService({ id: 'svc-bon', slug: 'bon-slug' })).resolves.toBeUndefined()
  })
})
