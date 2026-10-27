import type { ContenusPublicsDTO, VitrinePubliqueDTO, VitrinePubliqueReponse } from '#shared/dto'

const HTTP_NOT_FOUND = 404
const HTTP_SERVER_ERROR = 500

const CONTENUS_VIDES: ContenusPublicsDTO = { services: 0, realisations: 0 }

function statusCodeOf(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const { statusCode } = err
    if (typeof statusCode === 'number') return statusCode
  }
  return HTTP_SERVER_ERROR
}

function cleVitrine(username: string): string {
  // Le serveur normalise le username : la clé doit l'être aussi, des deux côtés (page et cadre).
  return `vitrine-publique-${username.trim().toLowerCase()}`
}

/**
 * Lecture seule de la vitrine publique (rendu serveur). Toute erreur devient une
 * erreur de page : 404 si la vitrine n'existe pas ou n'est pas publiée, 500 sinon.
 */
export async function usePublicVitrine(username: string): Promise<Ref<VitrinePubliqueDTO>> {
  const { data, error } = await useAsyncData(cleVitrine(username), () =>
    $fetch<VitrinePubliqueReponse>(`/api/public/${encodeURIComponent(username)}`),
  )

  if (error.value || !data.value) {
    const statusCode = error.value ? statusCodeOf(error.value) : HTTP_NOT_FOUND
    throw createError({
      statusCode: statusCode === HTTP_NOT_FOUND ? HTTP_NOT_FOUND : HTTP_SERVER_ERROR,
      statusMessage: statusCode === HTTP_NOT_FOUND ? 'Not Found' : 'Server Error',
      fatal: true,
    })
  }

  return computed(() => data.value!.vitrine) as Ref<VitrinePubliqueDTO>
}

/**
 * Nombre d'éléments visibles par liste (navigation). Lit la réponse déjà chargée par
 * `usePublicVitrine` : aucune requête supplémentaire.
 */
export function usePublicContenus(username: string): ComputedRef<ContenusPublicsDTO> {
  const donnees = useNuxtData<VitrinePubliqueReponse>(cleVitrine(username))
  return computed(() => donnees.data.value?.contenus ?? CONTENUS_VIDES)
}
