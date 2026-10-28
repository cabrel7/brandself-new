import type { TemoignagesPublicsReponse } from '#shared/dto'

/**
 * Lecture seule des témoignages visibles d'une vitrine (rendu serveur).
 * Ne lève jamais : la page décide (l'accueil s'en passe, le bloc disparaît s'il est vide).
 */
export async function usePublicTemoignages(username: string) {
  const { data, error } = await useAsyncData(`temoignages-publics-${username}`, () =>
    $fetch<TemoignagesPublicsReponse>(`/api/public/${encodeURIComponent(username)}/temoignages`),
  )
  const reponse = computed<TemoignagesPublicsReponse | null>(() => data.value ?? null)
  return { reponse, erreur: error }
}
