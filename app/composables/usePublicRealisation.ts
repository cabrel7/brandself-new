import type { RealisationPublicReponse } from '#shared/dto'

/**
 * Lecture seule d'une réalisation visible et de ses voisines (rendu serveur).
 * Toute erreur devient une erreur de page : 404 si la vitrine ou la réalisation est introuvable ou masquée.
 */
export async function usePublicRealisation(username: string, slug: string): Promise<Ref<RealisationPublicReponse>> {
  const { data, error } = await useAsyncData(`realisation-publique-${username}-${slug}`, () =>
    $fetch<RealisationPublicReponse>(`/api/public/${encodeURIComponent(username)}/realisations/${encodeURIComponent(slug)}`),
  )

  if (error.value || !data.value) throw erreurPagePublique(error.value ?? { statusCode: 404 })

  return computed(() => data.value!) as Ref<RealisationPublicReponse>
}
