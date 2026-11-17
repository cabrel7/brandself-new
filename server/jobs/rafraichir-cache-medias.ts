// Éviction du cache nginx de `/medias/` pour un compte suspendu, réactivé, dont la vitrine est bloquée ou rétablie
// (décision du 2026-11-16). Le job redemande à nginx chaque variante d'image du compte avec l'en-tête secret : nginx
// contourne son cache, l'application répond (404 si le compte est masqué, 200 sinon) et nginx enregistre cette réponse
// à la place de l'ancienne.
//
// Garanties : la charge ne contient que `{ userId }` (le secret vient de la configuration, jamais de Redis) ; aucune
// erreur réseau ne fait échouer le job (une variante non rafraîchie reste en cache au plus le temps de son `proxy_cache_valid`) ;
// les journaux ne contiennent que des nombres et des NOMS d'erreur (ni URL, ni identifiant, ni secret) ; idempotent.
import type { JobsOptions, Queue } from 'bullmq'
import { env } from '../../shared/env'
import { JOBS } from '../../shared/jobs'
import {
  MEDIAS_CACHE_REFRESH_CONCURRENCE,
  MEDIAS_CACHE_REFRESH_ENTETE,
  MEDIAS_CACHE_REFRESH_MAX_URLS,
  MEDIAS_CACHE_REFRESH_TIMEOUT_MS,
  mediasCacheRefreshJobDataSchema,
} from '../../shared/medias-cache'
import type { MediasCacheRefreshJobData } from '../../shared/medias-cache'
import { listerCheminsMediasDuCompte } from '../services/medias'
import { getMaintenanceQueue } from './queues'

/** Une seule tentative BullMQ : le job ne lève jamais sur une erreur réseau, et un job échoué n'a rien à rejouer. */
export const rafraichirCacheMediasJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

function nomErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : typeof erreur
}

/**
 * Enfile le rafraîchissement du cache des images d'un compte. À appeler APRÈS le commit de l'écriture, jamais dans la
 * transaction. NE LÈVE JAMAIS : Redis indisponible = journal (nom d'erreur seulement), l'action d'administration réussit.
 */
export async function planifierRafraichissementCacheMedias(userId: string, queue: Pick<Queue, 'add'> = getMaintenanceQueue()): Promise<void> {
  try {
    const data: MediasCacheRefreshJobData = { userId }
    await queue.add(JOBS.rafraichirCacheMedias, data, rafraichirCacheMediasJobOptions)
  } catch (erreur) {
    console.error({ medias: 'rafraîchissement du cache : enfilage impossible (MEDIAS_CACHE_ENFILAGE_ECHEC)', nom: nomErreur(erreur) })
  }
}

export interface DepsRafraichissementCache {
  fetch?: typeof fetch
  /** `undefined` explicite = secret absent (tâche sautée). Défaut : `MEDIAS_CACHE_REFRESH_SECRET`. */
  secret?: string | undefined
  /** Défaut : `NUXT_PUBLIC_SITE_URL`. */
  siteUrl?: string
  maxUrls?: number
}

export interface BilanRafraichissementCache {
  saute: boolean
  demandees: number
  reussies: number
  erreurs: number
  tronque: boolean
}

const BILAN_SAUTE: BilanRafraichissementCache = { saute: true, demandees: 0, reussies: 0, erreurs: 0, tronque: false }

/** Redemande une URL à nginx. Retourne le nom de l'erreur réseau, ou `null` si une réponse HTTP est arrivée. */
async function redemander(url: string, secret: string, appeler: typeof fetch): Promise<string | null> {
  try {
    const reponse = await appeler(url, {
      method: 'GET',
      headers: { [MEDIAS_CACHE_REFRESH_ENTETE]: secret },
      // Jamais de redirection suivie : l'en-tête secret ne doit pas être renvoyé vers un autre hôte.
      redirect: 'manual',
      signal: AbortSignal.timeout(MEDIAS_CACHE_REFRESH_TIMEOUT_MS),
    })
    // Le corps est lu en entier : nginx n'enregistre la réponse en cache que s'il la reçoit complète.
    await reponse.arrayBuffer()
    return null
  } catch (erreur) {
    return nomErreur(erreur)
  }
}

/** Exécute le job : valide la charge (stricte), liste les variantes du compte, les redemande à nginx (concurrence bornée). */
export async function traiterRafraichirCacheMedias(donnees: unknown, deps: DepsRafraichissementCache = {}): Promise<BilanRafraichissementCache> {
  const { userId } = mediasCacheRefreshJobDataSchema.parse(donnees)
  const secret = 'secret' in deps ? deps.secret : env.MEDIAS_CACHE_REFRESH_SECRET
  if (!secret) {
    console.info('[worker] rafraîchissement du cache des images sauté : secret absent (MEDIAS_CACHE_SANS_SECRET)')
    return BILAN_SAUTE
  }
  const base = (deps.siteUrl ?? env.NUXT_PUBLIC_SITE_URL).replace(/\/+$/, '')
  const appeler = deps.fetch ?? fetch
  const { chemins, tronque } = await listerCheminsMediasDuCompte(userId, deps.maxUrls ?? MEDIAS_CACHE_REFRESH_MAX_URLS)

  const nomsErreurs = new Map<string, number>()
  let suivant = 0
  const travailleur = async (): Promise<void> => {
    for (let i = suivant++; i < chemins.length; i = suivant++) {
      const nom = await redemander(`${base}${chemins[i]}`, secret, appeler)
      if (nom !== null) nomsErreurs.set(nom, (nomsErreurs.get(nom) ?? 0) + 1)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MEDIAS_CACHE_REFRESH_CONCURRENCE, chemins.length) }, travailleur))

  const erreurs = [...nomsErreurs.values()].reduce((somme, n) => somme + n, 0)
  if (erreurs > 0) {
    console.error({ medias: 'rafraîchissement du cache : requêtes en échec (MEDIAS_CACHE_REQUETES_ECHEC)', erreurs, noms: [...nomsErreurs.keys()] })
  }
  if (tronque) {
    console.error({ medias: 'rafraîchissement du cache : liste tronquée à la borne (MEDIAS_CACHE_TRONQUE)', borne: deps.maxUrls ?? MEDIAS_CACHE_REFRESH_MAX_URLS })
  }
  return { saute: false, demandees: chemins.length, reussies: chemins.length - erreurs, erreurs, tronque }
}
