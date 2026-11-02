import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GENERATION_STATUTS, IA_ERREUR_CODES, IA_FOURNISSEURS_APPELES, IA_TYPES, MOTIFS_REPLI } from '../../shared/ia'
import { schemaPromptParametres, SCHEMA_SORTIE_PROPOSITION, SCHEMA_SORTIE_TEXTE } from '../../shared/schemas/ia'
import { TITRES } from '../../shared/vitrine'
import { PG_RESTRICT_VIOLATION } from '../../server/utils/pg-error'

// S8 §2 / CA01 à CA04 : la migration 0018 crée `prompts_ia`, `generations_ia` et `progressions_inscription`,
// insère les prompts v1 (seule source, aussi en production), et documente son ROLLBACK.
// Ce fichier tourne dans un schéma jetable (base de test) : la base partagée et son journal ne sont jamais touchés.
// ÉCART ASSUMÉ vs CA04 : supprimer un prompt référencé lève 23001 (restrict_violation, ON DELETE RESTRICT)
// et non 23503 (foreign_key_violation, réservé à NO ACTION). Les deux interdisent la suppression.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0018_test'
const BREAKPOINT = '--> statement-breakpoint'
const PROMPT_ONBOARDING = '7c1f0d3e-5a8b-4c2d-9e10-0a1b2c3d4e01'
const PROMPT_AMELIORER = '7c1f0d3e-5a8b-4c2d-9e10-0a1b2c3d4e02'
const EMPREINTE_OK = 'a'.repeat(64)
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

let client: Client

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0018(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0018_'))
  if (files.length !== 1) {
    throw new Error(`Une seule migration 0018 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
  }
  return files[0]!
}

function lireMigration(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replaceAll('"public".', '')
}

async function apply(file: string): Promise<void> {
  for (const statement of lireMigration(file).split(BREAKPOINT)) {
    if (statement.trim() !== '') await client.query(statement)
  }
}

/** Lignes du bloc ROLLBACK (commentaires `-- ...` en fin de fichier), hors ligne de journal drizzle. */
function lignesRollback(): { executables: string[], ligneJournal: string | undefined } {
  const contenu = readFileSync(path.join(MIGRATIONS_DIR, migration0018()), 'utf8')
  const debut = contenu.indexOf('-- ROLLBACK')
  const bloc = contenu.slice(debut).split('\n')
  const instructions = bloc
    .filter((ligne) => /^-- (BEGIN|DROP|DELETE|COMMIT)\b/.test(ligne))
    .map((ligne) => ligne.replace(/^-- /, ''))
  return {
    executables: instructions.filter((ligne) => !ligne.startsWith('DELETE FROM drizzle.')),
    ligneJournal: instructions.find((ligne) => ligne.startsWith('DELETE FROM drizzle.')),
  }
}

async function prepareAt0017(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0018')) {
    for (const statement of lireMigration(file).split(BREAKPOINT)) {
      if (statement.trim() !== '') await client.query(statement)
    }
  }
}

/** Revient à l'état « base en 0017 » sans rejouer 18 migrations : tables S8 supprimées, données de base recréées. */
async function resetAt0017(): Promise<void> {
  // Toujours qualifié par le schéma jetable : un nom nu résoudrait vers `public` (la vraie base de test) quand
  // les tables n'existent pas dans le schéma jetable, et les supprimerait.
  await client.query(`DROP TABLE IF EXISTS ${SCHEMA}.progressions_inscription, ${SCHEMA}.generations_ia, ${SCHEMA}.prompts_ia CASCADE`)
  await client.query('DELETE FROM users')
  await client.query(`INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test'), ('u-b', 'B', 'b@exemple.test')`)
  await client.query(`INSERT INTO medias (id, user_id, chemin, mime, taille, largeur, hauteur)
    VALUES ('m-a', 'u-a', 'u-a/m-a', 'image/webp', 100, 10, 10), ('m-b', 'u-a', 'u-a/m-b', 'image/webp', 100, 10, 10)`)
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await prepareAt0017()
})

beforeEach(resetAt0017)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

type Valeurs = Record<string, unknown>

async function inserer(table: string, valeurs: Valeurs): Promise<void> {
  const colonnes = Object.keys(valeurs)
  const marqueurs = colonnes.map((_, index) => `$${index + 1}`)
  const parametres = colonnes.map((colonne) => {
    const valeur = valeurs[colonne]
    return valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur) ? JSON.stringify(valeur) : valeur
  })
  await client.query(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${marqueurs.join(', ')})`, parametres)
}

let compteur = 0
function id(): string {
  compteur += 1
  return `id-${compteur}-${randomUUID().slice(0, 8)}`
}

const generation = (valeurs: Valeurs = {}) => inserer('generations_ia', {
  id: id(), user_id: 'u-a', type: 'onboarding_vitrine', statut: 'en_attente', entree_empreinte: EMPREINTE_OK, ...valeurs,
})
const progression = (userId: string, valeurs: Valeurs = {}) => inserer('progressions_inscription', { user_id: userId, ...valeurs })
const prompt = (valeurs: Valeurs = {}) => inserer('prompts_ia', {
  id: id(), type: 'onboarding_vitrine', version: 2, systeme: 'Système', gabarit: 'Gabarit {{donnees}}', schema_sortie: 'proposition_onboarding_v1', ...valeurs,
})

async function compter(table: string, where = 'TRUE'): Promise<number> {
  const resultat = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`)
  return resultat.rows[0]!.n
}

