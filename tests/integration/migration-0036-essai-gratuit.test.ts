import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { ABONNEMENT_ORIGINES } from '../../shared/admin-a2'
import { VERSION_CATEGORIES } from '../../shared/admin'
import {
  ESSAI_CATEGORIE,
  ESSAI_CLE_CONFIG,
  ESSAI_DEFAUT,
  ESSAI_EMAIL_ENTITE_TYPE,
  ESSAI_EMAIL_TYPES,
  ESSAI_EMPREINTE_NATURES,
  ESSAI_OCCURRENCE_PREFIXE,
} from '../../shared/essai'
import { TRANSACTIONAL_EMAIL_TYPES } from '../../shared/jobs'
import { schemaValeursEssai } from '../../shared/schemas/admin-versions'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'

// E1 : migration 0036 (essai gratuit à la création de la vitrine) : origine d'abonnement `essai`, catégorie de configuration
// `essai` (clé unique `inscription`, v1 seedée), tables `essais` et `essais_empreintes` (déclencheurs `essais_proteger` et
// `essais_empreintes_proteger`), deux types
// d'e-mail d'outbox. Couvre CA-E1-24 (UPDATE de `fin_le`, DELETE, `user_id` remplacé : 42501) et CA-E1-31 (CHECK : `essai` accepté,
// `Essai` refusé ; catégorie `essai` avec une autre clé refusée ; types d'outbox acceptés), plus la valeur de la v1 (CA-E1-13, côté base).
// État de la base APRÈS la migration (jouée par le globalSetup sur la vraie base de test), contraintes éprouvées par des écritures
// RÉELLES, puis REJEU, RETOUR ARRIÈRE documenté (bloc ROLLBACK exécuté tel quel) et remontée.
// DISCIPLINE : `configuration_versions` refuse DELETE (42501) et `essais` aussi. Tout test qui ÉCRIT s'exécute dans une transaction
// TOUJOURS annulée (`dansTransactionAnnulee`) ; un refus attendu s'exécute dans un point de sauvegarde (`refus`) pour que la
// transaction survive. La base commune n'en garde aucune trace (le dernier test le vérifie).

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const TAG = '0036_e1_essai_gratuit'
const WHEN_0036 = 1795437551334
const MARQUEUR_RUPTURE = '@@RUPTURE@@'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const INSUFFICIENT_PRIVILEGE = '42501'
const RAISE_EXCEPTION = 'P0001'

const ID_SEED = 'e1000000-essai-inscription-1'
const TABLES_TOUCHEES = ['abonnements', 'configuration_versions', 'emails_transactionnels', 'essais', 'essais_empreintes'] as const
const TYPES_OUTBOX_ESSAI = [...ESSAI_EMAIL_TYPES]
const TYPES_OUTBOX_ANCIENS = TRANSACTIONAL_EMAIL_TYPES.filter((t) => !(TYPES_OUTBOX_ESSAI as readonly string[]).includes(t))
const TYPES_A_OCCURRENCE = [
  'reservation_visiteur_rappel', 'utilisateur_resume_hebdo', 'utilisateur_rappel_journee', 'abonnement_rappel', ...TYPES_OUTBOX_ESSAI,
]
const OCCURRENCE_ESSAI = `${ESSAI_OCCURRENCE_PREFIXE}2026-12-07T09:00:00.000Z`
const DEBUT = '2026-11-23T09:00:00.000Z'
const FIN = '2026-12-07T09:00:00.000Z'
const EMPREINTE_A = 'a'.repeat(64)
const EMPREINTE_B = 'b'.repeat(64)

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Lecteur = Pick<typeof db, 'execute'>
class AnnulationVolontaire extends Error {}

function contenu(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0036_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0036_ est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return readFileSync(path.join(MIGRATIONS_DIR, fichiers[0]!), 'utf-8')
}

/**
 * Instructions du « up » : tout ce qui précède le bloc ROLLBACK, découpé sur les marqueurs `--> statement-breakpoint` de
 * drizzle-kit (ce que fait `migrate`), commentaires de ligne retirés.
 */
function instructionsUp(): string[] {
  const texte = contenu()
  return texte
    .slice(0, texte.indexOf('-- ROLLBACK'))
    .replaceAll('--> statement-breakpoint', `\n${MARQUEUR_RUPTURE}\n`)
    .split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n')
    .split(MARQUEUR_RUPTURE).map((i) => i.trim().replace(/;$/, '')).filter((i) => i !== '')
}

/** Bloc ROLLBACK commenté (entre BEGIN; et COMMIT;), une instruction par ligne. */
function instructionsRollback(): string[] {
  const lignes = contenu().split('\n')
  const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
  const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
  if (debut === -1 || fin <= debut) throw new Error('Bloc ROLLBACK BEGIN/COMMIT introuvable.')
  return lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').trim()).filter((l) => l !== '')
}

async function executer(tx: Tx, instructions: string[]): Promise<void> {
  for (const instruction of instructions) await tx.execute(sql.raw(instruction))
}

async function dansTransactionAnnulee(corps: (tx: Tx) => Promise<void>): Promise<void> {
  const erreur = await rejet(db.transaction(async (tx) => {
    await corps(tx)
    throw new AnnulationVolontaire('annulation volontaire de la transaction de test')
  }))
  expect(erreur.brute).toBeInstanceOf(AnnulationVolontaire)
}

/** Joue une écriture qui doit échouer dans un point de sauvegarde, pour que la transaction survive. */
async function refus(tx: Tx, requete: SQL | string) {
  await tx.execute(sql`SAVEPOINT avant_refus`)
  const erreur = await rejet(tx.execute(typeof requete === 'string' ? sql.raw(requete) : requete))
  await tx.execute(sql`ROLLBACK TO SAVEPOINT avant_refus`)
  return erreur
}

function messageSql(erreur: { brute: unknown, message: string }): string {
  const cause = (erreur.brute as { cause?: { message?: unknown } } | null)?.cause
  return typeof cause?.message === 'string' ? cause.message : erreur.message
}

// --- Écritures de test (SQL paramétré, jamais concaténé) ---

async function creerUtilisateur(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`INSERT INTO users (id, name, email) VALUES (${id}, ${`Test ${id}`}, ${`${id}@example.test`})`)
}

function insererEssai(id: string, userId: string | null, options: { debut?: string, fin?: string, duree?: number, version?: string } = {}): SQL {
  return sql`INSERT INTO essais (id, user_id, debut_le, fin_le, duree_jours, version_id)
    VALUES (${id}, ${userId}, ${options.debut ?? DEBUT}::timestamptz, ${options.fin ?? FIN}::timestamptz, ${options.duree ?? 14}, ${options.version ?? ID_SEED})`
}

function insererEmpreinte(empreinte: string, nature: string, essaiId: string): SQL {
  return sql`INSERT INTO essais_empreintes (empreinte, nature, essai_id) VALUES (${empreinte}, ${nature}, ${essaiId})`
}

