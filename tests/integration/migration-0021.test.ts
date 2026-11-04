import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MOTIFS_REPLI } from '../../shared/ia'
import { TRANSACTIONAL_EMAIL_TYPES } from '../../shared/jobs'
import { FOURNISSEUR_FORMAT, FRAIS_SUPPORTEURS, PAIEMENT_STATUTS } from '../../shared/paiements'

// S10 §2 : la migration 0021 (paiements, abonnements, journal des événements de paiement, outbox étendue, motif IA
// `quota_atteint`). Elle tourne dans un schéma jetable (`mig0021_test`) de la base de test : la base partagée et son
// journal drizzle ne sont jamais touchés par le DDL de ce fichier. RÈGLE : toute instruction de 0021 et de son
// ROLLBACK est QUALIFIÉE par ce schéma avant exécution (`qualifier`), donc un nom d'objet absent du schéma jetable
// fait ÉCHOUER l'instruction au lieu de viser l'objet homonyme de `public` (jamais de DROP / ALTER / DELETE /
// UPDATE non qualifié). La ligne « DELETE FROM drizzle.__drizzle_migrations » du ROLLBACK n'est jamais exécutée
// (elle viserait le vrai journal) : on vérifie seulement qu'elle cible le `when` de l'entrée idx 21 de
// meta/_journal.json.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0021_test'
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const LIGNE_ROLLBACK = /^-- (BEGIN|DO|UPDATE|ALTER|DELETE|COMMIT|DROP|CREATE)\b/
const NOUVELLES_TABLES = ['paiements', 'abonnements', 'evenements_paiement'] as const
const TABLES_SUIVIES = ['users', 'emails_transactionnels', 'generations_ia'] as const
const TYPES_AVEC_OCCURRENCE = ['reservation_visiteur_rappel', 'utilisateur_resume_hebdo', 'utilisateur_rappel_journee', 'abonnement_rappel']
const OCCURRENCE_RAPPEL = 'J7:2026-12-01T23:00:00.000Z'
const MOTIFS_REPLI_AVANT = [
  'echec_fournisseur', 'delai_depasse', 'sortie_invalide', 'injection', 'sans_fournisseur',
  'sans_prompt', 'file_indisponible', 'limiteur_indisponible', 'plafond_global',
]
const MASQUE = '+237 6•• ••• •89'
const EMPREINTE = 'a'.repeat(64)

let client: Client

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0021(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0021_'))
  if (files.length !== 1) {
    throw new Error(`Une seule migration 0021 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
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

/** Qualifie par le schéma jetable chaque table, index et cible de DML / DDL nommés par 0021 ou son ROLLBACK. */
function qualifier(sql: string): string {
  return sql
    .replaceAll('"public".', '')
    .replace(/\b(ALTER TABLE|DELETE FROM|FROM|ON|UPDATE|DROP TABLE|CREATE TABLE|REFERENCES) "(\w+)"/g, `$1 ${SCHEMA}."$2"`)
    .replace(/\bDROP INDEX "(\w+)"/g, `DROP INDEX ${SCHEMA}."$1"`)
}

async function assertSchemaJetable(): Promise<void> {
  const resultat = await client.query<{ present: string | null }>('SELECT to_regclass($1) AS present', [`${SCHEMA}.emails_transactionnels`])
  if (resultat.rows[0]?.present === null) {
    throw new Error(`${SCHEMA}.emails_transactionnels introuvable : refus d'exécuter du DDL (il viserait le schéma public).`)
  }
}

/** Une migration = une transaction (comme drizzle) : un seul fsync, et rien n'est appliqué si une instruction échoue. */
async function executer(sql: string, qualifie: boolean): Promise<void> {
  await client.query('BEGIN')
  try {
    for (const statement of sql.split(BREAKPOINT)) {
      if (statement.trim() !== '') await client.query(qualifie ? qualifier(statement) : statement)
    }
    await client.query('COMMIT')
  } catch (erreur) {
    await client.query('ROLLBACK')
    throw erreur
  }
}

async function appliquer0021(): Promise<void> {
  await assertSchemaJetable()
  await executer(lireBrut(migration0021()), true)
}

interface Rollback {
  /** BEGIN, instructions, COMMIT, sans la ligne de journal. */
  executables: string[]
  ligneJournal: string | undefined
}

function rollback(): Rollback {
  const instructions = lireBrut(migration0021())
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

async function prepareAt0020(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0021')) await executer(lireAnterieure(file), false)
  await client.query(`INSERT INTO ${SCHEMA}.users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test'), ('u-b', 'B', 'b@exemple.test')`)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  // Schéma jetable : pas d'attente de fsync à chaque DDL (la durabilité n'a aucun sens ici, et le fichier recrée le schéma à chaque test).
  await client.query('SET synchronous_commit = off')
})

beforeEach(prepareAt0020)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

type Valeurs = Record<string, unknown>

async function inserer(table: string, colonnes: Valeurs): Promise<void> {
  const noms = Object.keys(colonnes)
  await client.query(
    `INSERT INTO ${SCHEMA}.${table} (${noms.join(', ')}) VALUES (${noms.map((_, i) => `$${i + 1}`).join(', ')})`,
    noms.map((nom) => colonnes[nom]),
  )
}

const DANS_15_MIN = new Date(Date.now() + 15 * 60_000)
const MAINTENANT = new Date()

/** Paiement valide `cree` (5 000 XAF, frais à la charge du marchand) ; `surcharge` remplace des colonnes. */
async function paiement(surcharge: Valeurs = {}): Promise<string> {
  const id = typeof surcharge.id === 'string' ? surcharge.id : randomUUID()
  await inserer('paiements', {
    id,
    user_id: 'u-a',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CMR',
    environnement: 'test',
    plan: 'payant',
    periode_mois: 1,
    devise: 'XAF',
    montant_plan: 5000,
    montant: 5000,
    frais_taux_pb: 500,
    frais_supporteur: 'marchand',
    frais_estimes: 250,
    net_estime: 4750,
    expire_avant: DANS_15_MIN,
    ...surcharge,
  })
  return id
}

/** Paiement terminé et appliqué (`reussi`). */
function paiementReussi(surcharge: Valeurs = {}): Promise<string> {
  return paiement({
    statut: 'reussi',
    id_fournisseur: `kp-${randomUUID()}`,
    applique_le: MAINTENANT,
    termine_le: MAINTENANT,
    abonnement_expire_avant: null,
    abonnement_expire_apres: new Date('2027-01-01T23:00:00Z'),
    ...surcharge,
  })
}

async function abonnement(surcharge: Valeurs = {}): Promise<string> {
  const id = randomUUID()
  await inserer('abonnements', {
    id,
    user_id: 'u-a',
    expire_le: new Date('2027-01-01T23:00:00Z'),
    premiere_activation_le: new Date('2026-12-01T10:00:00Z'),
    ...surcharge,
  })
  return id
}

async function evenement(surcharge: Valeurs = {}): Promise<string> {
  const id = randomUUID()
  await inserer('evenements_paiement', {
    id,
    fournisseur: 'kpay',
    evenement: 'payment.completed',
    source: 'webhook',
    id_transaction: 'tx-1',
    traitement: 'applique',
    ...surcharge,
  })
  return id
}

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
  const colonnes: Valeurs = {
    id,
    type: 'reservation_visiteur_recue',
    entite_type: 'reservation',
    entite_id: `r-${id}`,
    ...valeurs,
  }
  if (colonnes.statut === 'envoye') colonnes.envoye_le = new Date('2026-11-02T08:00:00Z')
  await inserer('emails_transactionnels', colonnes)
  return id
}