describe('migration 0018 : fichier et journal', () => {
  it('est l’unique migration 0018, sans trou dans la numérotation', () => {
    const numeros = migrationFiles().map((file) => Number(file.slice(0, 4)))

    expect(migrationFiles().filter((file) => file.startsWith('0018_'))).toHaveLength(1)
    expect(migration0018()).toMatch(/^0018_.*\.sql$/)
    expect(numeros).toEqual(numeros.map((_, index) => index))
  })

  it('est enregistrée à l’index 18 du journal drizzle, et le ROLLBACK retire cette même entrée', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number, tag: string, when: number }>
    }
    const entree = journal.entries.find((candidate) => candidate.idx === 18)

    expect(entree?.tag).toBe(migration0018().replace(/\.sql$/, ''))
    const { ligneJournal } = lignesRollback()
    expect(ligneJournal).toBeDefined()
    expect(ligneJournal).toContain(String(entree?.when))
  })

  it('s’applique en une seule passe sur une base en 0017 et reste dans les transactions de drizzle (aucun CONCURRENTLY)', async () => {
    expect(lireMigration(migration0018())).not.toMatch(/CONCURRENTLY/i)

    await expect(apply(migration0018())).resolves.toBeUndefined()
  })
})

describe('migration 0018 : tables, colonnes et clés étrangères (CA01, CA04)', () => {
  it('crée les trois tables avec des colonnes typées (dates en timestamptz, pas de JSON interrogeable)', async () => {
    await apply(migration0018())

    const colonnes = await client.query<{ table_name: string, column_name: string, data_type: string, is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name IN ('prompts_ia','generations_ia','progressions_inscription')
       ORDER BY table_name, ordinal_position`,
      [SCHEMA],
    )
    const parTable = (table: string) => colonnes.rows.filter((c) => c.table_name === table)

    expect(parTable('prompts_ia').map((c) => c.column_name)).toEqual([
      'id', 'type', 'version', 'systeme', 'gabarit', 'variables', 'parametres', 'schema_sortie', 'actif', 'created_at',
    ])
    expect(parTable('generations_ia').map((c) => c.column_name)).toEqual([
      'id', 'user_id', 'type', 'statut', 'motif_repli', 'prompt_id', 'fournisseur', 'modele', 'tentatives', 'tokens_entree',
      'tokens_sortie', 'duree_ms', 'erreur_code', 'injection_suspectee', 'entree_empreinte', 'entree', 'sortie',
      'demarree_le', 'terminee_le', 'created_at',
    ])
    expect(parTable('progressions_inscription').map((c) => c.column_name)).toEqual([
      'user_id', 'titre', 'prenom', 'nom', 'metier', 'ville', 'pays', 'photo_media_id', 'generation_id', 'accroche',
      'presentation', 'services_proposes', 'proposition_validee_le', 'termine_le', 'created_at', 'updated_at',
    ])
    for (const colonne of colonnes.rows.filter((c) => /_le$|created_at|updated_at/.test(c.column_name))) {
      expect(colonne.data_type, `${colonne.table_name}.${colonne.column_name}`).toBe('timestamp with time zone')
    }
    const jsonb = colonnes.rows.filter((c) => c.data_type === 'jsonb').map((c) => `${c.table_name}.${c.column_name}`)
    expect(jsonb.sort()).toEqual([
      'generations_ia.entree', 'generations_ia.sortie', 'progressions_inscription.services_proposes', 'prompts_ia.parametres',
    ])
  })

  it('applique les défauts : en attente, aucune tentative, aucune injection, prompt inactif', async () => {
    await apply(migration0018())
    await generation({ id: 'g-defaut' })
    await prompt({ id: 'p-defaut' })

    const g = await client.query(`SELECT statut, tentatives, injection_suspectee, created_at FROM generations_ia WHERE id = 'g-defaut'`)
    const p = await client.query(`SELECT actif, variables, parametres FROM prompts_ia WHERE id = 'p-defaut'`)

    expect(g.rows[0]).toMatchObject({ statut: 'en_attente', tentatives: 0, injection_suspectee: false, created_at: expect.any(Date) })
    expect(p.rows[0]).toEqual({ actif: false, variables: [], parametres: {} })
  })

  it('déclare les règles de suppression : cascade depuis users, restrict vers le prompt, set null vers médias et générations', async () => {
    await apply(migration0018())

    const fk = await client.query<{ table: string, colonne: string, regle: string }>(
      `SELECT t.relname AS table, a.attname AS colonne, c.confdeltype AS regle
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE n.nspname = $1 AND c.contype = 'f' AND t.relname IN ('generations_ia','progressions_inscription')`,
      [SCHEMA],
    )
    const regle = (table: string, colonne: string) => fk.rows.find((r) => r.table === table && r.colonne === colonne)?.regle

    expect(regle('generations_ia', 'user_id')).toBe('c')
    expect(regle('generations_ia', 'prompt_id')).toBe('r')
    expect(regle('progressions_inscription', 'user_id')).toBe('c')
    expect(regle('progressions_inscription', 'photo_media_id')).toBe('n')
    expect(regle('progressions_inscription', 'generation_id')).toBe('n')
  })

  it('crée les index de lecture et les index partiels', async () => {
    await apply(migration0018())

    const indexes = await client.query<{ indexname: string, indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1
       AND tablename IN ('prompts_ia','generations_ia','progressions_inscription')`,
      [SCHEMA],
    )
    const def = (nom: string) => indexes.rows.find((i) => i.indexname === nom)?.indexdef

    expect(def('generations_ia_user_created_idx')).toMatch(/\(user_id, created_at DESC\)/)
    expect(def('generations_ia_dedoublonnage_idx')).toMatch(/\(user_id, type, entree_empreinte\)/)
    expect(def('generations_ia_actives_idx')).toMatch(/WHERE .*statut.*(IN|ANY).*en_attente.*en_cours/)
    expect(def('generations_ia_a_purger_idx')).toMatch(/WHERE .*entree IS NOT NULL.*OR.*sortie IS NOT NULL/)
    expect(def('progressions_inscription_photo_media_id_idx')).toMatch(/\(photo_media_id\)/)
    expect(def('progressions_inscription_generation_id_idx')).toMatch(/\(generation_id\)/)
    expect(def('prompts_ia_type_version_unique')).toMatch(/UNIQUE INDEX.*\(type, version\)/)
    expect(def('prompts_ia_type_actif_unique')).toMatch(/UNIQUE INDEX.*\(type\) WHERE/)
  })
})

