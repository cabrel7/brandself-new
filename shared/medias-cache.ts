import { z } from 'zod'

// Éviction du cache nginx de `/medias/` (décision du 2026-11-16 : rien ne reste accessible pour un compte suspendu ou
// une vitrine bloquée). Le contrat avec nginx : une requête `GET /medias/<id>/<fichier>` portant cet en-tête avec le bon
// secret contourne le cache (`proxy_cache_bypass`) ; l'application répond 404 (ou 200 après réactivation) et nginx
// enregistre cette réponse à la place de l'ancienne.

/** En-tête porteur du secret (minuscules : forme canonique des en-têtes HTTP/2). */
export const MEDIAS_CACHE_REFRESH_ENTETE = 'x-cache-refresh'

/** Longueur minimale du secret (`MEDIAS_CACHE_REFRESH_SECRET`). */
export const MEDIAS_CACHE_REFRESH_SECRET_LONGUEUR_MIN = 32

/** Caractères ASCII imprimables sans espace : le secret voyage dans un en-tête HTTP. */
export const MEDIAS_CACHE_REFRESH_SECRET_FORMAT = /^[\x21-\x7E]+$/

/** Nombre maximal d'URL redemandées par job (4 par image : 3 largeurs + la variante de partage). */
export const MEDIAS_CACHE_REFRESH_MAX_URLS = 1_000

/** Requêtes simultanées vers nginx : le job ne doit jamais saturer l'application qu'il vide de son cache. */
export const MEDIAS_CACHE_REFRESH_CONCURRENCE = 4

/** Délai maximal d'une requête, en millisecondes. */
export const MEDIAS_CACHE_REFRESH_TIMEOUT_MS = 5_000

/** Charge du job : l'identifiant du compte, RIEN d'autre (ni secret, ni donnée personnelle). */
export const mediasCacheRefreshJobDataSchema = z.strictObject({
  userId: z.string().min(1).max(128),
})

export type MediasCacheRefreshJobData = z.infer<typeof mediasCacheRefreshJobDataSchema>
