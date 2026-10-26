import type { ServicePublicCarteDTO, ServicesPublicsReponse } from '#shared/dto'
import { formatDureeCourte, formatDureeLongue, resumeSeancesCourt, resumeSeancesLong, SERVICE_ACTIONS, serviceActionHref, serviceDetailHref } from '#shared/services'

const HTTP_NOT_FOUND = 404
const HTTP_SERVER_ERROR = 500

const LIBELLE_VOIR_DETAIL = 'Voir le détail'

function statusCodeOf(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const { statusCode } = err
    if (typeof statusCode === 'number') return statusCode
  }
  return HTTP_SERVER_ERROR
}

/** Erreur de page pour une lecture publique : 404 si inconnu ou masqué, 500 sinon. */
export function erreurPagePublique(err: unknown) {
  const introuvable = statusCodeOf(err) === HTTP_NOT_FOUND
  return createError({
    statusCode: introuvable ? HTTP_NOT_FOUND : HTTP_SERVER_ERROR,
    statusMessage: introuvable ? 'Not Found' : 'Server Error',
    fatal: true,
  })
}

/**
 * Lecture seule des services visibles d'une vitrine (rendu serveur).
 * Ne lève jamais : la page décide (l'accueil se passe de services, la page Services répond 404).
 */
export async function usePublicServices(username: string) {
  const { data, error } = await useAsyncData(`services-publics-${username}`, () =>
    $fetch<ServicesPublicsReponse>(`/api/public/${encodeURIComponent(username)}/services`),
  )
  const reponse = computed<ServicesPublicsReponse | null>(() => data.value ?? null)
  return { reponse, erreur: error }
}

/** Durée d'un service : résumé des séances (accompagnement), durée seule, ou rien (devis sans durée). */
export function resumeDuree(s: Pick<ServicePublicCarteDTO, 'nbSeances' | 'dureeMin' | 'rythme'>, forme: 'court' | 'long'): string | null {
  if (s.nbSeances !== null) {
    return forme === 'court' ? resumeSeancesCourt(s.nbSeances, s.dureeMin) : resumeSeancesLong(s.nbSeances, s.dureeMin, s.rythme)
  }
  if (s.dureeMin === null) return null
  return forme === 'court' ? formatDureeCourte(s.dureeMin) : formatDureeLongue(s.dureeMin)
}

/** Bouton d'une carte : action du type si réservable, sinon accès au détail. */
export function actionCarte(s: Pick<ServicePublicCarteDTO, 'slug' | 'type' | 'reservable'>, username: string): { libelle: string, to: string } {
  return s.reservable
    ? { libelle: SERVICE_ACTIONS[s.type].court, to: serviceActionHref(username, s.slug) }
    : { libelle: LIBELLE_VOIR_DETAIL, to: serviceDetailHref(username, s.slug) }
}