describe('migration 0018 : prompts v1 (CA01)', () => {
  it('insère exactement une version 1 active par type, avec les réglages valides et la variable unique {{donnees}}', async () => {
    await apply(migration0018())

    const lignes = await client.query<{
      id: string, type: string, version: number, systeme: string, gabarit: string, variables: string[],
      parametres: unknown, schema_sortie: string, actif: boolean
    }>('SELECT * FROM prompts_ia ORDER BY type')

    expect(lignes.rows.map((l) => [l.type, l.version, l.actif])).toEqual([
      ['ameliorer_texte', 1, true],
      ['onboarding_vitrine', 1, true],
    ])
    expect(lignes.rows.map((l) => l.type).sort()).toEqual([...IA_TYPES].sort())
    for (const ligne of lignes.rows) {
      expect(ligne.variables).toEqual(['donnees'])
      expect(schemaPromptParametres.safeParse(ligne.parametres).success, ligne.type).toBe(true)
      expect(ligne.gabarit).toContain('{{donnees}}')
      expect(ligne.gabarit.match(/\{\{\w+\}\}/g)).toEqual(['{{donnees}}'])
      expect(ligne.systeme.length).toBeGreaterThan(200)
    }
    const parType = Object.fromEntries(lignes.rows.map((l) => [l.type, l]))
    expect(parType.onboarding_vitrine).toMatchObject({ id: PROMPT_ONBOARDING, schema_sortie: SCHEMA_SORTIE_PROPOSITION, parametres: { temperature: 0.7, maxTokens: 1500 } })
    expect(parType.ameliorer_texte).toMatchObject({ id: PROMPT_AMELIORER, schema_sortie: SCHEMA_SORTIE_TEXTE, parametres: { temperature: 0.4, maxTokens: 900 } })
  })

  it('donne à chaque prompt la consigne anti-injection et le nom de l’outil attendu par le code', async () => {
    await apply(migration0018())

    const { rows } = await client.query<{ type: string, systeme: string, gabarit: string }>('SELECT type, systeme, gabarit FROM prompts_ia')
    const parType = Object.fromEntries(rows.map((l) => [l.type, l]))

    expect(parType.onboarding_vitrine!.systeme).toContain('proposer_vitrine')
    expect(parType.ameliorer_texte!.systeme).toContain('proposer_texte')
    for (const ligne of rows) {
      expect(ligne.systeme).toContain('<donnees>')
      expect(ligne.systeme).toMatch(/DONNÉE/)
      expect(ligne.systeme).toMatch(/jamais une instruction/)
      expect(ligne.gabarit).toMatch(/<donnees>\s*\{\{donnees\}\}\s*<\/donnees>/)
    }
  })

  it('ne contient ni secret ni donnée personnelle dans les textes insérés', async () => {
    await apply(migration0018())

    const { rows } = await client.query<{ systeme: string, gabarit: string }>('SELECT systeme, gabarit FROM prompts_ia')
    const texte = rows.map((l) => `${l.systeme}\n${l.gabarit}`).join('\n')

    expect(texte).not.toMatch(/sk-[A-Za-z0-9_-]{10,}|api[_-]?key|password|mot de passe/i)
    expect(texte).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(texte).not.toMatch(/Cabrel|Nguesso/)
  })

  it('rejoue l’INSERT sans rien changer ni dupliquer (ON CONFLICT DO NOTHING)', async () => {
    await apply(migration0018())
    await client.query(`UPDATE prompts_ia SET systeme = 'Texte corrigé à la main' WHERE id = '${PROMPT_ONBOARDING}'`)
    const dernierBloc = lireMigration(migration0018()).split(BREAKPOINT).at(-1)!

    await client.query(dernierBloc)

    expect(await compter('prompts_ia')).toBe(2)
    expect(await compter('prompts_ia', `actif AND version = 1`)).toBe(2)
    const apres = await client.query<{ systeme: string }>(`SELECT systeme FROM prompts_ia WHERE id = '${PROMPT_ONBOARDING}'`)
    expect(apres.rows[0]!.systeme).toBe('Texte corrigé à la main')
  })

  it('refuse d’être appliquée deux fois en bloc (tables déjà créées) : le rejeu passe par le ROLLBACK', async () => {
    await apply(migration0018())

    await expect(apply(migration0018())).rejects.toMatchObject({ code: '42P07' })
  })
})

