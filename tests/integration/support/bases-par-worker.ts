// Isolation des tests d'intégration par worker Vitest : une base PostgreSQL clonée, un index Redis et un dossier
// de médias PAR worker. Fonctions pures (aucun accès à process.env) : la configuration vient de vitest.config.ts.
// Voir docs/tests.md.

/** Variable (posée par vitest.config.ts dans l'env du projet) : nombre de bases clonées ; 0 = mode série (base commune). */
export const VARIABLE_NB_BASES = 'TESTS_NB_BASES_PAR_WORKER'
/** Index Redis de la base commune (mode série et projet « serie ») : inchangé depuis S1. */
export const INDEX_REDIS_COMMUN = 15
/** Nombre maximal de workers isolés : borne dure (index Redis 15 - k, bases clonées à nettoyer). */
export const NB_WORKERS_MAX = 6
/** Valeur par défaut sur cette machine (4 cœurs, 7 Go). */
export const NB_WORKERS_DEFAUT = 3

const SUFFIXE_MODELE = '_tpl'
const PREFIXE_CLONE = '_w'

/** Interprète la valeur de la variable d'environnement de test ; retombe sur le défaut si absente ou invalide. */
export function nombreDeWorkers(valeur: string | undefined): number {
  const n = Number.parseInt(valeur ?? '', 10)
  if (!Number.isInteger(n) || n < 1) return NB_WORKERS_DEFAUT
  return Math.min(n, NB_WORKERS_MAX)
}

function remplacerBase(url: string, nomBase: string): string {
  const u = new URL(url)
  u.pathname = `/${encodeURIComponent(nomBase)}`
  return u.toString()
}

export function nomBaseDe(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

export function nomBaseModele(urlCommune: string): string {
  return `${nomBaseDe(urlCommune)}${SUFFIXE_MODELE}`
}

export function nomBaseClone(urlCommune: string, numero: number): string {
  return `${nomBaseDe(urlCommune)}${PREFIXE_CLONE}${numero}`
}

export function urlBaseClone(urlCommune: string, numero: number): string {
  return remplacerBase(urlCommune, nomBaseClone(urlCommune, numero))
}

export function urlRedisWorker(urlCommune: string, numero: number): string {
  const u = new URL(urlCommune)
  u.pathname = `/${INDEX_REDIS_COMMUN - numero}`
  return u.toString()
}

/** Index Redis acceptés pour un run à `nbWorkers` workers : /15 (commun) et /14, /13… (un par worker). */
export function indexRedisAutorises(nbWorkers: number): number[] {
  return Array.from({ length: nbWorkers + 1 }, (_, k) => INDEX_REDIS_COMMUN - k)
}

export function dossierMediasWorker(dossierCommun: string, numero: number): string {
  return `${dossierCommun}-w${numero}`
}
