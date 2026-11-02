import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IA_FOURNISSEURS } from '../../shared/ia'

// S8 : la migration 0019 remplace la CHECK d'énumération `generations_ia_fournisseur_check` de 0018
// ('anthropic','faux') par une CHECK de FORMAT (`^[a-z0-9_-]{1,40}$`), sans autre changement : un nouveau
// fournisseur d'IA (openai, gemini…) n'exige plus de migration. 0018 est déjà appliquée sur des bases
// existantes : elle reste intacte.
// Ce fichier tourne dans un schéma jetable (`mig0019_test`) de la base de test : la base partagée et son
// journal drizzle ne sont jamais touchés. Toute instruction destructive est QUALIFIÉE par ce schéma : un nom
// nu résoudrait vers `public` (la vraie base de test) si la table manquait dans le schéma jetable.
// La ligne « DELETE FROM drizzle.__drizzle_migrations » du ROLLBACK n'est jamais exécutée ici (elle viserait
// le vrai journal) : on vérifie seulement qu'elle cible l'entrée idx 19 de meta/_journal.json.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const SCHEMA = 'mig0019_test'
const TABLE = `${SCHEMA}.generations_ia`
const CONTRAINTE = 'generations_ia_fournisseur_check'
const BREAKPOINT = '--> statement-breakpoint'
const EMPREINTE_OK = 'a'.repeat(64)
const CHECK_VIOLATION = '23514'
const FOURNISSEURS_ANCIENS = ['anthropic', 'faux'] as const
const FORMAT_FOURNISSEUR = `^[a-z0-9_-]{1,40}$`
const FOURNISSEURS_ACCEPTES = ['anthropic', 'openai', 'faux', 'gemini', 'groq', 'open-router', 'deepseek_v2', 'a', '0', 'x'.repeat(40)]
const FOURNISSEURS_REFUSES = [
  'Mauvais Nom', '', 'x'.repeat(41), 'OPENAI', 'Anthropic', ' openai', 'openai ', 'open ai', 'openai\n', 'openai!',
  'café', 'a/b', 'a.b', 'https://exemple.test', '<script>', `o'penai`, 'a;b', 'a,b',
]

let client: Client
let definitionApres0018 = ''
let compteur = 0

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

function migration0019(): string {
  const files = migrationFiles().filter((file) => file.startsWith('0019_'))
  if (files.length !== 1) {
    throw new Error(`Une seule migration 0019 est attendue, reçu : ${files.join(', ') || 'aucune'}.`)
  }
  return files[0]!
}

function lireBrut(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
}

function lireMigration(file: string): string {
  return lireBrut(file).replaceAll('"public".', '')
}

async function assertSchemaJetable(): Promise<void> {
  const resultat = await client.query<{ present: string | null }>('SELECT to_regclass($1) AS present', [TABLE])
  if (resultat.rows[0]?.present === null) {
    throw new Error(`${TABLE} introuvable : refus d'exécuter du DDL non qualifié (il viserait le schéma public).`)
  }
}

async function executeFile(file: string): Promise<void> {
  for (const statement of lireMigration(file).split(BREAKPOINT)) {
    if (statement.trim() !== '') await client.query(statement)
  }
}

/** Applique 0019 : refuse de partir si la table n'est pas dans le schéma jetable (DDL non qualifié). */
async function apply(file: string): Promise<void> {
  await assertSchemaJetable()
  await executeFile(file)
}

interface Rollback {
  /** BEGIN, ALTER…, COMMIT, sans la ligne de journal. */
  executables: string[]
  ligneJournal: string | undefined
  /** Traitements préalables documentés (commentaires « a) » et « b) ») si des lignes hors anthropic/faux existent. */
  conserverTraces: string | undefined
  supprimerTraces: string | undefined
}

function rollback(): Rollback {
  const contenu = lireBrut(migration0019())
  const bloc = contenu.slice(contenu.indexOf('-- ROLLBACK'))
  const instructions = bloc
    .split('\n')
    .filter((ligne) => /^-- (BEGIN|ALTER|DELETE|COMMIT)\b/.test(ligne))
    .map((ligne) => ligne.replace(/^-- /, ''))
  return {
    executables: instructions.filter((ligne) => !ligne.startsWith('DELETE FROM drizzle.')),
    ligneJournal: instructions.find((ligne) => ligne.startsWith('DELETE FROM drizzle.')),
    conserverTraces: /(UPDATE "generations_ia" SET "fournisseur" = NULL WHERE "fournisseur" NOT IN \('anthropic','faux'\);)/.exec(bloc)?.[1],
    supprimerTraces: /(DELETE FROM "generations_ia" WHERE "fournisseur" NOT IN \('anthropic','faux'\);)/.exec(bloc)?.[1],
  }
}