function insererAbonnement(id: string, userId: string, origine: string): SQL {
  return sql`INSERT INTO abonnements (id, user_id, expire_le, premiere_activation_le, origine)
    VALUES (${id}, ${userId}, ${FIN}::timestamptz, ${DEBUT}::timestamptz, ${origine})`
}

function insererVersion(id: string, categorie: string, cle: string, numero: number, statut = 'brouillon'): SQL {
  const effective = statut === 'brouillon' ? null : '2026-12-01T00:00:00Z'
  return sql`INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
    VALUES (${id}, ${categorie}, ${cle}, ${numero}, ${JSON.stringify(ESSAI_DEFAUT)}::jsonb, ${statut}, ${effective}::timestamptz, ${'Version de test de la migration'}, ${'admin-1'})`
}

/** Catégorie liée au type (emails_transactionnels_categorie_type_check) : le résumé et les deux relances d'essai sont `relationnel`. */
function categorieAttendue(type: string): string {
  return type === 'utilisateur_resume_hebdo' || (TYPES_OUTBOX_ESSAI as readonly string[]).includes(type) ? 'relationnel' : 'transactionnel'
}

/** Entité de l'outbox déduite du préfixe du type (emails_transactionnels_entite_coherence_check). */
function insererEmail(id: string, type: string, occurrence: string, categorie = categorieAttendue(type)): SQL {
  const entite = type.split('_')[0]!
  return sql`INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie)
    VALUES (${id}, ${type}, ${entite}, ${`entite-${id}`}, ${occurrence}, ${categorie})`
}

// --- Lectures ---

interface LigneConfiguration {
  id: string
  categorie: string
  cle: string
  numero: number
  valeurs: unknown
  statut: string
  effective_a: Date
  cree_par: string
  motif: string
}

async function versionsEssai(lecteur: Lecteur): Promise<LigneConfiguration[]> {
  const resultat = await lecteur.execute<LigneConfiguration>(sql`
    SELECT id, categorie, cle, numero, valeurs, statut, effective_a, cree_par, motif
    FROM configuration_versions WHERE categorie = ${ESSAI_CATEGORIE} ORDER BY numero`)
  return resultat.rows
}

interface Structure {
  contraintes: Array<{ table: string, nom: string, definition: string, validee: boolean }>
  index: Array<{ nom: string, definition: string }>
  declencheurs: Array<{ nom: string, table: string, etat: string, definition: string }>
  fonction: string[]
}

/** Empreinte de la structure touchée par 0036, comparable avant / après un rejeu ou un aller-retour (tables absentes tolérées). */
async function structure(lecteur: Lecteur): Promise<Structure> {
  const liste = sql.join(TABLES_TOUCHEES.map((t) => sql`${t}`), sql`, `)
  const contraintes = await lecteur.execute<{ table: string, nom: string, definition: string, validee: boolean }>(sql`
    SELECT conrelid::regclass::text AS table, conname AS nom, pg_get_constraintdef(oid) AS definition, convalidated AS validee
    FROM pg_constraint WHERE conrelid::regclass::text IN (${liste}) ORDER BY 1, 2`)
  const index = await lecteur.execute<{ nom: string, definition: string }>(sql`
    SELECT indexname AS nom, indexdef AS definition FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN (${liste}) ORDER BY 1`)
  const declencheurs = await lecteur.execute<{ nom: string, table: string, etat: string, definition: string }>(sql`
    SELECT tgname AS nom, tgrelid::regclass::text AS table, tgenabled::text AS etat, pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN (${liste}) ORDER BY 1`)
  const fonction = await lecteur.execute<{ definition: string }>(sql`
    SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname IN ('essais_proteger', 'essais_empreintes_proteger') ORDER BY proname`)
  return {
    contraintes: contraintes.rows, index: index.rows, declencheurs: declencheurs.rows, fonction: fonction.rows.map((r) => r.definition),
  }
}

async function existe(lecteur: Lecteur, relation: string): Promise<boolean> {
  const resultat = await lecteur.execute<{ present: boolean }>(sql`SELECT to_regclass(${`public.${relation}`}) IS NOT NULL AS present`)
  return resultat.rows[0]?.present === true
}

/** Valeurs littérales `'...'` d'une définition de CHECK (liste IN / ANY), dans l'ordre. */
function litteraux(definition: string): string[] {
  return [...definition.matchAll(/'([^']*)'::text/g)].map((m) => m[1]!).filter((valeur) => valeur !== '')
}

async function definitionContrainte(lecteur: Lecteur, table: string, nom: string): Promise<string> {
  const resultat = await lecteur.execute<{ definition: string }>(sql`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = ${`public.${table}`}::regclass AND conname = ${nom}`)
  return resultat.rows[0]?.definition ?? ''
}

