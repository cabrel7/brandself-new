import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { TestProject } from 'vitest/node'
import {
  dossierMediasWorker,
  nomBaseClone,
  nomBaseModele,
  NB_WORKERS_MAX,
  VARIABLE_NB_BASES,
} from './support/bases-par-worker'
import { assertBaseDeTest, assertRedisDeTest } from './support/garde-base'

const DOSSIER_MIGRATIONS = path.resolve(import.meta.dirname, '../../server/db/migrations')

/** Identifiant SQL entre guillemets (les noms viennent de la configuration, jamais d'une entrée externe). */
function ident(nom: string): string {
  return `"${nom.replaceAll('"', '""')}"`
}

function urlVers(urlCommune: string, nomBase: string): string {
  const u = new URL(urlCommune)
  u.pathname = `/${encodeURIComponent(nomBase)}`
  return u.toString()
}

async function migrer(urlBase: string): Promise<void> {
  const pool = new Pool({ connectionString: urlBase, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: DOSSIER_MIGRATIONS })
  } finally {
    await pool.end()
  }
}

/** Supprime une base (connexions comprises) : sert au nettoyage d'un run interrompu comme au teardown. */
async function supprimerBase(admin: Pool, nom: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${ident(nom)} WITH (FORCE)`)
}

/**
 * Mode parallèle : une base modèle `<base>_tpl` migrée UNE fois, puis `nbBases` clones `<base>_w<k>`
 * (CREATE DATABASE ... TEMPLATE). Un clone ou un modèle périmé (run interrompu) est supprimé puis recréé.
 * Retourne le nettoyage. L'utilisateur de test doit avoir le droit CREATEDB.
 */
async function preparerBasesParWorker(urlCommune: string, nbBases: number): Promise<() => Promise<void>> {
  // Connexion sur la base commune (elle existe, c'est la base de test) pour émettre CREATE/DROP DATABASE.
  const admin = new Pool({ connectionString: urlCommune, max: 1 })
  const modele = nomBaseModele(urlCommune)
  // On balaie jusqu'à NB_WORKERS_MAX : un run précédent avec plus de workers a pu laisser des clones.
  const tousLesClones = Array.from({ length: NB_WORKERS_MAX }, (_, i) => nomBaseClone(urlCommune, i + 1))
  const nettoyer = async (): Promise<void> => {
    for (const nom of [...tousLesClones, modele]) await supprimerBase(admin, nom)
  }
  try {
    await nettoyer()
    try {
      await admin.query(`CREATE DATABASE ${ident(modele)}`)
    } catch (erreur) {
      throw new Error(
        `Impossible de créer la base modèle "${modele}" : l'utilisateur de test doit avoir le droit CREATEDB `
          + `(ou lancez la suite série : pnpm test:serie). Cause : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        { cause: erreur },
      )
    }
    await migrer(urlVers(urlCommune, modele))
    for (const nom of tousLesClones.slice(0, nbBases)) {
      await admin.query(`CREATE DATABASE ${ident(nom)} TEMPLATE ${ident(modele)}`)
    }
  } catch (erreur) {
    await nettoyer().catch(() => undefined)
    await admin.end()
    throw erreur
  }
  return async () => {
    try {
      await nettoyer()
    } finally {
      await admin.end()
    }
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    assertBaseDeTest(process.env.DATABASE_URL)
    assertRedisDeTest(process.env.REDIS_URL)
  } catch (erreur) {
    // Vitest 5 plante en affichant une erreur levée par un globalSetup (« code.charCodeAt is not a
    // function ») : on écrit donc le motif du refus nous-mêmes avant de relancer l'erreur.
    console.error(`\n[tests d'intégration] ${erreur instanceof Error ? erreur.message : String(erreur)}\n`)
    throw erreur
  }
  const urlCommune = process.env.DATABASE_URL as string

  const mediasDir = project.config.env?.MEDIAS_DIR
  if (!mediasDir) {
    throw new Error('MEDIAS_DIR doit être défini dans la configuration du projet d’intégration.')
  }
  const nbBases = Number.parseInt(String(project.config.env?.[VARIABLE_NB_BASES] ?? '0'), 10)

  // Dossiers de médias à vider : le commun (mode série, projet « serie ») et un par worker (mode parallèle).
  const dossiers = [mediasDir, ...Array.from({ length: nbBases }, (_, i) => dossierMediasWorker(mediasDir, i + 1))]
  let nettoyerBases: (() => Promise<void>) | undefined
  try {
    if (nbBases > 0) {
      nettoyerBases = await preparerBasesParWorker(urlCommune, nbBases)
    } else {
      // Mode série : migrations réelles (celles livrées avec l'application) sur la base commune.
      await migrer(urlCommune)
    }

    for (const dossier of dossiers) {
      await rm(dossier, { recursive: true, force: true })
      await mkdir(dossier, { recursive: true })
    }
  } catch (erreur) {
    await nettoyerBases?.().catch(() => undefined)
    throw erreur
  }

  return async () => {
    for (const dossier of dossiers) await rm(dossier, { recursive: true, force: true })
    await nettoyerBases?.()
  }
}