async function executerRollback(): Promise<void> {
  await assertSchemaJetable()
  try {
    for (const instruction of rollback().executables) await client.query(instruction)
  } catch (erreur) {
    await client.query('ROLLBACK')
    throw erreur
  }
}

async function definitionContrainte(): Promise<string> {
  const resultat = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = 'generations_ia' AND c.conname = $2`,
    [SCHEMA, CONTRAINTE],
  )
  return resultat.rows[0]!.definition
}

/** Empreinte du reste de la table : colonnes, autres contraintes, index. Doit rester identique avant/après. */
async function structureHorsContrainte(): Promise<unknown> {
  const colonnes = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'generations_ia' ORDER BY ordinal_position`,
    [SCHEMA],
  )
  const contraintes = await client.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = 'generations_ia' AND c.conname <> $2 ORDER BY c.conname`,
    [SCHEMA, CONTRAINTE],
  )
  const index = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'generations_ia' ORDER BY indexname`,
    [SCHEMA],
  )
  return { colonnes: colonnes.rows, contraintes: contraintes.rows, index: index.rows }
}

/** Remet la table à l'état « 0018 seule » : mêmes lignes vidées, ancienne CHECK recréée depuis la vraie 0018. */
async function resetAt0018(): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.query(`DELETE FROM ${TABLE}`)
  await client.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${CONTRAINTE}`)
  await client.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${CONTRAINTE} ${definitionApres0018}`)
}

async function prepareAt0018(): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.query(`CREATE SCHEMA ${SCHEMA}`)
  await client.query(`SET search_path TO ${SCHEMA}, public`)
  for (const file of migrationFiles().filter((name) => name < '0019')) await executeFile(file)
  await client.query(`INSERT INTO users (id, name, email) VALUES ('u-a', 'A', 'a@exemple.test')`)
  definitionApres0018 = await definitionContrainte()
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await prepareAt0018()
})

beforeEach(resetAt0018)

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await client.end()
})

async function generation(fournisseur: string | null, id = `g-${(compteur += 1)}`): Promise<string> {
  await client.query(
    `INSERT INTO ${TABLE} (id, user_id, type, statut, entree_empreinte, fournisseur)
     VALUES ($1, 'u-a', 'onboarding_vitrine', 'en_attente', $2, $3)`,
    [id, EMPREINTE_OK, fournisseur],
  )
  return id
}

async function fournisseurDe(id: string): Promise<string | null> {
  const resultat = await client.query<{ fournisseur: string | null }>(`SELECT fournisseur FROM ${TABLE} WHERE id = $1`, [id])
  return resultat.rows[0]!.fournisseur
}