describe('migration 0018 : ROLLBACK puis nouvelle application (CA01)', () => {
  it('supprime les trois tables, puis se réapplique à l’identique avec les prompts v1', async () => {
    await apply(migration0018())
    await generation({ id: 'g-avant' })
    const { executables } = lignesRollback()
    expect(executables[0]).toMatch(/^BEGIN/)
    expect(executables.at(-1)).toMatch(/^COMMIT/)
    expect(executables.filter((ligne) => ligne.startsWith('DROP TABLE'))).toHaveLength(3)

    for (const instruction of executables) await client.query(instruction)

    const apresRollback = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('prompts_ia','generations_ia','progressions_inscription')`,
      [SCHEMA],
    )
    expect(apresRollback.rowCount).toBe(0)

    await apply(migration0018())

    expect(await compter('prompts_ia', 'actif')).toBe(2)
    expect(await compter('generations_ia')).toBe(0)
    await expect(generation()).resolves.toBeUndefined()
  })

  it('supprime d’abord les tables qui référencent les autres (ordre inverse des dépendances)', () => {
    const drops = lignesRollback().executables.filter((ligne) => ligne.startsWith('DROP TABLE'))

    expect(drops.map((ligne) => ligne.match(/"(\w+)"/)![1])).toEqual(['progressions_inscription', 'generations_ia', 'prompts_ia'])
  })
})

describe('migration 0018 : CHECK des générations (CA02)', () => {
  it.each([
    ['un statut inconnu « fini »', { statut: 'fini' }],
    ['un type inconnu', { type: 'poeme' }],
    ['un repli sans motif', { statut: 'repli', terminee_le: new Date() }],
    ['une génération terminée avec un motif de repli', { statut: 'terminee', motif_repli: 'injection', terminee_le: new Date() }],
    ['une génération en attente avec un motif de repli', { motif_repli: 'injection' }],
    ['un motif de repli inconnu', { statut: 'repli', motif_repli: 'je_ne_sais_pas', terminee_le: new Date() }],
    ['une génération terminée sans date de fin', { statut: 'terminee' }],
    ['un repli sans date de fin', { statut: 'repli', motif_repli: 'injection' }],
    ['une génération expirée sans date de fin', { statut: 'expiree' }],
    ['une empreinte « abc »', { entree_empreinte: 'abc' }],
    ['une empreinte de 63 caractères', { entree_empreinte: 'a'.repeat(63) }],
    ['une empreinte de 65 caractères', { entree_empreinte: 'a'.repeat(65) }],
    ['une empreinte en majuscules', { entree_empreinte: 'A'.repeat(64) }],
    ['une empreinte non hexadécimale', { entree_empreinte: 'g'.repeat(64) }],
    ['un fournisseur inconnu', { fournisseur: 'openai' }],
    ['le fournisseur « aucun » (aucun appel : rien à enregistrer)', { fournisseur: 'aucun' }],
    ['un modèle de 101 caractères', { modele: 'm'.repeat(101) }],
    ['11 tentatives', { tentatives: 11 }],
    ['des tentatives négatives', { tentatives: -1 }],
    ['des tokens d’entrée négatifs', { tokens_entree: -1 }],
    ['des tokens de sortie négatifs', { tokens_sortie: -5 }],
    ['une durée négative', { duree_ms: -1 }],
    ['un code d’erreur en majuscules', { erreur_code: 'ERREUR' }],
    ['un code d’erreur qui est un message brut', { erreur_code: 'La connexion a échoué pour jean@exemple.com' }],
    ['un code d’erreur de 41 caractères', { erreur_code: 'a'.repeat(41) }],
    ['un code d’erreur vide', { erreur_code: '' }],
  ])('should reject %s (23514)', async (_nom, valeurs) => {
    await apply(migration0018())

    await expect(generation(valeurs)).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it.each(GENERATION_STATUTS.filter((statut) => statut !== 'repli'))('should accept the status %s with consistent fields', async (statut) => {
    await apply(migration0018())
    const terminal = statut !== 'en_attente' && statut !== 'en_cours'

    await expect(generation({ statut, terminee_le: terminal ? new Date() : null })).resolves.toBeUndefined()
  })

  it.each(MOTIFS_REPLI)('should accept the fallback reason %s (TypeScript list and CHECK stay in sync)', async (motif) => {
    await apply(migration0018())

    await expect(generation({ statut: 'repli', motif_repli: motif, terminee_le: new Date() })).resolves.toBeUndefined()
  })

  it.each(IA_TYPES)('should accept the type %s', async (type) => {
    await apply(migration0018())

    await expect(generation({ type })).resolves.toBeUndefined()
  })

  it.each(IA_FOURNISSEURS_APPELES)('should accept the provider %s', async (fournisseur) => {
    await apply(migration0018())

    await expect(generation({ fournisseur })).resolves.toBeUndefined()
  })

  it.each(IA_ERREUR_CODES)('should accept the error code %s', async (erreurCode) => {
    await apply(migration0018())

    await expect(generation({ erreur_code: erreurCode })).resolves.toBeUndefined()
  })

  it('should accept the boundaries: 10 attempts, 100-character model, 40-character error code, zero tokens and duration', async () => {
    await apply(migration0018())

    await expect(generation({ tentatives: 10, modele: 'm'.repeat(100), erreur_code: 'a'.repeat(40), tokens_entree: 0, tokens_sortie: 0, duree_ms: 0 }))
      .resolves.toBeUndefined()
  })

  it('should reject an unknown user (foreign key)', async () => {
    await apply(migration0018())

    await expect(generation({ user_id: 'inconnu' })).rejects.toMatchObject({ code: '23503' })
  })

  it('should reject a missing fingerprint, type, or user (NOT NULL)', async () => {
    await apply(migration0018())

    await expect(generation({ entree_empreinte: null })).rejects.toMatchObject({ code: '23502' })
    await expect(generation({ type: null })).rejects.toMatchObject({ code: '23502' })
    await expect(generation({ user_id: null })).rejects.toMatchObject({ code: '23502' })
  })
})

describe('migration 0018 : CHECK des progressions (CA02)', () => {
  const accroche = 'Une accroche.'

  it.each([
    ['un pays en minuscules « cm »', { pays: 'cm' }],
    ['un pays de trois lettres', { pays: 'CMR' }],
    ['un titre inconnu', { titre: 'prof' }],
    ['un métier de 81 caractères', { metier: 'm'.repeat(81) }],
    ['une ville de 81 caractères', { ville: 'v'.repeat(81) }],
    ['un prénom de 61 caractères', { prenom: 'p'.repeat(61) }],
    ['un nom de 61 caractères', { nom: 'n'.repeat(61) }],
    ['une accroche de 161 caractères', { accroche: 'a'.repeat(161) }],
    ['une présentation de 2001 caractères', { presentation: 'p'.repeat(2001) }],
    ['4 services proposés', { services_proposes: JSON.stringify([{}, {}, {}, {}]) }],
    ['des services proposés de type objet', { services_proposes: JSON.stringify({ titre: 'x' }) }],
    ['des services proposés de type texte', { services_proposes: JSON.stringify('x') }],
    ['une proposition validée sans accroche', { presentation: 'Texte', services_proposes: '[]', proposition_validee_le: new Date() }],
    ['une proposition validée sans présentation', { accroche, services_proposes: '[]', proposition_validee_le: new Date() }],
    ['une proposition validée sans services', { accroche, presentation: 'Texte', proposition_validee_le: new Date() }],
    ['une proposition validée sans rien', { proposition_validee_le: new Date() }],
  ])('should reject %s (23514)', async (_nom, valeurs) => {
    await apply(migration0018())

    await expect(progression('u-a', valeurs)).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('should accept the boundaries: 60/60/80/80 identity, 160-character accroche, 2000-character presentation, 3 services', async () => {
    await apply(migration0018())

    await expect(progression('u-a', {
      prenom: 'p'.repeat(60), nom: 'n'.repeat(60), metier: 'm'.repeat(80), ville: 'v'.repeat(80),
      accroche: 'a'.repeat(160), presentation: 'p'.repeat(2000), services_proposes: JSON.stringify([{}, {}, {}]),
      proposition_validee_le: new Date(),
    })).resolves.toBeUndefined()
  })

  it.each(TITRES)('should accept the title %s (TypeScript list and CHECK stay in sync)', async (titre) => {
    await apply(migration0018())

    await expect(progression('u-a', { titre })).resolves.toBeUndefined()
  })

  it('should accept an empty progression and a validated one with an empty services list', async () => {
    await apply(migration0018())

    await expect(progression('u-a')).resolves.toBeUndefined()
    await expect(progression('u-b', { accroche, presentation: 'Texte', services_proposes: '[]', proposition_validee_le: new Date() })).resolves.toBeUndefined()
  })

  it('should keep one progression per user (primary key)', async () => {
    await apply(migration0018())
    await progression('u-a')

    await expect(progression('u-a')).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })
})

describe('migration 0018 : CHECK et unicité des prompts (CA02, CA03)', () => {
  it.each([
    ['un type inconnu', { type: 'poeme' }],
    ['une version 0', { version: 0 }],
    ['une version négative', { version: -1 }],
    ['un texte système vide', { systeme: '' }],
    ['un texte système de 20001 caractères', { systeme: 's'.repeat(20_001) }],
    ['un gabarit vide', { gabarit: '' }],
    ['un gabarit de 5001 caractères', { gabarit: 'g'.repeat(5_001) }],
    ['des réglages qui ne sont pas un objet', { parametres: JSON.stringify([1, 2]) }],
    ['un identifiant de schéma avec majuscules', { schema_sortie: 'Proposition' }],
    ['un identifiant de schéma avec espace', { schema_sortie: 'proposition onboarding' }],
    ['un identifiant de schéma vide', { schema_sortie: '' }],
    ['un identifiant de schéma de 61 caractères', { schema_sortie: 'a'.repeat(61) }],
  ])('should reject %s (23514)', async (_nom, valeurs) => {
    await apply(migration0018())

    await expect(prompt(valeurs)).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('should reject a second active version of the same type with the partial unique index (23505, CA03)', async () => {
    await apply(migration0018())

    const erreur = await prompt({ type: 'onboarding_vitrine', version: 2, actif: true }).catch((e: unknown) => e)

    expect(erreur).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'prompts_ia_type_actif_unique' })
  })

  it('should reject the same (type, version) twice (23505, CA03)', async () => {
    await apply(migration0018())

    const erreur = await prompt({ type: 'onboarding_vitrine', version: 1, actif: false }).catch((e: unknown) => e)

    expect(erreur).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'prompts_ia_type_version_unique' })
  })

  it('should accept several inactive versions of a type, and an active version of the other type', async () => {
    await apply(migration0018())

    await expect(prompt({ type: 'onboarding_vitrine', version: 2, actif: false })).resolves.toBeUndefined()
    await expect(prompt({ type: 'onboarding_vitrine', version: 3, actif: false })).resolves.toBeUndefined()
    expect(await compter('prompts_ia', `type = 'onboarding_vitrine'`)).toBe(3)
    expect(await compter('prompts_ia', `type = 'onboarding_vitrine' AND actif`)).toBe(1)
  })

  it('should publish a new version atomically: deactivate the old one, activate the new one, in one transaction', async () => {
    await apply(migration0018())
    await prompt({ id: 'p-v2', type: 'onboarding_vitrine', version: 2, actif: false })

    await client.query('BEGIN')
    await client.query(`UPDATE prompts_ia SET actif = false WHERE id = '${PROMPT_ONBOARDING}'`)
    await client.query(`UPDATE prompts_ia SET actif = true WHERE id = 'p-v2'`)
    await client.query('COMMIT')

    const actives = await client.query<{ id: string }>(`SELECT id FROM prompts_ia WHERE type = 'onboarding_vitrine' AND actif`)
    expect(actives.rows.map((l) => l.id)).toEqual(['p-v2'])
  })

  it('should refuse to activate the new version before deactivating the old one', async () => {
    await apply(migration0018())
    await prompt({ id: 'p-v2', type: 'onboarding_vitrine', version: 2, actif: false })

    await expect(client.query(`UPDATE prompts_ia SET actif = true WHERE id = 'p-v2'`)).rejects.toMatchObject({ code: UNIQUE_VIOLATION })
  })
})

describe('migration 0018 : cascades et références (CA04)', () => {
  it('supprimer A emporte sa progression et ses générations, jamais les prompts ni les données de B', async () => {
    await apply(migration0018())
    await generation({ id: 'g-a', user_id: 'u-a' })
    await generation({ id: 'g-b', user_id: 'u-b' })
    await progression('u-a', { generation_id: 'g-a' })
    await progression('u-b', { generation_id: 'g-b' })

    await client.query(`DELETE FROM users WHERE id = 'u-a'`)

    expect(await compter('progressions_inscription', `user_id = 'u-a'`)).toBe(0)
    expect(await compter('generations_ia', `user_id = 'u-a'`)).toBe(0)
    expect(await compter('progressions_inscription', `user_id = 'u-b'`)).toBe(1)
    expect(await compter('generations_ia', `user_id = 'u-b'`)).toBe(1)
    expect(await compter('prompts_ia')).toBe(2)
  })

  it('supprimer le média de la photo met photo_media_id à NULL sans supprimer la progression', async () => {
    await apply(migration0018())
    await progression('u-a', { photo_media_id: 'm-a' })

    await client.query(`DELETE FROM medias WHERE id = 'm-a'`)

    const ligne = await client.query(`SELECT photo_media_id FROM progressions_inscription WHERE user_id = 'u-a'`)
    expect(ligne.rows[0]).toEqual({ photo_media_id: null })
  })

  it('supprimer la génération met generation_id à NULL sans supprimer la progression', async () => {
    await apply(migration0018())
    await generation({ id: 'g-a' })
    await progression('u-a', { generation_id: 'g-a' })

    await client.query(`DELETE FROM generations_ia WHERE id = 'g-a'`)

    const ligne = await client.query(`SELECT generation_id, prenom FROM progressions_inscription WHERE user_id = 'u-a'`)
    expect(ligne.rows[0]).toEqual({ generation_id: null, prenom: null })
  })

  it('refuse de supprimer un prompt référencé par une génération (restrict : 23001, pas de perte de la trace)', async () => {
    await apply(migration0018())
    await generation({ id: 'g-a', prompt_id: PROMPT_ONBOARDING })

    const erreur = await client.query(`DELETE FROM prompts_ia WHERE id = '${PROMPT_ONBOARDING}'`).catch((e: unknown) => e)

    expect(erreur).toMatchObject({ code: PG_RESTRICT_VIOLATION })
    expect(await compter('prompts_ia', `id = '${PROMPT_ONBOARDING}'`)).toBe(1)
    expect(await compter('generations_ia', `id = 'g-a'`)).toBe(1)
  })

  it('permet de supprimer un prompt que plus aucune génération ne référence', async () => {
    await apply(migration0018())
    await prompt({ id: 'p-libre', version: 7 })

    await client.query(`DELETE FROM prompts_ia WHERE id = 'p-libre'`)

    expect(await compter('prompts_ia')).toBe(2)
  })

  it('refuse une génération qui référence un prompt inconnu, mais accepte une génération sans prompt (repli « sans_prompt »)', async () => {
    await apply(migration0018())

    await expect(generation({ prompt_id: 'inconnu' })).rejects.toMatchObject({ code: '23503' })
    await expect(generation({ prompt_id: null, statut: 'repli', motif_repli: 'sans_prompt', terminee_le: new Date() })).resolves.toBeUndefined()
  })

  it('refuse une progression qui référence le média ou la génération inexistants', async () => {
    await apply(migration0018())

    await expect(progression('u-a', { photo_media_id: 'inconnu' })).rejects.toMatchObject({ code: '23503' })
    await expect(progression('u-b', { generation_id: 'inconnu' })).rejects.toMatchObject({ code: '23503' })
  })
})