describe('migration 0036 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, an idempotent up, its triggers and the commented manual rollback', () => {
    const texte = contenu()
    const up = instructionsUp().join('\n')

    expect(readdirSync(MIGRATIONS_DIR)).toContain(`${TAG}.sql`)
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0036_snapshot.json'))).toBe(true)
    expect(texte).toMatch(/-- ROLLBACK/)
    expect(texte).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "essais"/)
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "essais_empreintes"/)
    expect(up).toMatch(/CREATE TRIGGER essais_proteger/)
    expect(up).toMatch(/CREATE TRIGGER essais_empreintes_proteger/)
    expect(up).toMatch(/ON CONFLICT DO NOTHING/)
    // Idempotence : aucune création ni suppression « nue » (voir les tests de rejeu pour la preuve par l'exécution).
    expect(up).not.toMatch(/CREATE TABLE "/)
    expect(up).not.toMatch(/CREATE (UNIQUE )?INDEX "/)
    for (const suppression of up.matchAll(/DROP CONSTRAINT ("?\w+"? )?"?\w+"?/g)) expect(suppression[0], suppression[0]).toMatch(/IF EXISTS/)
    // Aucune concaténation dynamique : pas d'EXECUTE.
    expect(up).not.toMatch(/\bEXECUTE\b '/)
  })

  it('should be registered right after 0035 in the journal with a later date (or it would never be applied)', () => {
    const { entries } = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[35]).toMatchObject({ idx: 35, tag: '0035_p1b_catalogue_mercypay_xaf' })
    expect(entries[36]).toMatchObject({ idx: 36, tag: TAG, when: WHEN_0036, breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0035 and describe the two new tables', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string, prevId: string, tables: Record<string, unknown>
    }
    const precedent = lire('0035_snapshot.json')
    const courant = lire('0036_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(Object.keys(courant.tables)).toEqual(expect.arrayContaining(['public.essais', 'public.essais_empreintes']))
    expect(Object.keys(courant.tables).sort()).toEqual([...Object.keys(precedent.tables), 'public.essais', 'public.essais_empreintes'].sort())
  })

  it('should have been applied by drizzle (journal row present in the database)', async () => {
    const journal = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0036}`)

    expect(journal.rows[0]?.n).toBe(1)
  })
})

describe('migration 0036 : structure en base (CA-E1-24, tables et déclencheur)', () => {
  it('should hold every constraint VALIDATED and the expected indexes, FK actions and trigger', async () => {
    const etat = await structure(db)
    const noms = etat.contraintes.map((c) => `${c.table}.${c.nom}`)

    expect(etat.contraintes.filter((c) => !c.validee).map((c) => `${c.table}.${c.nom}`)).toEqual([])
    expect(noms).toEqual(expect.arrayContaining([
      'abonnements.abonnements_origine_check',
      'configuration_versions.configuration_versions_categorie_check',
      'configuration_versions.configuration_versions_essai_cle_check',
      'emails_transactionnels.emails_transactionnels_type_check',
      'emails_transactionnels.emails_transactionnels_occurrence_requise_check',
      'emails_transactionnels.emails_transactionnels_categorie_type_check',
      'essais.essais_duree_jours_check', 'essais.essais_dates_check', 'essais.essais_converti_le_check', 'essais.essais_version_id_check',
      'essais.essais_user_id_users_id_fk', 'essais.essais_pkey',
      'essais_empreintes.essais_empreintes_empreinte_check', 'essais_empreintes.essais_empreintes_nature_check',
      'essais_empreintes.essais_empreintes_essai_id_essais_id_fk', 'essais_empreintes.essais_empreintes_pkey',
    ]))
    const unique = etat.index.find((i) => i.nom === 'essais_user_id_unique')
    expect(unique?.definition).toMatch(/CREATE UNIQUE INDEX .* \(user_id\) WHERE \(user_id IS NOT NULL\)/)
    expect(etat.index.map((i) => i.nom)).toContain('essais_debut_le_idx')
    expect(etat.contraintes.find((c) => c.nom === 'essais_user_id_users_id_fk')?.definition).toMatch(/REFERENCES users\(id\) ON DELETE SET NULL/)
    expect(etat.contraintes.find((c) => c.nom === 'essais_empreintes_essai_id_essais_id_fk')?.definition).toMatch(/REFERENCES essais\(id\) ON DELETE RESTRICT/)
    expect(etat.declencheurs.filter((d) => d.table === 'essais').map((d) => [d.nom, d.etat])).toEqual([['essais_proteger', 'O']])
    expect(etat.declencheurs.find((d) => d.nom === 'essais_proteger')?.definition).toMatch(/BEFORE DELETE OR UPDATE ON .*essais FOR EACH ROW/)
    expect(etat.declencheurs.filter((d) => d.table === 'essais_empreintes').map((d) => [d.nom, d.etat])).toEqual([['essais_empreintes_proteger', 'O']])
    expect(etat.declencheurs.find((d) => d.nom === 'essais_empreintes_proteger')?.definition).toMatch(/BEFORE DELETE OR UPDATE ON .*essais_empreintes FOR EACH ROW/)
    expect(etat.fonction).toHaveLength(2)
    for (const definition of etat.fonction) expect(definition).toMatch(/SET search_path TO 'public', 'pg_temp'/)
  })

  it('should store no link from the fingerprints to users (they must survive the account) and no personal column', async () => {
    const liens = await db.execute<{ cible: string }>(sql`
      SELECT confrelid::regclass::text AS cible FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.essais_empreintes'::regclass`)
    const colonnes = await db.execute<{ table_name: string, column_name: string }>(sql`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('essais', 'essais_empreintes') ORDER BY 1, ordinal_position`)

    expect(liens.rows.map((r) => r.cible)).toEqual(['essais'])
    expect(colonnes.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      'essais.id', 'essais.user_id', 'essais.debut_le', 'essais.fin_le', 'essais.duree_jours', 'essais.version_id', 'essais.converti_le',
      'essais_empreintes.empreinte', 'essais_empreintes.nature', 'essais_empreintes.essai_id', 'essais_empreintes.cree_le',
    ])
  })

  it('should leave the common tables empty after the tests cleanup (TRUNCATE users CASCADE reaches essais then essais_empreintes, no truncate guard)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-vidage')
      await tx.execute(insererEssai('essai-vidage', 'u-vidage'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-vidage'))
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais_empreintes`)).rows[0]?.n).toBe(1)

      // Même dispense que tests/integration/setup.ts : le CASCADE atteint journal_admin, dont le déclencheur refuse le vidage.
      await tx.execute(sql`ALTER TABLE journal_admin DISABLE TRIGGER journal_admin_sans_vidage`)
      await tx.execute(sql`TRUNCATE TABLE users CASCADE`)

      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais`)).rows[0]?.n).toBe(0)
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais_empreintes`)).rows[0]?.n).toBe(0)
    })
  })
})

describe('migration 0036 : abonnements.origine (CA-E1-31)', () => {
  it('should accept `essai` and the three older origins, and refuse `Essai` and any other value (abonnements_origine_check)', async () => {
    expect([...ABONNEMENT_ORIGINES]).toEqual(['paiement', 'offert', 'admin', 'essai'])
    await dansTransactionAnnulee(async (tx) => {
      for (const origine of ABONNEMENT_ORIGINES) {
        await creerUtilisateur(tx, `u-${origine}`)
        await tx.execute(insererAbonnement(`abo-${origine}`, `u-${origine}`, origine))
      }
      expect((await tx.execute<{ origine: string }>(sql`SELECT origine FROM abonnements ORDER BY origine`)).rows.map((r) => r.origine))
        .toEqual([...ABONNEMENT_ORIGINES].sort())

      await creerUtilisateur(tx, 'u-refus')
      for (const origine of ['Essai', 'ESSAI', 'essai ', 'trial', '']) {
        const erreur = await refus(tx, insererAbonnement('abo-refus', 'u-refus', origine))
        expect(erreurPostgres(erreur.brute), `origine ${JSON.stringify(origine)}`).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'abonnements_origine_check' })
      }
    })
  })

  it('should keep the existing default origin (`paiement`) and accept the switch of an existing row to `essai`', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-defaut')
      await tx.execute(sql`INSERT INTO abonnements (id, user_id, expire_le, premiere_activation_le) VALUES ('abo-defaut', 'u-defaut', ${FIN}::timestamptz, ${DEBUT}::timestamptz)`)
      const avant = await tx.execute<{ origine: string }>(sql`SELECT origine FROM abonnements WHERE id = 'abo-defaut'`)
      await tx.execute(sql`UPDATE abonnements SET origine = 'essai' WHERE id = 'abo-defaut'`)
      const apres = await tx.execute<{ origine: string }>(sql`SELECT origine FROM abonnements WHERE id = 'abo-defaut'`)

      expect(avant.rows[0]?.origine).toBe('paiement')
      expect(apres.rows[0]?.origine).toBe('essai')
    })
  })
})

describe('migration 0036 : configuration_versions, catégorie `essai` (CA-E1-31, CA-E1-13)', () => {
  it('should seed version 1: active, authored by `systeme`, equal to ESSAI_DEFAUT and accepted by the strict schema of the administration', async () => {
    const rows = await versionsEssai(db)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: ID_SEED, categorie: 'essai', cle: ESSAI_CLE_CONFIG, numero: 1, statut: 'active', cree_par: 'systeme' })
    expect(rows[0]?.valeurs).toEqual(ESSAI_DEFAUT)
    expect(schemaValeursEssai.safeParse(rows[0]?.valeurs).success).toBe(true)
    expect(new Date(rows[0]!.effective_a).toISOString()).toBe('2000-01-01T00:00:00.000Z')
    expect(rows[0]!.motif.trim().length).toBeGreaterThanOrEqual(5)
    expect(rows[0]!.motif.trim().length).toBeLessThanOrEqual(500)
  })

  it('should accept the category `essai` with the key `inscription`, and the four older categories', async () => {
    expect([...VERSION_CATEGORIES]).toEqual(['plan', 'prix', 'frais', 'moyens', 'essai'])
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererVersion('e1000000-essai-inscription-2', 'essai', 'inscription', 2))
      await tx.execute(insererVersion('e1000000-essai-test-plan', 'plan', 'gratuit', 9))
      await tx.execute(insererVersion('e1000000-essai-test-prix', 'prix', 'payant', 9))
      await tx.execute(insererVersion('e1000000-essai-test-frais', 'frais', 'kpay:mobile_money', 9))
      await tx.execute(insererVersion('e1000000-essai-test-moyens', 'moyens', 'kpay', 9))

      expect((await versionsEssai(tx)).map((r) => [r.id, r.statut])).toEqual([[ID_SEED, 'active'], ['e1000000-essai-inscription-2', 'brouillon']])
    })
  })

  it('should refuse the category `essai` with any other key (configuration_versions_essai_cle_check)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      for (const cle of ['autre', 'inscription2', 'inscription-bis', 'kpay']) {
        const erreur = await refus(tx, insererVersion('e1000000-essai-refus', 'essai', cle, 2))
        expect(erreurPostgres(erreur.brute), `cle ${cle}`).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'configuration_versions_essai_cle_check' })
      }
    })
  })

  it('should refuse `Essai` and any unknown category (configuration_versions_categorie_check)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      for (const categorie of ['Essai', 'ESSAI', 'essais', 'trial']) {
        const erreur = await refus(tx, insererVersion('e1000000-essai-refus', categorie, 'inscription', 2))
        expect(erreurPostgres(erreur.brute), `categorie ${categorie}`).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'configuration_versions_categorie_check' })
      }
    })
  })

  it('should keep ONE active version per key (unique partial index) and the protection trigger on the seeded version (content frozen, no DELETE: 42501)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const doublon = await refus(tx, insererVersion('e1000000-essai-inscription-9', 'essai', 'inscription', 3, 'active'))
      const modif = await refus(tx, sql`UPDATE configuration_versions SET valeurs = '{"actif":false}'::jsonb WHERE id = ${ID_SEED}`)
      const suppr = await refus(tx, sql`DELETE FROM configuration_versions WHERE id = ${ID_SEED}`)

      expect(erreurPostgres(doublon.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'configuration_versions_active_unique' })
      expect(erreurPostgres(modif.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres(suppr.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })
})

describe('migration 0036 : essais (CA-E1-24 : immuabilité)', () => {
  it('should accept an essai and its two fingerprints (email, telephone) and read them back', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_B, 'telephone', 'essai-1'))

      const essai = await tx.execute<{ user_id: string, duree_jours: number, version_id: string, converti_le: Date | null }>(
        sql`SELECT user_id, duree_jours, version_id, converti_le FROM essais WHERE id = 'essai-1'`)
      const empreintes = await tx.execute<{ empreinte: string, nature: string }>(
        sql`SELECT empreinte, nature FROM essais_empreintes WHERE essai_id = 'essai-1' ORDER BY nature`)

      expect(essai.rows[0]).toEqual({ user_id: 'u-1', duree_jours: 14, version_id: ID_SEED, converti_le: null })
      expect(empreintes.rows).toEqual([{ empreinte: EMPREINTE_A, nature: 'email' }, { empreinte: EMPREINTE_B, nature: 'telephone' }])
      expect([...ESSAI_EMPREINTE_NATURES]).toEqual(['email', 'telephone'])
    })
  })

  it('should refuse an UPDATE of `fin_le`, of any other frozen column, and a DELETE (42501, nothing changed)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      const avant = (await tx.execute(sql`SELECT * FROM essais`)).rows

      const interdits: Array<[string, SQL]> = [
        ['fin_le', sql`UPDATE essais SET fin_le = fin_le + interval '1 day' WHERE id = 'essai-1'`],
        ['debut_le', sql`UPDATE essais SET debut_le = debut_le - interval '1 day' WHERE id = 'essai-1'`],
        ['duree_jours', sql`UPDATE essais SET duree_jours = 30 WHERE id = 'essai-1'`],
        ['version_id', sql`UPDATE essais SET version_id = 'code' WHERE id = 'essai-1'`],
        ['id', sql`UPDATE essais SET id = 'essai-2' WHERE id = 'essai-1'`],
        ['DELETE', sql`DELETE FROM essais WHERE id = 'essai-1'`],
      ]
      for (const [libelle, requete] of interdits) {
        const erreur = await refus(tx, requete)
        expect(erreurPostgres(erreur.brute).sqlstate, libelle).toBe(INSUFFICIENT_PRIVILEGE)
      }

      expect((await tx.execute(sql`SELECT * FROM essais`)).rows).toEqual(avant)
      expect(avant).toHaveLength(1)
    })
  })

  it('should refuse a `user_id` REPLACED by another account, or set again after a detach (42501), but let it go to NULL', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await creerUtilisateur(tx, 'u-2')
      await tx.execute(insererEssai('essai-1', 'u-1'))

      const remplace = await refus(tx, sql`UPDATE essais SET user_id = 'u-2' WHERE id = 'essai-1'`)
      expect(erreurPostgres(remplace.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)

      await tx.execute(sql`UPDATE essais SET user_id = NULL WHERE id = 'essai-1'`)
      expect((await tx.execute<{ user_id: string | null }>(sql`SELECT user_id FROM essais WHERE id = 'essai-1'`)).rows[0]?.user_id).toBeNull()

      const rattache = await refus(tx, sql`UPDATE essais SET user_id = 'u-2' WHERE id = 'essai-1'`)
      expect(erreurPostgres(rattache.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should let `converti_le` go from NULL to a date ONCE, never back and never to another date, and let an UPDATE that changes nothing pass', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))

      await tx.execute(sql`UPDATE essais SET fin_le = fin_le WHERE id = 'essai-1'`)
      await tx.execute(sql`UPDATE essais SET converti_le = '2026-11-25T10:00:00Z'::timestamptz WHERE id = 'essai-1'`)
      await tx.execute(sql`UPDATE essais SET converti_le = '2026-11-25T10:00:00Z'::timestamptz WHERE id = 'essai-1'`)
      const autreDate = await refus(tx, sql`UPDATE essais SET converti_le = '2026-11-26T10:00:00Z'::timestamptz WHERE id = 'essai-1'`)
      const retour = await refus(tx, sql`UPDATE essais SET converti_le = NULL WHERE id = 'essai-1'`)

      expect(erreurPostgres(autreDate.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres(retour.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(new Date((await tx.execute<{ converti_le: string }>(sql`SELECT converti_le FROM essais WHERE id = 'essai-1'`)).rows[0]!.converti_le).toISOString())
        .toBe('2026-11-25T10:00:00.000Z')
    })
  })

  it('should survive the deletion of the account: user_id becomes NULL, converti_le and the fingerprints are kept (CA-E1-23, CA-E1-06 on the base side)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))
      await tx.execute(sql`UPDATE essais SET converti_le = '2026-11-25T10:00:00Z'::timestamptz WHERE id = 'essai-1'`)

      await tx.execute(sql`DELETE FROM users WHERE id = 'u-1'`)

      const essai = await tx.execute<{ user_id: string | null, converti_le: string | null }>(sql`SELECT user_id, converti_le FROM essais WHERE id = 'essai-1'`)
      expect(essai.rows[0]?.user_id).toBeNull()
      expect(new Date(essai.rows[0]!.converti_le!).toISOString()).toBe('2026-11-25T10:00:00.000Z')
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais_empreintes`)).rows[0]?.n).toBe(1)
    })
  })

  it('should keep tenants apart: one essai per account (partial unique index), detached rows never collide, scoping by user_id returns only the own row', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-a')
      await creerUtilisateur(tx, 'u-b')
      await tx.execute(insererEssai('essai-a', 'u-a'))
      await tx.execute(insererEssai('essai-b', 'u-b', { duree: 30, fin: '2026-12-23T09:00:00.000Z' }))

      const second = await refus(tx, insererEssai('essai-a-bis', 'u-a'))
      expect(erreurPostgres(second.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'essais_user_id_unique' })

      await tx.execute(insererEssai('essai-orphelin-1', null))
      await tx.execute(insererEssai('essai-orphelin-2', null))

      const deA = await tx.execute<{ id: string }>(sql`SELECT id FROM essais WHERE user_id = ${'u-a'}`)
      const deB = await tx.execute<{ id: string, duree_jours: number }>(sql`SELECT id, duree_jours FROM essais WHERE user_id = ${'u-b'}`)
      expect(deA.rows).toEqual([{ id: 'essai-a' }])
      expect(deB.rows).toEqual([{ id: 'essai-b', duree_jours: 30 }])
    })
  })

  it('should refuse bad rows with the named constraint: duration out of 1..90, end not after start, conversion before start, empty or oversized version, unknown account', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      const cas: Array<[string, SQL, string, string]> = [
        ['duree 0', insererEssai('e-0', 'u-1', { duree: 0 }), CHECK_VIOLATION, 'essais_duree_jours_check'],
        ['duree 91', insererEssai('e-91', 'u-1', { duree: 91 }), CHECK_VIOLATION, 'essais_duree_jours_check'],
        ['fin = debut', insererEssai('e-fin', 'u-1', { fin: DEBUT }), CHECK_VIOLATION, 'essais_dates_check'],
        ['fin < debut', insererEssai('e-fin2', 'u-1', { fin: '2026-11-01T00:00:00Z' }), CHECK_VIOLATION, 'essais_dates_check'],
        ['version vide', insererEssai('e-v0', 'u-1', { version: '' }), CHECK_VIOLATION, 'essais_version_id_check'],
        ['version > 64', insererEssai('e-v65', 'u-1', { version: 'v'.repeat(65) }), CHECK_VIOLATION, 'essais_version_id_check'],
        ['compte inconnu', insererEssai('e-fk', 'inconnu'), FK_VIOLATION, 'essais_user_id_users_id_fk'],
        ['converti avant debut', sql`INSERT INTO essais (id, user_id, debut_le, fin_le, duree_jours, version_id, converti_le)
          VALUES ('e-conv', 'u-1', ${DEBUT}::timestamptz, ${FIN}::timestamptz, 14, 'code', '2026-11-01T00:00:00Z'::timestamptz)`, CHECK_VIOLATION, 'essais_converti_le_check'],
      ]
      for (const [libelle, requete, sqlstate, contrainte] of cas) {
        expect(erreurPostgres((await refus(tx, requete)).brute), libelle).toMatchObject({ sqlstate, contrainte })
      }
      // Bornes incluses acceptées, et l'identifiant de repli `code` (ESSAI_DEFAUT, sans ligne de configuration).
      await tx.execute(insererEssai('e-ok-1', null, { duree: 1, fin: '2026-11-24T09:00:00.000Z', version: 'code' }))
      await tx.execute(insererEssai('e-ok-90', null, { duree: 90, fin: '2027-02-21T09:00:00.000Z', version: 'v'.repeat(64) }))
    })
  })
})

