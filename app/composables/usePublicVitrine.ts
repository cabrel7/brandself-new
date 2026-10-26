import type { VitrinePubliqueDTO } from '#shared/dto'

const HTTP_NOT_FOUND = 404
const HTTP_SERVER_ERROR = 500

function statusCodeOf(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const { statusCode } = err
    if (typeof statusCode === 'number') return statusCode
  }
  return HTTP_SERVER_ERROR
}

/**
 * Lecture seule de la vitrine publique (rendu serveur). Toute erreur devient une
 * erreur de page : 404 si la vitrine n'existe pas ou n'est pas publiée, 500 sinon.
 */
export async function usePublicVitrine(username: string): Promise<Ref<VitrinePubliqueDTO>> {
  const { data, error } = await useAsyncData(`vitrine-publique-${username}`, () =>
    $fetch<{ vitrine: VitrinePubliqueDTO }>(`/api/public/${encodeURIComponent(username)}`),
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