describe('migration 0019 : fichier, journal et synchronisation avec shared/ia.ts', () => {
  it('est l’unique migration 0019, sans trou dans la numérotation, et laisse 0018 en place', () => {
    const numeros = migrationFiles().map((file) => Number(file.slice(0, 4)))

    expect(migrationFiles().filter((file) => file.startsWith('0019_'))).toHaveLength(1)
    expect(migration0019()).toMatch(/^0019_.*\.sql$/)
    expect(numeros).toEqual(numeros.map((_, index) => index))
    expect(migrationFiles().filter((file) => file.startsWith('0018_'))).toHaveLength(1)
  })

  it('est enregistrée à l’index 19 du journal drizzle, et le ROLLBACK retire cette même entrée', () => {
    const journal = JSON.parse(lireBrut('meta/_journal.json')) as {
      entries: Array<{ idx: number, tag: string, when: number }>
    }
    const entree = journal.entries.find((candidate) => candidate.idx === 19)
    const precedente = journal.entries.find((candidate) => candidate.idx === 18)

    expect(entree?.tag).toBe(migration0019().replace(/\.sql$/, ''))
    expect(entree!.when).toBeGreaterThan(precedente!.when)
    expect(rollback().ligneJournal).toContain(String(entree?.when))
    expect(lireBrut(migration0019())).toContain(`soit ${entree?.when}`)
  })

  it('reste dans la transaction de drizzle (aucun CONCURRENTLY) et ne touche qu’à la CHECK du fournisseur', () => {
    const instructions = lireMigration(migration0019())
      .split('\n')
      .filter((ligne) => !ligne.startsWith('--'))
      .join('\n')
      .split(BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '')

    expect(lireMigration(migration0019())).not.toMatch(/CONCURRENTLY/i)
    expect(instructions).toHaveLength(2)
    expect(instructions[0]).toBe(`ALTER TABLE "generations_ia" DROP CONSTRAINT "${CONTRAINTE}";`)
    expect(instructions[1]).toMatch(new RegExp(`^ALTER TABLE "generations_ia" ADD CONSTRAINT "${CONTRAINTE}" CHECK \\(`))
    expect(instructions.join('\n')).not.toMatch(/\b(CREATE|DROP TABLE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it('porte une CHECK de format sans liste en dur (le SQL et le snapshot disent la même chose)', () => {
    const snapshot = JSON.parse(lireBrut('meta/0019_snapshot.json')) as {
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>
    }
    const valeur = snapshot.tables['public.generations_ia']!.checkConstraints[CONTRAINTE]!.value

    expect(valeur).toContain(`~ '${FORMAT_FOURNISSEUR}'`)
    expect(valeur).not.toMatch(/\bIN\b/)
    const ajout = lireBrut(migration0019()).split('\n').filter((ligne) => ligne.startsWith('ALTER TABLE') && ligne.includes('ADD CONSTRAINT')).join('')
    expect(ajout).toContain(`~ '${FORMAT_FOURNISSEUR}'`)
    expect(ajout).not.toMatch(/\bIN\b/)
  })

  it.each(IA_FOURNISSEURS)('respecte le format pour le nom de fournisseur %s de shared/ia.ts (code et base restent compatibles)', (fournisseur) => {
    expect(fournisseur).toMatch(new RegExp(FORMAT_FOURNISSEUR))
  })

  it('laisse le snapshot 0018 décrire l’ancienne liste (0018 n’a pas été modifiée)', () => {
    const snapshot = JSON.parse(lireBrut('meta/0018_snapshot.json')) as {
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>
    }

    expect(snapshot.tables['public.generations_ia']!.checkConstraints[CONTRAINTE]!.value).toContain(`IN ('anthropic','faux')`)
    expect(lireBrut('0018_s8_onboarding_ia.sql')).toContain(`IN ('anthropic','faux')`)
  })
})

describe('migration 0019 : état avant (0018 seule)', () => {
  it('refuse le fournisseur « openai » (23514)', async () => {
    await expect(generation('openai')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONTRAINTE })
  })

  it.each(FOURNISSEURS_ANCIENS)('accepte le fournisseur %s', async (fournisseur) => {
    await expect(generation(fournisseur)).resolves.toEqual(expect.any(String))
  })

  it('accepte l’absence de fournisseur (NULL)', async () => {
    await expect(generation(null)).resolves.toEqual(expect.any(String))
  })
})

describe('migration 0019 : état après', () => {
  it('s’applique en une passe sur une base en 0018 et remplace la définition de la CHECK', async () => {
    await expect(apply(migration0019())).resolves.toBeUndefined()

    const definition = await definitionContrainte()
    expect(definition).not.toBe(definitionApres0018)
    expect(definition).toContain(FORMAT_FOURNISSEUR)
    expect(definition).not.toContain('anthropic')
  })

  it('accepte « openai » désormais (une génération faite par l’adaptateur compatible OpenAI s’enregistre)', async () => {
    await apply(migration0019())

    const id = await generation('openai')

    expect(await fournisseurDe(id)).toBe('openai')
  })

  it.each(FOURNISSEURS_ACCEPTES)('accepte le fournisseur au bon format %j (nouveau fournisseur sans migration)', async (fournisseur) => {
    await apply(migration0019())

    await expect(generation(fournisseur)).resolves.toEqual(expect.any(String))
  })

  it('accepte toujours l’absence de fournisseur (NULL)', async () => {
    await apply(migration0019())

    await expect(generation(null)).resolves.toEqual(expect.any(String))
  })

  it.each(FOURNISSEURS_REFUSES)('refuse le fournisseur au mauvais format %j (23514)', async (fournisseur) => {
    await apply(migration0019())

    await expect(generation(fournisseur)).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONTRAINTE })
  })

  it('refuse aussi une mise à jour vers un mauvais format (la CHECK vaut pour UPDATE comme pour INSERT)', async () => {
    await apply(migration0019())
    const id = await generation('openai')

    await expect(client.query(`UPDATE ${TABLE} SET fournisseur = 'Mauvais Nom' WHERE id = $1`, [id])).rejects.toMatchObject({ code: CHECK_VIOLATION })
    expect(await fournisseurDe(id)).toBe('openai')
  })

  it('conserve les générations déjà enregistrées avant 0019 (anthropic, faux, NULL) sans les modifier', async () => {
    const anthropic = await generation('anthropic')
    const faux = await generation('faux')
    const aucun = await generation(null)

    await apply(migration0019())

    expect(await fournisseurDe(anthropic)).toBe('anthropic')
    expect(await fournisseurDe(faux)).toBe('faux')
    expect(await fournisseurDe(aucun)).toBeNull()
  })

  it('ne change rien d’autre : mêmes colonnes, mêmes autres contraintes, mêmes index', async () => {
    const avant = await structureHorsContrainte()

    await apply(migration0019())

    expect(await structureHorsContrainte()).toEqual(avant)
  })

  it('garde le nom de la contrainte (celui que Drizzle attend) et reste de type CHECK', async () => {
    await apply(migration0019())

    const resultat = await client.query<{ contype: string }>(
      `SELECT c.contype FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'generations_ia' AND c.conname = $2`,
      [SCHEMA, CONTRAINTE],
    )
    expect(resultat.rows).toEqual([{ contype: 'c' }])
  })

  it('est rejouable : un second passage (DROP puis ADD) laisse la même définition', async () => {
    await apply(migration0019())
    const premiere = await definitionContrainte()

    await apply(migration0019())

    expect(await definitionContrainte()).toBe(premiere)
  })
})

describe('migration 0019 : ROLLBACK documenté', () => {
  it('est un bloc BEGIN … COMMIT de deux ALTER TABLE (aucun DROP TABLE)', () => {
    const { executables } = rollback()

    expect(executables[0]).toBe('BEGIN;')
    expect(executables.at(-1)).toBe('COMMIT;')
    expect(executables).toHaveLength(4)
    expect(executables.join('\n')).not.toMatch(/DROP TABLE/i)
    expect(executables[1]).toBe(`ALTER TABLE "generations_ia" DROP CONSTRAINT "${CONTRAINTE}";`)
    expect(executables[2]).toContain(`IN ('anthropic','faux')`)
  })

  it('restaure exactement l’ancienne définition et l’ancien comportement (openai et gemini refusés), puis se réapplique', async () => {
    await apply(migration0019())
    const conservee = await generation('anthropic')

    await executerRollback()

    expect(await definitionContrainte()).toBe(definitionApres0018)
    await expect(generation('openai')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONTRAINTE })
    await expect(generation('gemini')).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONTRAINTE })
    await expect(generation('faux')).resolves.toEqual(expect.any(String))
    await expect(generation(null)).resolves.toEqual(expect.any(String))
    expect(await fournisseurDe(conservee)).toBe('anthropic')

    await apply(migration0019())

    await expect(generation('openai')).resolves.toEqual(expect.any(String))
  })

  it('échoue (23514) s’il existe des lignes hors anthropic/faux, annule tout et laisse la CHECK de format en place', async () => {
    await apply(migration0019())
    const id = await generation('openai')
    const elargie = await definitionContrainte()

    await expect(executerRollback()).rejects.toMatchObject({ code: CHECK_VIOLATION })

    expect(await definitionContrainte()).toBe(elargie)
    expect(await fournisseurDe(id)).toBe('openai')
    await expect(generation('openai')).resolves.toEqual(expect.any(String))
  })

  it('réussit après le traitement a) : les traces sont conservées, leur fournisseur passe à NULL (les autres lignes ne bougent pas)', async () => {
    await apply(migration0019())
    const id = await generation('openai')
    const gemini = await generation('gemini')
    const autre = await generation('anthropic')
    const faux = await generation('faux')
    const aucun = await generation(null)
    const { conserverTraces } = rollback()
    expect(conserverTraces).toBeDefined()

    await client.query(conserverTraces!)
    await executerRollback()

    expect(await definitionContrainte()).toBe(definitionApres0018)
    expect(await fournisseurDe(id)).toBeNull()
    expect(await fournisseurDe(gemini)).toBeNull()
    expect(await fournisseurDe(autre)).toBe('anthropic')
    expect(await fournisseurDe(faux)).toBe('faux')
    expect(await fournisseurDe(aucun)).toBeNull()
  })

  it('réussit après le traitement b) : seules les traces hors anthropic/faux sont supprimées (NULL conservé)', async () => {
    await apply(migration0019())
    const id = await generation('openai')
    const gemini = await generation('gemini')
    const autre = await generation('faux')
    const aucun = await generation(null)
    const { supprimerTraces } = rollback()
    expect(supprimerTraces).toBeDefined()

    await client.query(supprimerTraces!)
    await executerRollback()

    expect(await definitionContrainte()).toBe(definitionApres0018)
    const restantes = await client.query<{ id: string }>(`SELECT id FROM ${TABLE} WHERE id = ANY ($1) ORDER BY id`, [[id, gemini, autre, aucun]])
    expect(restantes.rows.map((ligne) => ligne.id).sort()).toEqual([autre, aucun].sort())
  })

  it('documente que le rollback échoue en présence de lignes hors anthropic/faux et comment les traiter', () => {
    const contenu = lireBrut(migration0019())

    expect(contenu).toMatch(/ÉCHOUE \(23514/)
    expect(contenu).toMatch(/ni NULL, ni 'anthropic', ni 'faux'/)
    expect(contenu).toMatch(/SELECT "fournisseur", count\(\*\) FROM "generations_ia" WHERE "fournisseur" NOT IN \('anthropic','faux'\)/)
    expect(rollback().conserverTraces).toBeDefined()
    expect(rollback().supprimerTraces).toBeDefined()
  })
})