describe('migration 0036 : essais_empreintes (attribution atomique)', () => {
  it('should refuse a malformed fingerprint (not 64 lowercase hexadecimal characters) and an unknown nature', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEssai('essai-1', null))
      const cas: Array<[string, string, string, string]> = [
        ['majuscules', 'A'.repeat(64), 'email', 'essais_empreintes_empreinte_check'],
        ['63 caracteres', 'a'.repeat(63), 'email', 'essais_empreintes_empreinte_check'],
        ['65 caracteres', 'a'.repeat(65), 'email', 'essais_empreintes_empreinte_check'],
        ['hors hexadecimal', 'g'.repeat(64), 'email', 'essais_empreintes_empreinte_check'],
        ['adresse en clair', 'prenom.nom@example.test', 'email', 'essais_empreintes_empreinte_check'],
        ['nature sms', EMPREINTE_A, 'sms', 'essais_empreintes_nature_check'],
        ['nature Email', EMPREINTE_A, 'Email', 'essais_empreintes_nature_check'],
      ]
      for (const [libelle, empreinte, nature, contrainte] of cas) {
        expect(erreurPostgres((await refus(tx, insererEmpreinte(empreinte, nature, 'essai-1'))).brute), libelle)
          .toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte })
      }
    })
  })

  it('should make the claim atomic: a second INSERT ... ON CONFLICT DO NOTHING RETURNING of the same fingerprint returns NO row (CA-E1-06, 07, 08 on the base side)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEssai('essai-1', null))
      await tx.execute(insererEssai('essai-2', null))
      const requete = (essaiId: string) => sql`INSERT INTO essais_empreintes (empreinte, nature, essai_id) VALUES (${EMPREINTE_A}, 'email', ${essaiId})
        ON CONFLICT DO NOTHING RETURNING empreinte`

      const premier = await tx.execute(requete('essai-1'))
      const second = await tx.execute(requete('essai-2'))
      const doublon = await refus(tx, insererEmpreinte(EMPREINTE_A, 'email', 'essai-2'))

      expect(premier.rows).toHaveLength(1)
      expect(second.rows).toHaveLength(0)
      expect(erreurPostgres(doublon.brute)).toMatchObject({ sqlstate: UNIQUE_VIOLATION, contrainte: 'essais_empreintes_pkey' })
      expect((await tx.execute<{ essai_id: string }>(sql`SELECT essai_id FROM essais_empreintes WHERE empreinte = ${EMPREINTE_A}`)).rows).toEqual([{ essai_id: 'essai-1' }])
    })
  })

  it('should refuse a DELETE of a fingerprint (42501): the essai would be reopened to the person, the row is kept', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEssai('essai-1', null))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))

      const parEmpreinte = await refus(tx, sql`DELETE FROM essais_empreintes WHERE empreinte = ${EMPREINTE_A}`)
      const parEssai = await refus(tx, sql`DELETE FROM essais_empreintes WHERE essai_id = 'essai-1'`)
      const toutes = await refus(tx, 'DELETE FROM essais_empreintes')

      for (const erreur of [parEmpreinte, parEssai, toutes]) expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(messageSql(parEmpreinte)).toContain('suppression interdite')
      expect((await tx.execute<{ empreinte: string }>(sql`SELECT empreinte FROM essais_empreintes`)).rows).toEqual([{ empreinte: EMPREINTE_A }])
    })
  })

  it('should refuse any UPDATE that changes a fingerprint row, `essai_id` included (42501, nothing changed), but let an UPDATE that changes nothing pass', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEssai('essai-1', null))
      await tx.execute(insererEssai('essai-2', null))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))
      const avant = (await tx.execute(sql`SELECT * FROM essais_empreintes`)).rows

      const interdits: Array<[string, SQL]> = [
        ['essai_id', sql`UPDATE essais_empreintes SET essai_id = 'essai-2' WHERE empreinte = ${EMPREINTE_A}`],
        ['empreinte', sql`UPDATE essais_empreintes SET empreinte = ${EMPREINTE_B} WHERE empreinte = ${EMPREINTE_A}`],
        ['nature', sql`UPDATE essais_empreintes SET nature = 'telephone' WHERE empreinte = ${EMPREINTE_A}`],
        ['cree_le', sql`UPDATE essais_empreintes SET cree_le = cree_le - interval '1 day' WHERE empreinte = ${EMPREINTE_A}`],
      ]
      for (const [libelle, requete] of interdits) {
        const erreur = await refus(tx, requete)
        expect(erreurPostgres(erreur.brute).sqlstate, libelle).toBe(INSUFFICIENT_PRIVILEGE)
        expect(messageSql(erreur), libelle).toContain('ligne immuable')
      }
      await tx.execute(sql`UPDATE essais_empreintes SET essai_id = essai_id WHERE empreinte = ${EMPREINTE_A}`)

      expect((await tx.execute(sql`SELECT * FROM essais_empreintes`)).rows).toEqual(avant)
    })
  })

  it('should keep the fingerprints when the account is deleted (essais.user_id -> NULL goes through, the fingerprint triggers stay silent) and still let new fingerprints in', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))

      await tx.execute(sql`DELETE FROM users WHERE id = 'u-1'`)
      await tx.execute(insererEmpreinte(EMPREINTE_B, 'telephone', 'essai-1'))

      expect((await tx.execute<{ essai_id: string }>(sql`SELECT essai_id FROM essais_empreintes ORDER BY nature`)).rows)
        .toEqual([{ essai_id: 'essai-1' }, { essai_id: 'essai-1' }])
      expect((await tx.execute<{ user_id: string | null }>(sql`SELECT user_id FROM essais WHERE id = 'essai-1'`)).rows[0]?.user_id).toBeNull()
    })
  })

  it('should refuse a fingerprint of an unknown essai (FK) and keep the RESTRICT action', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const erreur = await refus(tx, insererEmpreinte(EMPREINTE_A, 'email', 'essai-inconnu'))

      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: FK_VIOLATION, contrainte: 'essais_empreintes_essai_id_essais_id_fk' })
    })
  })
})

