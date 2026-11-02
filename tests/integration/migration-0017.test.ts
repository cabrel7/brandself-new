import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// S7-bis §5 : la migration 0017 crée la table `messages` (avec les CHECK de sujet,
// nom, email, téléphone, message), élargit le CHECK des statuts de réservation à
// `refusee` (terminal, jamais bloquant pour la contrainte d'exclusion GiST) et
// élargit l'outbox transactionnelle aux types `reservation_visiteur_refusee` et
// `message_professionnel_nouvelle` (entité « message »).
//
// ÉCART ASSUMÉ vs pseudo-SQL de la spec : la convention du projet en base pour
// l'horodatage est `created_at`/`updated_at` (comme `demandes`, `reservations`,
// `temoignages`) — le pseudo-SQL de la spec dit `cree_le` : les tests vérifient
// `created_at`/`updated_at`. `lu_le` reste en `_le` (pattern `confirmation_expire_le`).

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0017_test'
const BREAKPOINT = '--> statement-breakpoint'

let client: Client

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0017(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0017_'))
  if (files.length !== 1) {
    throw new Error(`Une seule migration 0017 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
  }
  return files[0]!
}

async function apply(file: string): Promise<void> {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replaceAll('"public".', '')
  for (const statement of sql.split(BREAKPOINT)) {
    if (statement.trim() !== '') await client.query(statement)
  }
}

async function prepareAt0016(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0017')) await apply(file)

  await client.query(`
    INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test')
  `)
  await client.query(`
    INSERT INTO vitrines (id, user_id, username, prenom, nom, metier)
    VALUES ('v-a', 'u-a', 'vitrine-a', 'A', 'A', 'Métier')
  `)
  await client.query(`
    INSERT INTO services (id, vitrine_id, slug, titre, type, duree_min, tarif)
    VALUES ('svc-a', 'v-a', 'service-test-a', 'Consultation', 'rdv', 30, 'gratuit')
  `)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
})

beforeEach(prepareAt0016)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

let essaiMessage = 0

function insertMessage(surcharges: Partial<Record<string, string>> = {}): string {
  // Identifiant unique par appel : les insertions qui DOIVENT aboutir tournent
  // après celles qui doivent échouer, sur la même table.
  essaiMessage += 1
  const telephone = surcharges.telephone ?? 'NULL'
  const valeurs = [
    surcharges.nom ?? 'Marie Ndzi',
    surcharges.email ?? 'marie.ndzi@exemple.test',
    telephone === 'NULL' ? 'NULL' : `'${telephone}'`,
    surcharges.sujet ?? 'question_avant_reservation',
    surcharges.message ?? 'Bonjour, une question avant de réserver mon créneau.',
  ]
  return `INSERT INTO messages (id, vitrine_id, nom, email, telephone, sujet, message)
    VALUES ('${surcharges.id ?? `msg-a-${essaiMessage}`}', 'v-a', '${valeurs[0]}', '${valeurs[1]}', ${valeurs[2]}, '${valeurs[3]}', '${valeurs[4]}')`
}

describe('migration 0017 : table messages', () => {
  it('est l’unique migration 0017', () => {
    expect(migrationFiles().filter((file) => file.startsWith('0017_'))).toHaveLength(1)
    expect(migration0017()).toMatch(/^0017_.*\.sql$/)
  })

  it('crée la table messages avec des colonnes typées, l’horodatage en created_at (écart assumé vs spec) et la FK en cascade', async () => {
    await apply(migration0017())

    const columns = await client.query<{ column_name: string, is_nullable: string, data_type: string, column_default: string | null }>(
      `SELECT column_name, is_nullable, data_type, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'messages'
       ORDER BY ordinal_position`,
      [SCHEMA],
    )
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      'id',
      'vitrine_id',
      'nom',
      'email',
      'telephone',
      'sujet',
      'message',
      'lu_le',
      'created_at',
      'updated_at',
    ])
    for (const colonne of ['lu_le', 'created_at', 'updated_at']) {
      expect(columns.rows.find(({ column_name }) => column_name === colonne)?.data_type)
        .toBe('timestamp with time zone')
    }
    expect(columns.rows.find(({ column_name }) => column_name === 'telephone')?.is_nullable).toBe('YES')
    expect(columns.rows.find(({ column_name }) => column_name === 'created_at')?.is_nullable).toBe('NO')

    const horodatage = await client.query(`
      INSERT INTO messages (id, vitrine_id, nom, email, sujet, message, telephone)
      VALUES ('msg-horodatage', 'v-a', 'Marie Ndzi', 'marie@exemple.test', 'autre', 'Bonjour', NULL)
      RETURNING created_at, updated_at
    `)
    expect(horodatage.rows[0]).toEqual({
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    })

    const fk = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'messages' AND c.contype = 'f'`,
      [SCHEMA],
    )
    expect(fk.rows[0]?.definition).toMatch(/FOREIGN KEY \(vitrine_id\) REFERENCES.*vitrines\(id\).*ON DELETE CASCADE/i)
    await client.query(`DELETE FROM vitrines WHERE id = 'v-a'`)
    const restantes = await client.query(`SELECT id FROM messages WHERE id = 'msg-horodatage'`)
    expect(restantes.rowCount).toBe(0)
  })

  it('garantit les CHECK de sujet, nom, email, téléphone et message (23514)', async () => {
    await apply(migration0017())

    await expect(client.query(insertMessage())).resolves.toBeDefined()

    await expect(client.query(insertMessage({ sujet: 'facturation' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ nom: '', message: 'Message correct' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ nom: 'a'.repeat(121) }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ telephone: '699000001' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ telephone: 'notre-site' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ email: 'minuscul' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ message: '', nom: 'Marie Ndzi' }))).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insertMessage({ message: 'a'.repeat(1001) }))).rejects.toMatchObject({ code: '23514' })

    await expect(client.query(insertMessage({ telephone: '+237699000001' }))).resolves.toBeDefined()
    await expect(client.query(insertMessage({ nom: 'a'.repeat(120) }))).resolves.toBeDefined()
    await expect(client.query(insertMessage({ message: 'a'.repeat(1000) }))).resolves.toBeDefined()
  })

  it('crée les deux index de liste, dont l’index partiel des non lus', async () => {
    await apply(migration0017())

    const indexes = await client.query<{ indexname: string, indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'messages'`,
      [SCHEMA],
    )
    expect(indexes.rows.find(({ indexname }) => indexname === 'messages_vitrine_id_cree_le_idx')?.indexdef)
      .toMatch(/CREATE INDEX.*messages_vitrine_id_cree_le_idx ON.*messages USING btree \(vitrine_id, created_at DESC\)/i)
    expect(indexes.rows.find(({ indexname }) => indexname === 'messages_non_lus_idx')?.indexdef)
      .toMatch(/WHERE \(lu_le IS NULL\)/i)
  })
})

describe('migration 0017 : statut refusee des réservations', () => {
  function insererReservation(id: string, statut: string, serviceId: string): string {
    // Hash de confirmation valide (64 hex, unique par ligne) : le CHECK 0015
    // `reservations_confirmation_hash_check` le impose.
    const hash = (Buffer.from(id).toString('hex') + '0'.repeat(64)).slice(0, 64)
    return `INSERT INTO reservations (
         id, vitrine_id, service_id, nom, email, telephone, debut, fin, statut,
         paiement_choisi, paiement_statut, confirmation_token_hash, confirmation_expire_le
       ) VALUES ('${id}', 'v-a', '${serviceId}', 'Visiteur', 'visiteur@exemple.test',
         '+237699000001', '2026-11-02T08:00:00Z'::timestamptz, '2026-11-02T09:00:00Z'::timestamptz,
         '${statut}', 'sur_place', 'non_requis', '${hash}', '2026-11-03T00:00:00Z')`
  }

  it('élargit le CHECK des statuts : refusee acceptée, invalide_statut rejetée en SQL réel (CA6)', async () => {
    await apply(migration0017())

    await expect(client.query(insererReservation('r-refusee', 'refusee', 'svc-a'))).resolves.toBeDefined()
    await expect(client.query(insererReservation('r-invalide', 'invalide_statut', 'svc-a'))).rejects.toMatchObject({ code: '23514' })
  })

  it('garde la contrainte d’exclusion GiST partielle : un refus ne bloque plus jamais le créneau (CA4)', async () => {
    await apply(migration0017())

    await client.query(insererReservation('r-active-en-attente', 'en_attente', 'svc-a'))
    // Statut refusé sur le même créneau : jamais 23P01 (exclusion) — le refus libère.
    await expect(client.query(insererReservation('r-refusee', 'refusee', 'svc-a'))).resolves.toBeDefined()
    // Les refusés ne se bloquent pas entre eux.
    await expect(client.query(insererReservation('r-refusee-2', 'refusee', 'svc-a'))).resolves.toBeDefined()
    // Statut actif en doublon : toujours refusé par la GiST (régression de la contrainte).
    const conflit = await client.query(insererReservation('r-conflit-actif', 'confirmee', 'svc-a')).catch(
      (erreur: { code?: string }) => erreur,
    )
    expect(conflit.code).toBe('23P01')
  })
})

describe('migration 0017 : outbox transactionnelle élargie', () => {
  it('accepte reservation_visiteur_refusee (entité réservation) et message_professionnel_nouvelle (entité message)', async () => {
    await apply(migration0017())

    const accepte = (id: string, type: string, entiteType: string, entiteId: string) =>
      `INSERT INTO emails_transactionnels (id, type, entite_type, entite_id)
       VALUES ('${id}', '${type}', '${entiteType}', '${entiteId}')`

    await expect(client.query(accepte('e1', 'reservation_visiteur_refusee', 'reservation', 'r-1'))).resolves.toBeDefined()
    await expect(client.query(accepte('e2', 'message_professionnel_nouvelle', 'message', 'm-1'))).resolves.toBeDefined()

    await expect(
      client.query(accepte('e3', 'message_professionnel_nouvelle', 'message', 'm-1')),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('rejette les types inconnus, les couples entité/type incohérents et l’entité « message » hors types message_', async () => {
    await apply(migration0017())

    const insert = (id: string, type: string, entiteType: string, entiteId: string) =>
      `INSERT INTO emails_transactionnels (id, type, entite_type, entite_id)
       VALUES ('${id}', '${type}', '${entiteType}', '${entiteId}')`

    await expect(client.query(insert('e4', 'type_inconnu', 'message', 'm-2'))).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query(insert('e5', 'message_professionnel_nouvelle', 'reservation', 'r-2')),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query(insert('e6', 'reservation_visiteur_annulee', 'message', 'm-3')),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query(insert('e7', 'reservation_visiteur_recue', 'reservation', 'r-3')),
    ).resolves.toBeDefined()
  })
})
