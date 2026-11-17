import { ADRESSE_SOUHAITEE_DUREE_SECONDES, COOKIE_ADRESSE_SOUHAITEE } from '#shared/adresse-souhaitee'

/**
 * Cookie de l'adresse souhaitée (écrit par la page d'accueil, lu par l'onboarding).
 * La valeur lue n'est jamais fiable : elle doit être revalidée avant usage.
 */
export function useAdresseSouhaitee() {
  return useCookie<string | null>(COOKIE_ADRESSE_SOUHAITEE, {
    maxAge: ADRESSE_SOUHAITEE_DUREE_SECONDES,
    sameSite: 'lax',
    path: '/',
    secure: !import.meta.dev,
    default: () => null,
  })
}