describe('migration 0036 : outbox (CA-E1-31, types acceptés)', () => {
  it('should hold in emails_transactionnels_type_check EXACTLY the types of the code (TRANSACTIONAL_EMAIL_TYPES), the two new ones included', async () => {
    const definition = await definitionContrainte(db, 'emails_transactionnels', 'emails_transactionnels_type_check')

    expect(litteraux(definition).sort()).toEqual([...TRANSACTIONAL_EMAIL_TYPES].sort())
    expect(TRANSACTIONAL_EMAIL_TYPES).toHaveLength(19)
    expect(litteraux(definition)).toEqual(expect.arrayContaining([...TYPES_OUTBOX_ESSAI]))
  })

  it('should hold in emails_transactionnels_occurrence_requise_check the four older types and the two new ones', async () => {
    const definition = await definitionContrainte(db, 'emails_transactionnels', 'emails_transactionnels_occurrence_requise_check')

    expect(litteraux(definition).sort()).toEqual([...TYPES_A_OCCURRENCE].sort())
  })

  it('should bind the category `relationnel` to the summary and the two essai e-mails, and only to them (emails_transactionnels_categorie_type_check)', async () => {
    const definition = await definitionContrainte(db, 'emails_transactionnels', 'emails_transactionnels_categorie_type_check')

    expect(litteraux(definition).filter((valeur) => valeur !== 'relationnel').sort())
      .toEqual(['abonnement_essai_services', 'abonnement_essai_statistiques', 'utilisateur_resume_hebdo'])
    await dansTransactionAnnulee(async (tx) => {
      for (const type of ['utilisateur_resume_hebdo', ...TYPES_OUTBOX_ESSAI]) {
        await tx.execute(insererEmail(`rel-${type}`, type, '2026-12-07', 'relationnel'))
        const transactionnel = await refus(tx, insererEmail(`trans-${type}`, type, '2026-12-14', 'transactionnel'))
        expect(erreurPostgres(transactionnel.brute), type).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_categorie_type_check' })
      }
      for (const type of ['abonnement_rappel', 'paiement_confirme', 'reservation_visiteur_recue']) {
        const relationnel = await refus(tx, insererEmail(`rel-refuse-${type}`, type, '2026-12-07', 'relationnel'))
        expect(erreurPostgres(relationnel.brute), type).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_categorie_type_check' })
      }
    })
  })

  it('should keep the weekly cap index on relationnel rows (entite_id, created_at) that now also holds the essai e-mails', async () => {
    const index = await db.execute<{ definition: string }>(sql`
      SELECT indexdef AS definition FROM pg_indexes WHERE indexname = 'emails_transactionnels_relationnel_idx'`)

    expect(index.rows[0]?.definition).toMatch(/\(entite_id, created_at\) WHERE \(categorie = 'relationnel'::text\)/)
  })

  it('should accept the two essai e-mails (entity `abonnement`, category `relationnel`, occurrence `ESSAI:<fin ISO>` within the 32 characters)', async () => {
    expect(OCCURRENCE_ESSAI).toHaveLength(30)
    expect(ESSAI_EMAIL_ENTITE_TYPE).toBe('abonnement')
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEmail('mail-1', 'abonnement_essai_services', OCCURRENCE_ESSAI))
      await tx.execute(insererEmail('mail-2', 'abonnement_essai_statistiques', OCCURRENCE_ESSAI))

      const rows = await tx.execute<{ type: string, occurrence: string, categorie: string, statut: string }>(
        sql`SELECT type, occurrence, categorie, statut FROM emails_transactionnels ORDER BY type`)
      expect(rows.rows).toEqual([
        { type: 'abonnement_essai_services', occurrence: OCCURRENCE_ESSAI, categorie: 'relationnel', statut: 'en_attente' },
        { type: 'abonnement_essai_statistiques', occurrence: OCCURRENCE_ESSAI, categorie: 'relationnel', statut: 'en_attente' },
      ])
    })
  })

  it('should deduplicate a re-scheduling (unique entity + type + occurrence) but allow a new occurrence', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const ligne = (id: string, occurrence: string) => sql`INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie)
        VALUES (${id}, 'abonnement_essai_services', 'abonnement', 'abo-1', ${occurrence}, 'relationnel') ON CONFLICT DO NOTHING RETURNING id`

      const premier = await tx.execute(ligne('m1', OCCURRENCE_ESSAI))
      const rejeu = await tx.execute(ligne('m2', OCCURRENCE_ESSAI))
      const autre = await tx.execute(ligne('m3', `${ESSAI_OCCURRENCE_PREFIXE}2026-12-21T09:00:00.000Z`))

      expect([premier.rows.length, rejeu.rows.length, autre.rows.length]).toEqual([1, 0, 1])
    })
  })

  it('should REQUIRE an occurrence for both new types (a replannable e-mail without key would not be idempotent)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      for (const type of TYPES_OUTBOX_ESSAI) {
        const erreur = await refus(tx, insererEmail('mail-sans-occurrence', type, ''))
        expect(erreurPostgres(erreur.brute), type).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_occurrence_requise_check' })
      }
    })
  })

  it('should refuse an unknown type, a type with the wrong entity, and an occurrence out of format or too long', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const inconnu = await refus(tx, insererEmail('m-inconnu', 'abonnement_essai_autre', OCCURRENCE_ESSAI))
      const entite = await refus(tx, sql`INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie)
        VALUES ('m-entite', 'abonnement_essai_services', 'utilisateur', 'u-1', ${OCCURRENCE_ESSAI}, 'relationnel')`)
      const minuscules = await refus(tx, insererEmail('m-format', 'abonnement_essai_services', 'essai:2026-12-07'))
      const longue = await refus(tx, insererEmail('m-long', 'abonnement_essai_services', `${ESSAI_OCCURRENCE_PREFIXE}${'1'.repeat(27)}`))
      const transactionnel = await refus(tx, insererEmail('m-trans', 'abonnement_essai_services', OCCURRENCE_ESSAI, 'transactionnel'))

      expect(erreurPostgres(inconnu.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_type_check' })
      expect(erreurPostgres(entite.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_entite_coherence_check' })
      expect(erreurPostgres(minuscules.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_occurrence_check' })
      expect(erreurPostgres(longue.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_occurrence_check' })
      expect(erreurPostgres(transactionnel.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'emails_transactionnels_categorie_type_check' })
    })
  })

  it('should still accept every one of the 17 older types (full list copied, nothing dropped by the new CHECK)', async () => {
    expect(TYPES_OUTBOX_ANCIENS).toHaveLength(17)
    await dansTransactionAnnulee(async (tx) => {
      for (const [i, type] of TYPES_OUTBOX_ANCIENS.entries()) {
        await tx.execute(insererEmail(`ancien-${i}`, type, TYPES_A_OCCURRENCE.includes(type) ? '2026-12-07' : ''))
      }

      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM emails_transactionnels`)).rows[0]?.n).toBe(17)
    })
  })
})

describe('migration 0036 : rejeu, retour arrière documenté, remontée', () => {
  it('should replay twice without error and leave the structure and the seed exactly as they were', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const structureAvant = await structure(tx)
      const versionsAvant = await versionsEssai(tx)

      await executer(tx, instructionsUp())
      await executer(tx, instructionsUp())

      expect(await structure(tx)).toEqual(structureAvant)
      expect(await versionsEssai(tx)).toEqual(versionsAvant)
    })
  })

  it('should replay without touching the data of an essai nor what the administration did (v1 replaced by an administration v2, essai and fingerprints kept)', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))
      await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE id = ${ID_SEED}`)
      await tx.execute(insererVersion('a9000000-essai-inscription-2', 'essai', 'inscription', 2, 'active'))
      const avant = await versionsEssai(tx)

      await executer(tx, instructionsUp())

      expect(await versionsEssai(tx)).toEqual(avant)
      expect(avant.map((r) => `${r.id}:${r.statut}`)).toEqual([`${ID_SEED}:remplacee`, 'a9000000-essai-inscription-2:active'])
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais`)).rows[0]?.n).toBe(1)
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais_empreintes`)).rows[0]?.n).toBe(1)
    })
  })

  it('should also replay on a database where the CHECK constraints are missing (partial earlier run) and where an essai e-mail already sits in the outbox', async () => {
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEmail('mail-1', 'abonnement_essai_services', OCCURRENCE_ESSAI))
      await tx.execute(sql`ALTER TABLE abonnements DROP CONSTRAINT abonnements_origine_check`)
      await tx.execute(sql`ALTER TABLE emails_transactionnels DROP CONSTRAINT emails_transactionnels_type_check`)
      const attendu = await structure(tx)

      await executer(tx, instructionsUp())

      const apres = await structure(tx)
      expect(apres.contraintes.map((c) => c.nom)).toEqual(expect.arrayContaining(['abonnements_origine_check', 'emails_transactionnels_type_check']))
      expect(apres.contraintes.length).toBe(attendu.contraintes.length + 2)
      expect(apres.contraintes.filter((c) => !c.validee)).toEqual([])
    })
  })

  it('should roll back (documented block, executed as is): tables, trigger, function and seed gone, old CHECK lists restored, journal row removed; then come back up identical', async () => {
    await dansTransactionAnnulee(async (tx) => {
      const structureOrigine = await structure(tx)
      const versionsOrigine = await versionsEssai(tx)
      await tx.execute(insererEmail('mail-essai', 'abonnement_essai_services', OCCURRENCE_ESSAI))
      await tx.execute(insererEmail('mail-rappel', 'abonnement_rappel', '2026-12-07'))

      await executer(tx, instructionsRollback())

      expect(await existe(tx, 'essais')).toBe(false)
      expect(await existe(tx, 'essais_empreintes')).toBe(false)
      expect((await structure(tx)).fonction).toEqual([])
      expect((await structure(tx)).declencheurs.filter((d) => d.nom === 'essais_proteger' || d.nom === 'essais_empreintes_proteger')).toEqual([])
      expect(await versionsEssai(tx)).toEqual([])
      expect((await tx.execute<{ etat: string }>(sql`SELECT tgenabled::text AS etat FROM pg_trigger WHERE tgname = 'configuration_versions_proteger'`)).rows[0]?.etat).toBe('O')
      expect((await tx.execute<{ id: string }>(sql`SELECT id FROM emails_transactionnels ORDER BY id`)).rows.map((r) => r.id)).toEqual(['mail-rappel'])
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0036}`)).rows[0]?.n).toBe(0)
      expect(litteraux(await definitionContrainte(tx, 'emails_transactionnels', 'emails_transactionnels_type_check')).sort())
        .toEqual([...TYPES_OUTBOX_ANCIENS].sort())
      expect(litteraux(await definitionContrainte(tx, 'emails_transactionnels', 'emails_transactionnels_occurrence_requise_check')).sort())
        .toEqual(TYPES_A_OCCURRENCE.filter((t) => !(TYPES_OUTBOX_ESSAI as readonly string[]).includes(t)).sort())
      expect(litteraux(await definitionContrainte(tx, 'emails_transactionnels', 'emails_transactionnels_categorie_type_check')).filter((v) => v !== 'relationnel'))
        .toEqual(['utilisateur_resume_hebdo'])
      expect(litteraux(await definitionContrainte(tx, 'abonnements', 'abonnements_origine_check')).sort()).toEqual(['admin', 'offert', 'paiement'])
      expect(litteraux(await definitionContrainte(tx, 'configuration_versions', 'configuration_versions_categorie_check')).sort())
        .toEqual(['frais', 'moyens', 'plan', 'prix'])
      expect((await definitionContrainte(tx, 'configuration_versions', 'configuration_versions_essai_cle_check'))).toBe('')

      // L'état d'avant 0036 refuse bien ce que 0036 permet.
      await creerUtilisateur(tx, 'u-1')
      const origine = await refus(tx, insererAbonnement('abo-1', 'u-1', 'essai'))
      const type = await refus(tx, insererEmail('mail-2', 'abonnement_essai_statistiques', OCCURRENCE_ESSAI))
      const categorie = await refus(tx, insererVersion('e1000000-essai-inscription-2', 'essai', 'inscription', 2))
      expect(erreurPostgres(origine.brute).contrainte).toBe('abonnements_origine_check')
      // Les deux CHECK refusent le type ; PostgreSQL les évalue par ordre alphabétique, `categorie_type` répond le premier.
      expect(['emails_transactionnels_categorie_type_check', 'emails_transactionnels_type_check']).toContain(erreurPostgres(type.brute).contrainte)
      expect(erreurPostgres(categorie.brute).contrainte).toBe('configuration_versions_categorie_check')

      await executer(tx, instructionsUp())

      const structureRemontee = await structure(tx)
      expect(structureRemontee.contraintes).toEqual(structureOrigine.contraintes)
      expect(structureRemontee.index).toEqual(structureOrigine.index)
      expect(structureRemontee.declencheurs).toEqual(structureOrigine.declencheurs)
      expect(structureRemontee.fonction).toEqual(structureOrigine.fonction)
      expect(await versionsEssai(tx)).toEqual(versionsOrigine)
      // Et le déclencheur fonctionne de nouveau.
      await tx.execute(insererEssai('essai-remonte', null))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-remonte'))
      expect(erreurPostgres((await refus(tx, sql`DELETE FROM essais WHERE id = 'essai-remonte'`)).brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres((await refus(tx, sql`DELETE FROM essais_empreintes WHERE empreinte = ${EMPREINTE_A}`)).brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
      expect(erreurPostgres((await refus(tx, sql`UPDATE essais_empreintes SET essai_id = 'essai-remonte' || 'x' WHERE empreinte = ${EMPREINTE_A}`)).brute).sqlstate)
        .toBe(INSUFFICIENT_PRIVILEGE)
    })
  })

  it('should REFUSE its rollback (P0001, data kept) when an essai, a fingerprint, an essai subscription or an administration version exists', async () => {
    const garde = instructionsRollback().find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(sql.raw(garde)) // état d'origine (tables vides, v1 seule) : le garde-fou laisse passer
    })
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererEssai('essai-1', null))

      const erreur = await refus(tx, garde)

      expect(erreurPostgres(erreur.brute).sqlstate).toBe(RAISE_EXCEPTION)
      expect(messageSql(erreur)).toContain('rollback 0036 refuse')
      expect((await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais`)).rows[0]?.n).toBe(1)
    })
    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererAbonnement('abo-1', 'u-1', 'essai'))

      expect(erreurPostgres((await refus(tx, garde)).brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
    await dansTransactionAnnulee(async (tx) => {
      await tx.execute(insererVersion('a9000000-essai-inscription-2', 'essai', 'inscription', 2))

      expect(erreurPostgres((await refus(tx, garde)).brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
  })

  it('should REFUSE its rollback for an essai detached by a deleted account (the row and its fingerprint are the anti-abuse history)', async () => {
    const garde = instructionsRollback().find((i) => i.startsWith('DO $$'))!

    await dansTransactionAnnulee(async (tx) => {
      await creerUtilisateur(tx, 'u-1')
      await tx.execute(insererEssai('essai-1', 'u-1'))
      await tx.execute(insererEmpreinte(EMPREINTE_A, 'email', 'essai-1'))
      await tx.execute(sql`DELETE FROM users WHERE id = 'u-1'`)

      expect(erreurPostgres((await refus(tx, garde)).brute).sqlstate).toBe(RAISE_EXCEPTION)
    })
  })

  it('should leave the common database as migrated (tables, seed, trigger enabled, journal row): nothing committed by the tests above', async () => {
    const etat = await structure(db)

    expect(await existe(db, 'essais')).toBe(true)
    expect(await existe(db, 'essais_empreintes')).toBe(true)
    expect((await versionsEssai(db)).map((r) => `${r.id}:${r.statut}`)).toEqual([`${ID_SEED}:active`])
    expect(etat.declencheurs.filter((d) => d.nom === 'essais_proteger' || d.nom === 'essais_empreintes_proteger').map((d) => d.etat)).toEqual(['O', 'O'])
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais_empreintes`)).rows[0]?.n).toBe(0)
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM essais`)).rows[0]?.n).toBe(0)
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0036}`)).rows[0]?.n).toBe(1)
  })
})
