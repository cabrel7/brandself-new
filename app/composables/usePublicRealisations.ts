import type { RealisationsPublicsReponse } from '#shared/dto'

/**
 * Lecture seule des réalisations visibles d'une vitrine (rendu serveur).
 * Ne lève jamais : la page décide (l'accueil s'en passe, la page Réalisations répond 404).
 */
export async function usePublicRealisations(username: string) {
  const { data, error } = await useAsyncData(`realisations-publiques-${username}`, () =>
    $fetch<RealisationsPublicsReponse>(`/api/public/${encodeURIComponent(username)}/realisations`),
  )
  const reponse = computed<RealisationsPublicsReponse | null>(() => data.value ?? null)
  return { reponse, erreur: error }
}
