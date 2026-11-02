import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0015_test'
const SEPARATEUR = '--> statement-breakpoint'
const TABLES_S7 = ['disponibilites', 'indisponibilites', 'reservations', 'demandes'] as const
// PostgreSQL distingue RESTRICT (23001) de NO ACTION (23503).
const PG_RESTRICT_VIOLATION = '23001'

let client: Client

function fichiersDeMigration(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((fichier) => /^\d{4}_.*\.sql$/.test(fichier))
    .sort()
}

function fichier0015(): string {
  const fichiers = fichiersDeMigration().filter((fichier) => fichier.startsWith('0015_'))
  if (fichiers.length !== 1) {
    throw new Error(`Une seule migration 0015 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  }
  return fichiers[0]!
}

async function appliquer(fichier: string): Promise<void> {
  const contenu = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf-8').replaceAll('"public".', '')
  for (const instruction of contenu.split(SEPARATEUR)) {
    if (instruction.trim() !== '') await client.query(instruction)
  }
}

async function preparerBaseEn0014(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const fichier of fichiersDeMigration().filter((nom) => nom < '0015')) await appliquer(fichier)

  await client.query(`
    INSERT INTO users (id, name, email)
    VALUES ('u-a', 'A', 'a@exemple.test'), ('u-b', 'B', 'b@exemple.test')
  `)
  await client.query(`
    INSERT INTO vitrines (id, user_id, username, prenom, nom, metier)
    VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier'),
           ('v-b', 'u-b', 'vitrine-b', 'B', 'B', 'Métier')
  `)
  await client.query(`
    INSERT INTO services (id, vitrine_id, slug, titre, type, duree_min, tarif)
    VALUES ('svc-a', 'v-a', 'consultation', 'Consultation', 'rdv', 30, 'gratuit'),
           ('svc-b', 'v-b', 'consultation', 'Consultation', 'rdv', 30, 'gratuit')
  `)
}

async function tablesExistantes(): Promise<string[]> {
  const resultat = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY table_name`,
    [SCHEMA, TABLES_S7],
  )
  return resultat.rows.map((ligne) => ligne.table_name)
}

async function colonnes(table: string): Promise<Map<string, { nullable: string, defaut: string | null, type: string }>> {
  const resultat = await client.query<{ column_name: string, is_nullable: string, column_default: string | null, data_type: string }>(
    `SELECT column_name, is_nullable, column_default, data_type
     FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [SCHEMA, table],
  )
  return new Map(resultat.rows.map((ligne) => [
    ligne.column_name,
    { nullable: ligne.is_nullable, defaut: ligne.column_default, type: ligne.data_type },
  ]))
}

async function contraintes(table: string): Promise<Array<{ nom: string, type: string, definition: string, validee: boolean }>> {
  const resultat = await client.query<{ conname: string, contype: string, definition: string, convalidated: boolean }>(
    `SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition, c.convalidated
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2
     ORDER BY c.conname`,
    [SCHEMA, table],
  )
  return resultat.rows.map((ligne) => ({
    nom: ligne.conname,
    type: ligne.contype,
    definition: ligne.definition,
    validee: ligne.convalidated,
  }))
}

async function insererReservation(options: {
  id: string
  vitrineId?: string
  serviceId?: string
  debut?: string
  fin?: string
  statut?: string
}): Promise<void> {
  const hash = createHash('sha256').update(options.id).digest('hex')
  await client.query(
    `INSERT INTO reservations (
       id, vitrine_id, service_id, nom, email, telephone, debut, fin, statut,
       paiement_choisi, paiement_statut, confirmation_token_hash, confirmation_expire_le
     ) VALUES ($1, $2, $3, 'Visiteur', 'visiteur@exemple.test', '+237699000001',
       $4::timestamptz, $5::timestamptz, $6, 'sur_place', 'non_requis', $7, '2026-11-03T00:00:00Z')`,
    [
      options.id,
      options.vitrineId ?? 'v-a',
      options.serviceId ?? 'svc-a',
      options.debut ?? '2026-11-02T09:00:00Z',
      options.fin ?? '2026-11-02T10:00:00Z',
      options.statut ?? 'en_attente',
      hash,
    ],
  )
}

async function insererDemande(id: string, vitrineId = 'v-a', serviceId = 'svc-a'): Promise<void> {
  await client.query(
    `INSERT INTO demandes (id, vitrine_id, service_id, nom, email, telephone, message, statut)
     VALUES ($1, $2, $3, 'Visiteur', 'visiteur@exemple.test', '+237699000001', 'Bonjour', 'nouvelle')`,
    [id, vitrineId, serviceId],
  )
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(preparerBaseEn0014)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

describe('migration 0015 : agenda, réservations et demandes', () => {
  it('applique les réglages 30/2/60 aux vitrines existantes et comme défauts des nouvelles vitrines', async () => {
    expect((await client.query(`SELECT pas_creneau_min, preavis_heures, horizon_jours FROM vitrines WHERE id = 'v-a'`)).rows[0])
      .toEqual({ pas_creneau_min: 15, preavis_heures: 24, horizon_jours: 30 })

    await appliquer(fichier0015())

    expect((await client.query(`SELECT pas_creneau_min, preavis_heures, horizon_jours FROM vitrines WHERE id = 'v-a'`)).rows[0])
      .toEqual({ pas_creneau_min: 30, preavis_heures: 2, horizon_jours: 60 })
    const champs = await colonnes('vitrines')
    expect(champs.get('pas_creneau_min')?.defaut).toContain('30')
    expect(champs.get('preavis_heures')?.defaut).toContain('2')
    expect(champs.get('horizon_jours')?.defaut).toContain('60')

    await client.query(`INSERT INTO users (id, name, email) VALUES ('u-c', 'C', 'c@exemple.test')`)
    await client.query(`INSERT INTO vitrines (id, user_id, username, prenom, nom, metier) VALUES ('v-c', 'u-c', 'vitrine-c', 'C', 'C', 'Métier')`)
    expect((await client.query(`SELECT pas_creneau_min, preavis_heures, horizon_jours FROM vitrines WHERE id = 'v-c'`)).rows[0])
      .toEqual({ pas_creneau_min: 30, preavis_heures: 2, horizon_jours: 60 })
  })

  it('crée les quatre tables avec des colonnes typées, les CHECK validés et les secrets de confirmation hachés', async () => {
    await appliquer(fichier0015())

    expect(await tablesExistantes()).toEqual([...TABLES_S7].sort())
    expect([...(await colonnes('disponibilites')).keys()]).toEqual(expect.arrayContaining(['id', 'vitrine_id', 'jour_semaine', 'debut', 'fin']))
    expect([...(await colonnes('indisponibilites')).keys()]).toEqual(expect.arrayContaining(['id', 'vitrine_id', 'date', 'raison']))
    expect([...(await colonnes('reservations')).keys()]).toEqual(expect.arrayContaining([
      'id',
      'vitrine_id',
      'service_id',
      'nom',
      'email',
      'telephone',
      'note',
      'debut',
      'fin',
      'statut',
      'paiement_choisi',
      'paiement_statut',
      'confirmation_token_hash',
      'confirmation_expire_le',
    ]))
    expect([...(await colonnes('demandes')).keys()]).toEqual(expect.arrayContaining([
      'id', 'vitrine_id', 'service_id', 'nom', 'email', 'telephone', 'message', 'statut',
    ]))
    expect((await colonnes('reservations')).has('confirmation_token')).toBe(false)

    const definitions = (await Promise.all([...TABLES_S7, 'vitrines'].map(contraintes))).flat()
    expect(definitions.every((contrainte) => contrainte.validee)).toBe(true)
    const checks = definitions.filter((contrainte) => contrainte.type === 'c').map((contrainte) => contrainte.definition).join('\n')
    expect(checks).toMatch(/jour_semaine/i)
    expect(checks).toMatch(/debut.*fin|fin.*debut/i)
    expect(checks).toMatch(/en_attente/i)
    expect(checks).toMatch(/confirmee/i)
    expect(checks).toMatch(/annulee/i)
    expect(checks).toMatch(/terminee/i)
    expect(checks).toMatch(/pas_creneau_min/i)
    expect(checks).toMatch(/preavis_heures/i)
    expect(checks).toMatch(/horizon_jours/i)

    await expect(
      client.query(`INSERT INTO disponibilites (id, vitrine_id, jour_semaine, debut, fin) VALUES ('d-bad', 'v-a', 1, '12:00', '09:00')`),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insererReservation({ id: 'r-bad', fin: '2026-11-02T08:00:00Z' }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('met les FK service_id de reservations et demandes en ON DELETE RESTRICT', async () => {
    await appliquer(fichier0015())

    const reservationFk = (await contraintes('reservations')).find((contrainte) => contrainte.nom === 'reservations_service_id_services_id_fk')
    const demandeFk = (await contraintes('demandes')).find((contrainte) => contrainte.nom === 'demandes_service_id_services_id_fk')
    expect(reservationFk?.definition).toMatch(/FOREIGN KEY \(service_id\).*ON DELETE RESTRICT/i)
    expect(demandeFk?.definition).toMatch(/FOREIGN KEY \(service_id\).*ON DELETE RESTRICT/i)

    await insererReservation({ id: 'r-a' })
    await insererDemande('dem-b', 'v-b', 'svc-b')
    await expect(client.query(`DELETE FROM services WHERE id = 'svc-a'`)).rejects.toMatchObject({ code: PG_RESTRICT_VIOLATION })
    await expect(client.query(`DELETE FROM services WHERE id = 'svc-b'`)).rejects.toMatchObject({ code: PG_RESTRICT_VIOLATION })
  })

  it('garantit en GiST la plage [debut, fin) par vitrine pour les seuls statuts actifs', async () => {
    await appliquer(fichier0015())

    const exclusions = (await contraintes('reservations')).filter((contrainte) => contrainte.type === 'x')
    expect(exclusions).toHaveLength(1)
    expect(exclusions[0]?.definition).toMatch(/EXCLUDE USING gist/i)
    expect(exclusions[0]?.definition).toMatch(/vitrine_id WITH =/i)
    expect(exclusions[0]?.definition).toMatch(/tstzrange\(debut, fin.*\).*WITH &&/i)
    expect(exclusions[0]?.definition).toMatch(/en_attente/i)
    expect(exclusions[0]?.definition).toMatch(/confirmee/i)

    await insererReservation({ id: 'r-active' })
    await expect(insererReservation({
      id: 'r-chevauche',
      debut: '2026-11-02T09:30:00Z',
      fin: '2026-11-02T10:30:00Z',
      statut: 'confirmee',
    })).rejects.toMatchObject({ code: '23P01' })

    await expect(insererReservation({
      id: 'r-bord',
      debut: '2026-11-02T10:00:00Z',
      fin: '2026-11-02T10:30:00Z',
    })).resolves.toBeUndefined()
    await expect(insererReservation({ id: 'r-annulee', statut: 'annulee' })).resolves.toBeUndefined()
    await expect(insererReservation({ id: 'r-terminee', statut: 'terminee' })).resolves.toBeUndefined()
    await expect(insererReservation({ id: 'r-autre-vitrine', vitrineId: 'v-b', serviceId: 'svc-b' })).resolves.toBeUndefined()
  })
})
