import { estHoteAdmin } from '#shared/admin'

/**
 * Vrai si la page est servie sur l'hôte d'administration (A1, D-A1-02). Même calcul au rendu serveur (en-tête
 * `Host`, jamais `X-Forwarded-Host`) et dans le navigateur (`location.hostname`) : `useRequestURL` couvre les deux.
 */
export function useHoteAdmin(): boolean {
  return estHoteAdmin(useRequestURL().hostname, useRuntimeConfig().public.adminHost)
}