function rappel(surcharge: LigneOutbox = {}): LigneOutbox {
  return { type: 'abonnement_rappel', entite_type: 'abonnement', entite_id: 'ab-1', occurrence: OCCURRENCE_RAPPEL, ...surcharge }
}

function recu(surcharge: LigneOutbox = {}): LigneOutbox {
  return { type: 'paiement_confirme', entite_type: 'paiement', entite_id: 'pa-1', ...surcharge }
}

async function generation(motif: string): Promise<void> {
  await inserer('generations_ia', {
    id: randomUUID(),
    user_id: 'u-a',
    type: 'onboarding_vitrine',
    statut: 'repli',
    motif_repli: motif,
    terminee_le: MAINTENANT,
    entree_empreinte: EMPREINTE,
  })
}

async function compter(sql: string, valeurs: unknown[] = []): Promise<number> {
  const resultat = await client.query<{ n: string }>(sql, valeurs)
  return Number(resultat.rows[0]!.n)
}

async function existe(table: string): Promise<boolean> {
  const resultat = await client.query<{ present: string | null }>('SELECT to_regclass($1) AS present', [`${SCHEMA}.${table}`])
  return resultat.rows[0]?.present !== null
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

/** Valeurs entre apostrophes de la CONTRAINTE nommée (CREATE TABLE ou ADD CONSTRAINT) de 0021, hors ROLLBACK. */
function valeursContrainte(nom: string): string[] {
  const contenu = lireBrut(migration0021()).split('\n-- ROLLBACK')[0]!
  const debut = contenu.search(new RegExp(`(?<!DROP )CONSTRAINT "${nom}"`))
  if (debut === -1) throw new Error(`Contrainte ${nom} absente de 0021.`)
  // Fin de la contrainte : fin de l'instruction (ADD CONSTRAINT) ou contrainte suivante / fin de table (CREATE TABLE).
  const fins = [`;${BREAKPOINT}`, '\n\tCONSTRAINT "', '\n);'].map((marque) => contenu.indexOf(marque, debut + 1)).filter((i) => i !== -1)
  const corps = contenu.slice(debut, fins.length > 0 ? Math.min(...fins) : contenu.length)
  return [...corps.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

function codeSql(): string {
  return lireBrut(migration0021()).split('\n').filter((ligne) => !ligne.trim().startsWith('--')).join('\n')
}

interface Snapshot {
  tables: Record<string, {
    columns: Record<string, { type: string, notNull: boolean, default?: unknown }>
    indexes: Record<string, { isUnique: boolean, where?: string }>
    checkConstraints: Record<string, { name: string, value: string }>
    foreignKeys: Record<string, { onDelete?: string, tableFrom: string, tableTo: string }>
  }>
}

function snapshot(): Snapshot {
  return JSON.parse(lireBrut('meta/0021_snapshot.json')) as Snapshot
}

describe('migration 0021 : fichier, journal et synchronisation avec shared/', () => {
  it('est l’unique migration 0021, sans trou dans la numérotation, et laisse 0020 en place', () => {
    const numeros = migrationFiles().map((file) => Number(file.slice(0, 4)))

    expect(migrationFiles().filter((file) => file.startsWith('0021_'))).toHaveLength(1)
    expect(migration0021()).toMatch(/^0021_.*\.sql$/)
    expect(numeros).toEqual(numeros.map((_, index) => index))
    expect(migrationFiles().filter((file) => file.startsWith('0020_'))).toHaveLength(1)
  })

  it('est enregistrée à l’index 21 du journal drizzle, et le ROLLBACK retire cette même entrée', () => {
    const journal = JSON.parse(lireBrut('meta/_journal.json')) as { entries: Array<{ idx: number, tag: string, when: number }> }
    const entree = journal.entries.find((candidate) => candidate.idx === 21)
    const precedente = journal.entries.find((candidate) => candidate.idx === 20)

    expect(entree?.tag).toBe(migration0021().replace(/\.sql$/, ''))
    expect(entree!.when).toBeGreaterThan(precedente!.when)
    expect(rollback().ligneJournal).toContain(String(entree?.when))
    expect(lireBrut(migration0021())).toContain(`soit ${entree?.when}.`)
  })

  it('reste dans la transaction de drizzle (aucun CONCURRENTLY) et ne supprime ni ne vide aucune table existante', () => {
    const instructions = codeSql()

    expect(instructions).not.toMatch(/CONCURRENTLY/i)
    expect(instructions).not.toMatch(/DROP TABLE/i)
    expect(instructions).not.toMatch(/\bTRUNCATE\b/i)
    expect(instructions).not.toMatch(/\bDELETE FROM\b/i)
    // Aucune colonne ajoutée à une table existante : aucun NOT NULL posé d'un coup sur une table peuplée.
    expect(instructions).not.toMatch(/ADD COLUMN/i)
  })

  it('crée paiements avant abonnements et evenements_paiement (les FK pointent vers paiements)', () => {
    const sql = codeSql()
    const creations = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])
    const premiereFk = sql.indexOf('FOREIGN KEY')

    expect([...creations].sort()).toEqual([...NOUVELLES_TABLES].sort())
    for (const table of NOUVELLES_TABLES) expect(sql.indexOf(`CREATE TABLE "${table}"`)).toBeLessThan(premiereFk)
  })

  it('recopie exactement TRANSACTIONAL_EMAIL_TYPES dans la CHECK des types', () => {
    expect(valeursContrainte('emails_transactionnels_type_check')).toEqual([...TRANSACTIONAL_EMAIL_TYPES])
  })

  it('recopie exactement PAIEMENT_STATUTS, FRAIS_SUPPORTEURS et le format de fournisseur de shared/paiements', () => {
    expect(valeursContrainte('paiements_statut_check')).toEqual([...PAIEMENT_STATUTS])
    expect(valeursContrainte('paiements_frais_supporteur_check')).toEqual([...FRAIS_SUPPORTEURS])
    const sql = codeSql()
    expect(sql).toContain(`"paiements"."fournisseur" ~ '${FOURNISSEUR_FORMAT.source}'`)
    expect(sql).toContain(`"evenements_paiement"."fournisseur" ~ '${FOURNISSEUR_FORMAT.source}'`)
  })

  it('recopie exactement MOTIFS_REPLI dans la CHECK des motifs de repli', () => {
    expect(valeursContrainte('generations_ia_motif_check')).toEqual([...MOTIFS_REPLI])
    expect(valeursContrainte('generations_ia_motif_check')).toEqual([...MOTIFS_REPLI_AVANT, 'quota_atteint'])
  })

  it('exige une occurrence pour abonnement_rappel en plus des types S9, et seulement eux', () => {
    expect(valeursContrainte('emails_transactionnels_occurrence_requise_check')).toEqual(TYPES_AVEC_OCCURRENCE)
    expect(TYPES_AVEC_OCCURRENCE.every((type) => (TRANSACTIONAL_EMAIL_TYPES as readonly string[]).includes(type))).toBe(true)
  })

  it('a un snapshot qui décrit exactement les colonnes, index, CHECK et FK des trois tables', async () => {
    await appliquer0021()
    const tables = snapshot().tables

    for (const nom of NOUVELLES_TABLES) {
      const decrite = tables[`public.${nom}`]
      expect(decrite, nom).toBeDefined()
      const colonnes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [SCHEMA, nom],
      )
      const contraintes = await client.query<{ conname: string }>(
        `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1 AND t.relname = $2 AND c.contype = 'c'`,
        [SCHEMA, nom],
      )
      const index = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname NOT LIKE '%_pkey' AND indexname NOT LIKE '%_user_id_unique'`,
        [SCHEMA, nom],
      )
      expect(Object.keys(decrite!.columns).sort(), `${nom} colonnes`).toEqual(colonnes.rows.map((c) => c.column_name).sort())
      expect(Object.keys(decrite!.checkConstraints).sort(), `${nom} checks`).toEqual(contraintes.rows.map((c) => c.conname).sort())
      // Index créés par CREATE INDEX (hors clé primaire et contrainte UNIQUE de table) : tous présents au snapshot.
      for (const { indexname } of index.rows) expect(Object.keys(decrite!.indexes), `${nom} ${indexname}`).toContain(indexname)
    }
    expect(tables['public.emails_transactionnels']!.checkConstraints.emails_transactionnels_type_check!.value).toContain('paiement_confirme')
    expect(tables['public.generations_ia']!.checkConstraints.generations_ia_motif_check!.value).toContain('quota_atteint')
  })

  it('déclare dans le snapshot les règles de suppression : SET NULL pour les paiements, CASCADE pour l’abonnement', () => {
    const { tables } = snapshot()
    const regle = (table: string, nom: string) => tables[`public.${table}`]!.foreignKeys[nom]?.onDelete

    expect(regle('paiements', 'paiements_user_id_users_id_fk')).toBe('set null')
    expect(regle('evenements_paiement', 'evenements_paiement_paiement_id_paiements_id_fk')).toBe('set null')
    expect(regle('abonnements', 'abonnements_dernier_paiement_id_paiements_id_fk')).toBe('set null')
    expect(regle('abonnements', 'abonnements_user_id_users_id_fk')).toBe('cascade')
  })

  it('qualifie toute instruction par le schéma jetable avant exécution (aucun DROP / ALTER / UPDATE visant public)', () => {
    const instructions = [...lireBrut(migration0021()).split(BREAKPOINT), ...rollback().executables]
      .map((s) => qualifier(s))
      .join('\n')
      .split('\n')
      .filter((ligne) => !ligne.trim().startsWith('--'))
      .join('\n')

    expect(instructions).not.toMatch(/\bALTER TABLE "/)
    expect(instructions).not.toMatch(/\bDROP TABLE "/)
    expect(instructions).not.toMatch(/\bCREATE TABLE "/)
    expect(instructions).not.toMatch(/\bDROP INDEX "/)
    expect(instructions).not.toMatch(/\bDELETE FROM "/)
    expect(instructions).not.toMatch(/\bUPDATE "/)
    expect(instructions).not.toMatch(/\bREFERENCES "/)
    expect(instructions).not.toMatch(/\bON "/)
  })
})

describe('migration 0021 : appliquée par drizzle sur la base de test (schéma public)', () => {
  it('a créé les trois tables, avec le journal à l’index 21', async () => {
    for (const nom of NOUVELLES_TABLES) {
      const resultat = await client.query<{ present: string | null }>('SELECT to_regclass($1) AS present', [`public.${nom}`])
      expect(resultat.rows[0]?.present, nom).not.toBeNull()
    }
    const journal = JSON.parse(lireBrut('meta/_journal.json')) as { entries: Array<{ idx: number, when: number }> }
    const when = journal.entries.find((entree) => entree.idx === 21)!.when
    const ligne = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when])

    expect(Number(ligne.rows[0]!.n)).toBe(1)
  })
})

describe('migration 0021 : état avant (0020 seule)', () => {
  it('n’a aucune des trois tables', async () => {
    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(false)
  })

  it('refuse les types abonnement_rappel et paiement_confirme, les entités abonnement et paiement (23514)', async () => {
    await expect(outbox(rappel())).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox(recu())).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox({ entite_type: 'paiement', type: 'reservation_visiteur_recue' })).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('refuse le motif de repli quota_atteint (23514)', async () => {
    await expect(generation('quota_atteint')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'generations_ia_motif_check' })
  })
})

describe('migration 0021 : état après', () => {
  it('s’applique en une passe sur une base en 0020', async () => {
    await expect(appliquer0021()).resolves.toBeUndefined()
    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(true)
  })

  it('conserve les lignes existantes (outbox et générations IA) et ne modifie aucune colonne des tables existantes', async () => {
    const envoyee = await outbox({ statut: 'envoye' })
    const reservation = await outbox({ type: 'reservation_visiteur_rappel', occurrence: '2026-11-12T09:00:00.000Z' })
    await generation('plafond_global')
    const avant = JSON.stringify((await structure() as Record<string, { colonnes: unknown }>).emails_transactionnels!.colonnes)

    await appliquer0021()

    const ids = await client.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.emails_transactionnels ORDER BY id`)
    expect(ids.rows.map((ligne) => ligne.id).sort()).toEqual([envoyee, reservation].sort())
    expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.generations_ia`)).toBe(1)
    expect(JSON.stringify((await structure() as Record<string, { colonnes: unknown }>).emails_transactionnels!.colonnes)).toBe(avant)
  })

  describe('paiements : valeurs par défaut et formats', () => {
    beforeEach(appliquer0021)

    it('accepte un paiement valide et pose les défauts (statut cree, incertitude false, 0 vérification, horodatages)', async () => {
      const id = await paiement()

      const ligne = await client.query(`SELECT statut, initiation_incertaine, verifications, termine_le, applique_le, created_at, updated_at FROM ${SCHEMA}.paiements WHERE id = $1`, [id])
      expect(ligne.rows[0]).toMatchObject({ statut: 'cree', initiation_incertaine: false, verifications: 0, termine_le: null, applique_le: null })
      expect(ligne.rows[0].created_at).toBeInstanceOf(Date)
      expect(ligne.rows[0].updated_at).toBeInstanceOf(Date)
    })

    it.each([
      ['fournisseur', 'majuscules refusées', { fournisseur: 'KPAY' }, 'paiements_fournisseur_check'],
      ['fournisseur', 'vide refusé', { fournisseur: '' }, 'paiements_fournisseur_check'],
      ['fournisseur', '41 caractères refusés', { fournisseur: 'a'.repeat(41) }, 'paiements_fournisseur_check'],
      ['fournisseur', 'espace refusé', { fournisseur: 'k pay' }, 'paiements_fournisseur_check'],
      ['fournisseur', 'saut de ligne refusé', { fournisseur: 'kpay\n' }, 'paiements_fournisseur_check'],
      ['methode', 'majuscule refusée', { methode: 'Carte' }, 'paiements_methode_check'],
      ['methode', 'espace refusé', { methode: 'mobile money' }, 'paiements_methode_check'],
      ['methode', '31 caractères refusés', { methode: 'a'.repeat(31) }, 'paiements_methode_check'],
      ['operateur', 'minuscules refusées', { operateur: 'mtn_momo_cmr' }, 'paiements_operateur_check'],
      ['operateur', '1 caractère refusé', { operateur: 'M' }, 'paiements_operateur_check'],
      ['environnement', 'valeur inconnue refusée', { environnement: 'prod' }, 'paiements_environnement_check'],
      ['statut', 'valeur inconnue refusée', { statut: 'paye', termine_le: MAINTENANT }, 'paiements_statut_check'],
      ['plan', 'gratuit refusé (pas de paiement du plan gratuit)', { plan: 'gratuit' }, 'paiements_plan_check'],
      ['plan', 'majuscule refusée', { plan: 'Payant' }, 'paiements_plan_check'],
      ['periode_mois', '0 refusé', { periode_mois: 0 }, 'paiements_periode_check'],
      ['periode_mois', '37 refusé', { periode_mois: 37 }, 'paiements_periode_check'],
      ['devise', 'minuscules refusées', { devise: 'xaf' }, 'paiements_devise_check'],
      ['devise', '2 lettres refusées', { devise: 'XA' }, 'paiements_devise_check'],
      ['frais_taux_pb', 'négatif refusé', { frais_taux_pb: -1 }, 'paiements_frais_taux_check'],
      ['frais_taux_pb', 'au-delà de 50 % refusé', { frais_taux_pb: 5001 }, 'paiements_frais_taux_check'],
      ['frais_supporteur', 'valeur inconnue refusée', { frais_supporteur: 'tous' }, 'paiements_frais_supporteur_check'],
      ['telephone_empreinte', 'trop courte refusée', { telephone_empreinte: 'abc' }, 'paiements_telephone_empreinte_check'],
      ['telephone_empreinte', 'majuscules hexadécimales refusées', { telephone_empreinte: 'A'.repeat(64) }, 'paiements_telephone_empreinte_check'],
      ['telephone_empreinte', '65 caractères refusés', { telephone_empreinte: 'a'.repeat(65) }, 'paiements_telephone_empreinte_check'],
      ['code_echec', 'minuscules refusées', { code_echec: 'payer_not_found' }, 'paiements_code_echec_check'],
      ['code_echec', '65 caractères refusés', { code_echec: 'A'.repeat(65) }, 'paiements_code_echec_check'],
      ['code_echec', 'phrase libre refusée (pas de message brut)', { code_echec: 'Solde insuffisant' }, 'paiements_code_echec_check'],
      ['id_fournisseur', 'vide refusé', { id_fournisseur: '' }, 'paiements_ids_check'],
      ['id_fournisseur', '101 caractères refusés', { id_fournisseur: 'x'.repeat(101) }, 'paiements_ids_check'],
      ['reference_fournisseur', 'vide refusée', { reference_fournisseur: '' }, 'paiements_ids_check'],
      ['reference_fournisseur', '101 caractères refusés', { reference_fournisseur: 'x'.repeat(101) }, 'paiements_ids_check'],
      ['verifications', 'négatif refusé', { verifications: -1 }, 'paiements_verifications_check'],
      ['verifications', '1001 refusé', { verifications: 1001 }, 'paiements_verifications_check'],
    ])('%s : %s (23514)', async (_colonne, _libelle, surcharge, contrainte) => {
      await expect(paiement(surcharge)).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: contrainte })
    })

    it.each([
      ['fournisseur avec tiret et chiffre', { fournisseur: 'carte-2_x' }],
      ['fournisseur de 40 caractères', { fournisseur: 'a'.repeat(40) }],
      ['méthode carte (déclarée, aucun moyen actif)', { methode: 'carte' }],
      ['opérateur absent', { operateur: null }],
      ['environnement live', { environnement: 'live' }],
      ['période de 36 mois', { periode_mois: 36 }],
      ['période de 12 mois', { periode_mois: 12 }],
      ['taux de 0', { frais_taux_pb: 0 }],
      ['taux de 5000 (50 %)', { frais_taux_pb: 5000 }],
      ['empreinte hexadécimale de 64 caractères', { telephone_empreinte: EMPREINTE }],
      ['numéro masqué contenant « • »', { telephone_masque: MASQUE }],
      ['code d’échec fournisseur', { statut: 'echoue', code_echec: 'PAYER_NOT_FOUND', termine_le: MAINTENANT }],
      ['identifiant fournisseur de 100 caractères', { id_fournisseur: 'x'.repeat(100) }],
    ])('accepte : %s', async (_libelle, surcharge) => {
      await expect(paiement(surcharge)).resolves.toEqual(expect.any(String))
    })

    it('refuse un numéro masqué sans « • » (un numéro en clair ne peut pas être stocké), ou de plus de 32 caractères', async () => {
      await expect(paiement({ telephone_masque: '+237 677 123 456' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_telephone_masque_check' })
      await expect(paiement({ telephone_masque: '237677123456' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_telephone_masque_check' })
      await expect(paiement({ telephone_masque: `${'•'.repeat(32)}9` })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_telephone_masque_check' })
      await expect(paiement({ telephone_masque: '•'.repeat(32) })).resolves.toEqual(expect.any(String))
    })

    it('exige les colonnes obligatoires (23502) : id, fournisseur, méthode, environnement, plan, montants, expiration', async () => {
      for (const colonne of ['fournisseur', 'methode', 'environnement', 'plan', 'periode_mois', 'devise', 'montant_plan', 'montant', 'frais_taux_pb', 'frais_supporteur', 'frais_estimes', 'net_estime', 'expire_avant']) {
        await expect(paiement({ [colonne]: null }), colonne).rejects.toMatchObject({ code: '23502' })
      }
    })
  })

  describe('paiements : montants (paiements_montants_check)', () => {
    beforeEach(appliquer0021)

    it.each([
      ['montant du plan nul', { montant_plan: 0, montant: 5000, net_estime: 4750 }],
      ['montant du plan négatif', { montant_plan: -5000, montant: 5000, net_estime: 4750 }],
      ['montant inférieur au prix du plan', { montant: 4000, net_estime: 3750 }],
      ['montant au-delà du plafond de 1 000 000 000', { montant_plan: 5000, montant: 1_000_000_001, net_estime: 1_000_000_001 - 250 }],
      ['frais estimés négatifs', { frais_estimes: -1, net_estime: 5001 }],
      ['net estimé incohérent (montant − frais)', { net_estime: 4000 }],
      ['frais réels négatifs', { frais_reels: -1 }],
      ['net réel négatif', { net_reel: -1 }],
    ])('refuse : %s', async (_libelle, surcharge) => {
      await expect(paiement(surcharge)).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_montants_check' })
    })

    it.each([
      ['frais à la charge du marchand (montant = prix)', { montant: 5000, frais_estimes: 250, net_estime: 4750 }],
      ['frais à la charge du client (montant majoré)', { frais_supporteur: 'client', montant: 5264, frais_estimes: 264, net_estime: 5000 }],
      ['montant au plafond', { montant_plan: 5000, montant: 1_000_000_000, frais_estimes: 0, net_estime: 1_000_000_000 }],
      ['frais nuls', { frais_taux_pb: 0, frais_estimes: 0, net_estime: 5000 }],
      ['frais et net réels renseignés', { frais_reels: 240, net_reel: 4760 }],
      ['frais et net réels nuls', { frais_reels: 0, net_reel: 0 }],
    ])('accepte : %s', async (_libelle, surcharge) => {
      await expect(paiement(surcharge)).resolves.toEqual(expect.any(String))
    })
  })

  describe('paiements : cohérence du statut', () => {
    beforeEach(appliquer0021)

    it('lie reussi et applique_le (paiements_applique_check)', async () => {
      await expect(paiement({ statut: 'reussi', id_fournisseur: 'kp-1', termine_le: MAINTENANT }))
        .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_applique_check' })
      await expect(paiement({ statut: 'en_attente', id_fournisseur: 'kp-2', applique_le: MAINTENANT }))
        .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_applique_check' })
      await expect(paiement({ statut: 'expire', applique_le: MAINTENANT, termine_le: MAINTENANT }))
        .rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_applique_check' })
      await expect(paiementReussi()).resolves.toEqual(expect.any(String))
    })

    it('exige termine_le pour tout statut terminal, et l’interdit pour cree / en_attente (paiements_terminal_check)', async () => {
      for (const statut of ['echoue', 'annule', 'expire', 'anomalie']) {
        await expect(paiement({ statut }), statut).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_terminal_check' })
        await expect(paiement({ statut, termine_le: MAINTENANT }), statut).resolves.toEqual(expect.any(String))
      }
      await expect(paiement({ statut: 'cree', termine_le: MAINTENANT })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_terminal_check' })
      await expect(paiement({ statut: 'en_attente', id_fournisseur: 'kp-3', termine_le: MAINTENANT })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_terminal_check' })
    })

    it('accepte un completed tardif : un paiement expiré peut passer à reussi, applique_le renseigné', async () => {
      const id = await paiement({ statut: 'expire', termine_le: MAINTENANT })

      await expect(client.query(
        `UPDATE ${SCHEMA}.paiements SET statut = 'reussi', applique_le = now(), id_fournisseur = 'kp-late' WHERE id = $1`,
        [id],
      )).resolves.toBeDefined()
    })

    it('exige un identifiant fournisseur pour en_attente, sauf initiation incertaine (paiements_attente_id_check)', async () => {
      await expect(paiement({ statut: 'en_attente' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_attente_id_check' })
      await expect(paiement({ statut: 'en_attente', id_fournisseur: 'kp-4' })).resolves.toEqual(expect.any(String))
      await expect(paiement({ statut: 'en_attente', initiation_incertaine: true })).resolves.toEqual(expect.any(String))
      await expect(paiement({ statut: 'cree' })).resolves.toEqual(expect.any(String))
    })
  })

  describe('paiements : unicités et clés étrangères', () => {
    beforeEach(appliquer0021)

    it('refuse deux fois le même (fournisseur, id_fournisseur), mais accepte un autre fournisseur et plusieurs NULL', async () => {
      await paiement({ id_fournisseur: 'kp-1' })

      await expect(paiement({ id_fournisseur: 'kp-1' })).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'paiements_fournisseur_id_unique' })
      await expect(paiement({ id_fournisseur: 'kp-1', fournisseur: 'autre' })).resolves.toEqual(expect.any(String))
      await expect(paiement()).resolves.toEqual(expect.any(String))
      await expect(paiement()).resolves.toEqual(expect.any(String))
    })

    it('refuse deux fois la même (fournisseur, reference_fournisseur), mais accepte un autre fournisseur et plusieurs NULL', async () => {
      await paiement({ reference_fournisseur: 'REF-1' })

      await expect(paiement({ reference_fournisseur: 'REF-1' })).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'paiements_fournisseur_reference_unique' })
      await expect(paiement({ reference_fournisseur: 'REF-1', fournisseur: 'autre' })).resolves.toEqual(expect.any(String))
      await expect(paiement({ reference_fournisseur: null })).resolves.toEqual(expect.any(String))
    })

    it('refuse deux paiements de même id (clé primaire = externalId)', async () => {
      const id = await paiement()

      await expect(paiement({ id })).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
    })

    it('rapproche un paiement par (fournisseur, id_fournisseur) avec ON CONFLICT … WHERE … DO NOTHING (idempotence)', async () => {
      await paiement({ id_fournisseur: 'kp-9' })
      const insertion = (id: string) => client.query(
        `INSERT INTO ${SCHEMA}.paiements (id, user_id, fournisseur, methode, environnement, plan, periode_mois, devise, montant_plan, montant,
           frais_taux_pb, frais_supporteur, frais_estimes, net_estime, expire_avant, id_fournisseur)
         VALUES ($1, 'u-a', 'kpay', 'mobile_money', 'test', 'payant', 1, 'XAF', 5000, 5000, 500, 'marchand', 250, 4750, now(), 'kp-9')
         ON CONFLICT (fournisseur, id_fournisseur) WHERE id_fournisseur IS NOT NULL DO NOTHING`,
        [id],
      )

      expect((await insertion(randomUUID())).rowCount).toBe(0)
    })

    it('refuse un user_id inexistant (23503) mais accepte NULL (paiement détaché)', async () => {
      await expect(paiement({ user_id: 'u-fantome' })).rejects.toMatchObject({ code: FK_VIOLATION })
      await expect(paiement({ user_id: null })).resolves.toEqual(expect.any(String))
    })

    it('conserve les paiements à la suppression du compte (SET NULL) et supprime l’abonnement (CASCADE)', async () => {
      const id = await paiementReussi()
      const idAbonnement = await abonnement({ dernier_paiement_id: id })

      await client.query(`DELETE FROM ${SCHEMA}.users WHERE id = 'u-a'`)

      const paiements = await client.query(`SELECT user_id, montant, statut FROM ${SCHEMA}.paiements WHERE id = $1`, [id])
      expect(paiements.rows).toEqual([{ user_id: null, montant: 5000, statut: 'reussi' }])
      expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.abonnements WHERE id = $1`, [idAbonnement])).toBe(0)
    })
  })

  describe('abonnements', () => {
    beforeEach(appliquer0021)

    it('accepte un abonnement valide et pose les défauts (plan payant, horodatages)', async () => {
      const id = await abonnement()

      const ligne = await client.query(`SELECT plan, dernier_paiement_id, created_at, updated_at FROM ${SCHEMA}.abonnements WHERE id = $1`, [id])
      expect(ligne.rows[0]).toMatchObject({ plan: 'payant', dernier_paiement_id: null })
      expect(ligne.rows[0].created_at).toBeInstanceOf(Date)
    })

    it('refuse un second abonnement pour le même utilisateur, mais en accepte un par utilisateur (isolation)', async () => {
      await abonnement()

      await expect(abonnement()).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'abonnements_user_id_unique' })
      await expect(abonnement({ user_id: 'u-b' })).resolves.toEqual(expect.any(String))
    })

    it.each([
      ['plan gratuit', { plan: 'gratuit' }, 'abonnements_plan_check'],
      ['plan en majuscules', { plan: 'Payant' }, 'abonnements_plan_check'],
      ['plan de 31 caractères', { plan: 'a'.repeat(31) }, 'abonnements_plan_check'],
      ['activation après l’échéance', { premiere_activation_le: new Date('2027-02-01T00:00:00Z') }, 'abonnements_dates_check'],
      ['activation égale à l’échéance (échéance exclusive)', { premiere_activation_le: new Date('2027-01-01T23:00:00Z') }, 'abonnements_dates_check'],
    ])('refuse : %s (23514)', async (_libelle, surcharge, contrainte) => {
      await expect(abonnement(surcharge)).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: contrainte })
    })

    it('refuse un user_id inexistant et un dernier_paiement_id inexistant (23503)', async () => {
      await expect(abonnement({ user_id: 'u-fantome' })).rejects.toMatchObject({ code: FK_VIOLATION })
      await expect(abonnement({ dernier_paiement_id: randomUUID() })).rejects.toMatchObject({ code: FK_VIOLATION })
    })

    it('exige user_id, expire_le et premiere_activation_le (23502)', async () => {
      for (const colonne of ['user_id', 'expire_le', 'premiere_activation_le']) {
        await expect(abonnement({ [colonne]: null }), colonne).rejects.toMatchObject({ code: '23502' })
      }
    })

    it('met dernier_paiement_id à NULL quand le paiement est supprimé (SET NULL)', async () => {
      const id = await paiementReussi()
      const idAbonnement = await abonnement({ dernier_paiement_id: id })

      await client.query(`DELETE FROM ${SCHEMA}.paiements WHERE id = $1`, [id])

      const ligne = await client.query(`SELECT dernier_paiement_id FROM ${SCHEMA}.abonnements WHERE id = $1`, [idAbonnement])
      expect(ligne.rows).toEqual([{ dernier_paiement_id: null }])
    })
  })

  describe('evenements_paiement', () => {
    beforeEach(appliquer0021)

    it('accepte un événement valide', async () => {
      await expect(evenement()).resolves.toEqual(expect.any(String))
    })

    it.each([
      ['fournisseur', 'majuscules', { fournisseur: 'KPAY' }, 'evenements_paiement_fournisseur_check'],
      ['evenement', 'sans point', { evenement: 'completed' }, 'evenements_paiement_evenement_check'],
      ['evenement', 'majuscule', { evenement: 'payment.Completed' }, 'evenements_paiement_evenement_check'],
      ['evenement', 'segment vide', { evenement: 'payment.' }, 'evenements_paiement_evenement_check'],
      ['evenement', 'trois segments', { evenement: 'payment.completed.x' }, 'evenements_paiement_evenement_check'],
      ['evenement', 'caractère quelconque à la place du point', { evenement: 'payment-completed' }, 'evenements_paiement_evenement_check'],
      ['source', 'valeur inconnue', { source: 'manuel' }, 'evenements_paiement_source_check'],
      ['id_transaction', 'vide', { id_transaction: '' }, 'evenements_paiement_ids_check'],
      ['id_transaction', '101 caractères', { id_transaction: 'x'.repeat(101) }, 'evenements_paiement_ids_check'],
      ['external_id', '101 caractères', { external_id: 'x'.repeat(101) }, 'evenements_paiement_ids_check'],
      ['statut_fournisseur', 'minuscules', { statut_fournisseur: 'completed' }, 'evenements_paiement_statut_check'],
      ['traitement', 'valeur inconnue', { traitement: 'rejete' }, 'evenements_paiement_traitement_check'],
      ['motif', 'minuscules', { motif: 'montant_incoherent' }, 'evenements_paiement_motif_check'],
      ['motif', 'phrase libre (pas de texte brut)', { motif: 'Le montant ne correspond pas' }, 'evenements_paiement_motif_check'],
    ])('%s : %s refusé (23514)', async (_colonne, _libelle, surcharge, contrainte) => {
      await expect(evenement(surcharge)).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: contrainte })
    })

    it.each([
      ['événement échoué', { evenement: 'payment.failed' }],
      ['événement annulé', { evenement: 'payment.cancelled' }],
      ['source interrogation', { source: 'interrogation' }],
      ['statut fournisseur COMPLETED', { statut_fournisseur: 'COMPLETED' }],
      ['traitement anomalie avec motif', { traitement: 'anomalie', motif: 'MONTANT_INCOHERENT' }],
      ['traitement ignoré sans paiement connu', { traitement: 'ignore', motif: 'PAIEMENT_INCONNU', paiement_id: null }],
      ['montant et horodatage fournisseur', { montant: 5000, horodatage_fournisseur: MAINTENANT }],
    ])('accepte : %s', async (_libelle, surcharge) => {
      await expect(evenement(surcharge)).resolves.toEqual(expect.any(String))
    })

    it('déduplique sur (fournisseur, id_transaction, evenement) : doublon refusé, ON CONFLICT DO NOTHING sans effet', async () => {
      await evenement()

      await expect(evenement()).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'evenements_paiement_dedup_unique' })
      const doublon = await client.query(
        `INSERT INTO ${SCHEMA}.evenements_paiement (id, fournisseur, evenement, source, id_transaction, traitement)
         VALUES ($1, 'kpay', 'payment.completed', 'interrogation', 'tx-1', 'ignore')
         ON CONFLICT (fournisseur, id_transaction, evenement) DO NOTHING`,
        [randomUUID()],
      )
      expect(doublon.rowCount).toBe(0)
      expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.evenements_paiement`)).toBe(1)
    })

    it('accepte le même identifiant de transaction pour un autre événement, une autre transaction ou un autre fournisseur', async () => {
      await evenement()

      await expect(evenement({ evenement: 'payment.failed' })).resolves.toEqual(expect.any(String))
      await expect(evenement({ id_transaction: 'tx-2' })).resolves.toEqual(expect.any(String))
      await expect(evenement({ fournisseur: 'autre' })).resolves.toEqual(expect.any(String))
    })

    it('refuse un paiement_id inexistant (23503)', async () => {
      await expect(evenement({ paiement_id: randomUUID() })).rejects.toMatchObject({ code: FK_VIOLATION })
    })

    it('conserve le journal quand le paiement est supprimé (SET NULL)', async () => {
      const id = await paiementReussi()
      const idEvenement = await evenement({ paiement_id: id })

      await client.query(`DELETE FROM ${SCHEMA}.paiements WHERE id = $1`, [id])

      const ligne = await client.query(`SELECT paiement_id, evenement FROM ${SCHEMA}.evenements_paiement WHERE id = $1`, [idEvenement])
      expect(ligne.rows).toEqual([{ paiement_id: null, evenement: 'payment.completed' }])
    })
  })

  describe('isolation de deux utilisateurs', () => {
    beforeEach(appliquer0021)

    it('ne montre à chacun que ses paiements (filtre user_id) et supprimer A laisse B intact', async () => {
      const a = await paiementReussi({ user_id: 'u-a' })
      const b = await paiementReussi({ user_id: 'u-b' })
      await abonnement({ user_id: 'u-a', dernier_paiement_id: a })
      await abonnement({ user_id: 'u-b', dernier_paiement_id: b })

      const deA = await client.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.paiements WHERE user_id = 'u-a'`)
      const deB = await client.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.paiements WHERE user_id = 'u-b'`)
      expect(deA.rows.map((l) => l.id)).toEqual([a])
      expect(deB.rows.map((l) => l.id)).toEqual([b])

      await client.query(`DELETE FROM ${SCHEMA}.users WHERE id = 'u-a'`)

      const restant = await client.query(`SELECT a.user_id, a.dernier_paiement_id, p.user_id AS payeur FROM ${SCHEMA}.abonnements a JOIN ${SCHEMA}.paiements p ON p.id = a.dernier_paiement_id`)
      expect(restant.rows).toEqual([{ user_id: 'u-b', dernier_paiement_id: b, payeur: 'u-b' }])
      expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.paiements WHERE user_id IS NULL`)).toBe(1)
    })

    it('limite par numéro : l’empreinte identique se retrouve entre utilisateurs, sans jamais stocker le numéro', async () => {
      await paiement({ user_id: 'u-a', telephone_empreinte: EMPREINTE, telephone_masque: MASQUE })
      await paiement({ user_id: 'u-b', telephone_empreinte: EMPREINTE, telephone_masque: MASQUE })

      const fenetre = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${SCHEMA}.paiements WHERE telephone_empreinte = $1 AND created_at > now() - interval '15 minutes'`,
        [EMPREINTE],
      )
      expect(Number(fenetre.rows[0]!.n)).toBe(2)
      const colonnes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'paiements' AND column_name ILIKE '%telephone%'`,
        [SCHEMA],
      )
      expect(colonnes.rows.map((c) => c.column_name).sort()).toEqual(['telephone_empreinte', 'telephone_masque'])
    })
  })

  describe('outbox : abonnement_rappel et paiement_confirme', () => {
    beforeEach(appliquer0021)

    it('accepte un rappel d’abonnement (entité abonnement, occurrence J7:ISO ≤ 32 caractères) et un reçu (entité paiement)', async () => {
      expect(OCCURRENCE_RAPPEL.length).toBeLessThanOrEqual(32)
      await expect(outbox(rappel())).resolves.toEqual(expect.any(String))
      await expect(outbox(recu())).resolves.toEqual(expect.any(String))
    })

    it('refuse un rappel d’abonnement sans occurrence (occurrence_requise_check), mais pas un reçu', async () => {
      await expect(outbox(rappel({ occurrence: '' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_occurrence_requise_check' })
      await expect(outbox(recu({ occurrence: '' }))).resolves.toEqual(expect.any(String))
    })

    it('garde l’exigence d’occurrence des trois types S9', async () => {
      await expect(outbox({ type: 'reservation_visiteur_rappel', occurrence: '' })).rejects.toMatchObject({ constraint: 'emails_transactionnels_occurrence_requise_check' })
      await expect(outbox({ type: 'utilisateur_rappel_journee', entite_type: 'utilisateur', entite_id: 'u-a', occurrence: '' })).rejects.toMatchObject({ constraint: 'emails_transactionnels_occurrence_requise_check' })
    })

    it('refuse les croisements entité / type (entite_coherence_check)', async () => {
      await expect(outbox(rappel({ entite_type: 'paiement' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
      await expect(outbox(recu({ entite_type: 'abonnement' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
      await expect(outbox(rappel({ entite_type: 'utilisateur' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
      await expect(outbox({ type: 'reservation_visiteur_recue', entite_type: 'abonnement' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_entite_coherence_check' })
      await expect(outbox({ type: 'utilisateur_resume_hebdo', entite_type: 'paiement', occurrence: '2026-W44', categorie: 'relationnel' })).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuse un type inconnu et une entité inconnue', async () => {
      await expect(outbox(recu({ type: 'paiement_inconnu' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_type_check' })
      await expect(outbox(recu({ entite_type: 'facture' }))).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('est transactionnel : la catégorie relationnelle est refusée sur les deux nouveaux types', async () => {
      await expect(outbox(rappel({ categorie: 'relationnel' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_type_check' })
      await expect(outbox(recu({ categorie: 'relationnel' }))).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'emails_transactionnels_categorie_type_check' })
    })

    it('est idempotent par occurrence : J7, J3 et J0 coexistent, un doublon est refusé, et ON CONFLICT DO NOTHING est sans effet', async () => {
      await outbox(rappel({ occurrence: 'J7:2026-12-01T23:00:00.000Z' }))

      await expect(outbox(rappel({ occurrence: 'J3:2026-12-01T23:00:00.000Z' }))).resolves.toEqual(expect.any(String))
      await expect(outbox(rappel({ occurrence: 'J0:2026-12-01T23:00:00.000Z' }))).resolves.toEqual(expect.any(String))
      await expect(outbox(rappel({ occurrence: 'J7:2026-12-01T23:00:00.000Z' }))).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'emails_transactionnels_entite_evenement_unique' })
      await expect(outbox(rappel({ occurrence: 'J7:2027-01-01T23:00:00.000Z' }))).resolves.toEqual(expect.any(String))
      const doublon = await client.query(
        `INSERT INTO ${SCHEMA}.emails_transactionnels (id, type, entite_type, entite_id, occurrence)
         VALUES ($1, 'abonnement_rappel', 'abonnement', 'ab-1', 'J7:2026-12-01T23:00:00.000Z')
         ON CONFLICT (entite_type, entite_id, type, occurrence) DO NOTHING`,
        [randomUUID()],
      )
      expect(doublon.rowCount).toBe(0)
    })

    it('garde un seul reçu par paiement (occurrence vide) et un reçu par paiement distinct', async () => {
      await outbox(recu())

      await expect(outbox(recu())).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
      await expect(outbox(recu({ entite_id: 'pa-2' }))).resolves.toEqual(expect.any(String))
    })

    it('garde les types et entités S7 / S9 valides', async () => {
      await expect(outbox({ type: 'message_professionnel_nouvelle', entite_type: 'message' })).resolves.toEqual(expect.any(String))
      await expect(outbox({ type: 'utilisateur_resume_hebdo', entite_type: 'utilisateur', entite_id: 'u-a', occurrence: '2026-W44', categorie: 'relationnel' })).resolves.toEqual(expect.any(String))
    })
  })

  describe('generations_ia : motif quota_atteint', () => {
    beforeEach(appliquer0021)

    it('accepte quota_atteint et les neuf motifs précédents, refuse un motif inconnu', async () => {
      await expect(generation('quota_atteint')).resolves.toBeUndefined()
      for (const motif of MOTIFS_REPLI_AVANT) await expect(generation(motif), motif).resolves.toBeUndefined()
      await expect(generation('autre')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'generations_ia_motif_check' })
      await expect(generation('QUOTA_ATTEINT')).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('garde la cohérence statut repli ⇔ motif', async () => {
      await expect(inserer('generations_ia', {
        id: randomUUID(), user_id: 'u-a', type: 'onboarding_vitrine', statut: 'terminee', motif_repli: 'quota_atteint', terminee_le: MAINTENANT, entree_empreinte: EMPREINTE,
      })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'generations_ia_motif_coherence_check' })
    })
  })

  describe('index et règles de suppression', () => {
    beforeEach(appliquer0021)

    it('crée les index justifiés par une requête réelle, avec leurs prédicats partiels', async () => {
      const resultat = await client.query<{ indexname: string, indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename IN ('paiements','abonnements','evenements_paiement')`,
        [SCHEMA],
      )
      const index = Object.fromEntries(resultat.rows.map((i) => [i.indexname, i.indexdef]))

      expect(index.paiements_fournisseur_id_unique).toMatch(/UNIQUE.*\(fournisseur, id_fournisseur\).*WHERE \(id_fournisseur IS NOT NULL\)/)
      expect(index.paiements_fournisseur_reference_unique).toMatch(/UNIQUE.*\(fournisseur, reference_fournisseur\).*WHERE \(reference_fournisseur IS NOT NULL\)/)
      expect(index.paiements_user_created_idx).toMatch(/\(user_id, created_at DESC\)/)
      expect(index.paiements_ouverts_idx).toMatch(/\(user_id\).*WHERE \(statut = ANY|WHERE \(statut IN/)
      expect(index.paiements_a_verifier_idx).toMatch(/\(prochaine_verification\).*WHERE \(statut = ANY|WHERE \(statut IN/)
      expect(index.paiements_telephone_idx).toMatch(/\(telephone_empreinte, created_at\).*WHERE \(telephone_empreinte IS NOT NULL\)/)
      expect(index.abonnements_expire_le_idx).toMatch(/\(expire_le\)/)
      expect(index.abonnements_dernier_paiement_idx).toMatch(/\(dernier_paiement_id\)/)
      expect(index.evenements_paiement_dedup_unique).toMatch(/UNIQUE.*\(fournisseur, id_transaction, evenement\)/)
      expect(index.evenements_paiement_paiement_idx).toMatch(/\(paiement_id\)/)
    })

    it('peut utiliser l’index partiel du tick de rapprochement pour les paiements dus (EXPLAIN)', async () => {
      const colonnes = `fournisseur, methode, environnement, plan, periode_mois, devise, montant_plan, montant, frais_taux_pb,
        frais_supporteur, frais_estimes, net_estime, expire_avant`
      const valeurs = `'kpay', 'mobile_money', 'test', 'payant', 1, 'XAF', 5000, 5000, 500, 'marchand', 250, 4750, now()`
      await client.query(
        `INSERT INTO ${SCHEMA}.paiements (id, user_id, id_fournisseur, statut, applique_le, termine_le, ${colonnes})
         SELECT gen_random_uuid()::text, 'u-b', 'kp-' || g, 'reussi', now(), now(), ${valeurs} FROM generate_series(1, 300) g`,
      )
      await client.query(
        `INSERT INTO ${SCHEMA}.paiements (id, user_id, statut, prochaine_verification, ${colonnes})
         SELECT gen_random_uuid()::text, 'u-b', 'cree', now() - (g || ' seconds')::interval, ${valeurs} FROM generate_series(1, 20) g`,
      )
      await client.query(`ANALYZE ${SCHEMA}.paiements`)
      // On prouve que l'index partiel est UTILISABLE par la requête du tick (le choix du planificateur sur 320 lignes
      // n'est pas le sujet) : on interdit le parcours séquentiel le temps du EXPLAIN.
      await client.query('SET enable_seqscan = off')
      try {
        const plan = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM ${SCHEMA}.paiements WHERE statut IN ('cree','en_attente') AND prochaine_verification <= now()
           ORDER BY prochaine_verification LIMIT 5`,
        )
        expect(plan.rows.map((ligne) => ligne['QUERY PLAN']).join('\n')).toContain('paiements_a_verifier_idx')
      } finally {
        await client.query('RESET enable_seqscan')
      }
    })

    it('porte les règles ON DELETE attendues : SET NULL (paiements.user_id, evenements.paiement_id, abonnements.dernier_paiement_id), CASCADE (abonnements.user_id)', async () => {
      const resultat = await client.query<{ conname: string, confdeltype: string }>(
        `SELECT c.conname, c.confdeltype FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1 AND c.contype = 'f' AND t.relname IN ('paiements','abonnements','evenements_paiement')`,
        [SCHEMA],
      )
      const regles = Object.fromEntries(resultat.rows.map((r) => [r.conname, r.confdeltype]))

      expect(regles).toEqual({
        paiements_user_id_users_id_fk: 'n',
        evenements_paiement_paiement_id_paiements_id_fk: 'n',
        abonnements_dernier_paiement_id_paiements_id_fk: 'n',
        abonnements_user_id_users_id_fk: 'c',
      })
    })
  })
})

describe('migration 0021 : ROLLBACK documenté', () => {
  it('est un bloc BEGIN … COMMIT dont la première instruction refuse de supprimer des paiements live', () => {
    const { executables } = rollback()

    expect(executables[0]).toBe('BEGIN;')
    expect(executables.at(-1)).toBe('COMMIT;')
    expect(executables[1]).toMatch(/^DO \$\$ BEGIN IF EXISTS \(SELECT 1 FROM "paiements" WHERE "environnement" = 'live'\) THEN RAISE EXCEPTION/)
    expect(executables.filter((ligne) => ligne.startsWith('DROP TABLE'))).toEqual([
      'DROP TABLE "evenements_paiement";',
      'DROP TABLE "abonnements";',
      'DROP TABLE "paiements";',
    ])
  })

  it('cible l’entrée idx 21 du journal drizzle (ligne non exécutée ici)', () => {
    expect(rollback().ligneJournal).toMatch(/^DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = \d+/)
  })

  it('documente ses échecs possibles, la perte assumée et l’arrêt préalable du worker', () => {
    const contenu = lireBrut(migration0021())

    expect(contenu).toMatch(/ÉCHOUE/)
    expect(contenu).toMatch(/ARRÊTER le worker/)
    expect(contenu).toMatch(/REFUSÉ si un paiement `live` existe/)
    expect(contenu).toMatch(/23514/)
  })

  it('restaure exactement la structure d’avant (colonnes, contraintes, index de users, outbox et générations IA) et supprime les trois tables', async () => {
    const avant = await structure()
    await appliquer0021()
    expect(await structure()).not.toEqual(avant)

    await executerRollback()

    expect(await structure()).toEqual(avant)
    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(false)
  })

  it('supprime les lignes d’outbox abonnement / paiement, réécrit quota_atteint, et conserve les e-mails S7 déjà envoyés', async () => {
    const envoyee = await outbox({ statut: 'envoye' })
    const rappelVisiteur = await outbox({ type: 'reservation_visiteur_rappel', occurrence: '2026-11-12T09:00:00.000Z' })
    await appliquer0021()
    await outbox(rappel())
    await outbox(recu())
    await generation('quota_atteint')

    await executerRollback()

    const restantes = await client.query<{ id: string }>(`SELECT id FROM ${SCHEMA}.emails_transactionnels`)
    expect(restantes.rows.map((ligne) => ligne.id).sort()).toEqual([envoyee, rappelVisiteur].sort())
    const motifs = await client.query<{ motif_repli: string }>(`SELECT motif_repli FROM ${SCHEMA}.generations_ia`)
    expect(motifs.rows).toEqual([{ motif_repli: 'plafond_global' }])
  })

  it('refuse le rollback, sans rien modifier, quand un paiement live existe (pièce comptable)', async () => {
    await appliquer0021()
    await paiement({ environnement: 'live' })
    await outbox(recu())
    const avant = await structure()

    await expect(executerRollback()).rejects.toThrow(/paiements live presents/)

    expect(await structure()).toEqual(avant)
    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(true)
    expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.paiements WHERE environnement = 'live'`)).toBe(1)
    expect(await compter(`SELECT count(*)::text AS n FROM ${SCHEMA}.emails_transactionnels WHERE entite_type = 'paiement'`)).toBe(1)
  })

  it('accepte le rollback avec des paiements test, des abonnements et un journal d’événements', async () => {
    await appliquer0021()
    const id = await paiementReussi()
    await abonnement({ dernier_paiement_id: id })
    await evenement({ paiement_id: id })

    await expect(executerRollback()).resolves.toBeUndefined()

    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(false)
  })

  it('restaure les anciens refus : types, entités et motif quota_atteint de nouveau rejetés', async () => {
    await appliquer0021()
    await executerRollback()

    await expect(outbox(rappel())).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox(recu())).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(generation('quota_atteint')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'generations_ia_motif_check' })
    await expect(generation('plafond_global')).resolves.toBeUndefined()
  })

  it('peut se rejouer : montée, ROLLBACK, remontée, puis les contraintes S10 sont de nouveau actives (up / down / up)', async () => {
    await appliquer0021()
    await executerRollback()

    await expect(appliquer0021()).resolves.toBeUndefined()

    await expect(outbox(rappel({ occurrence: '' }))).rejects.toMatchObject({ code: CHECK_VIOLATION })
    await expect(outbox(rappel())).resolves.toEqual(expect.any(String))
    await expect(paiement({ plan: 'gratuit' })).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'paiements_plan_check' })
    await expect(paiement()).resolves.toEqual(expect.any(String))
    await expect(generation('quota_atteint')).resolves.toBeUndefined()
  })

  it('échoue (et annule tout) quand une ligne d’outbox S10 subsiste au moment de recréer l’ancienne CHECK ; la structure S10 reste en place', async () => {
    await appliquer0021()
    await outbox(recu())
    // Simule un worker encore actif : le DELETE est sauté, la ligne `paiement` subsiste.
    const instructions = rollback().executables.filter((ligne) => !ligne.startsWith('DELETE FROM'))
    let echec: unknown

    try {
      for (const instruction of instructions) await client.query(qualifier(instruction))
    } catch (erreur) {
      echec = erreur
      await client.query('ROLLBACK')
    }

    expect(echec).toMatchObject({ code: CHECK_VIOLATION })
    for (const nom of NOUVELLES_TABLES) expect(await existe(nom), nom).toBe(true)
  })
})
