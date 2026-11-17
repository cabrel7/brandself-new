import { ETAT_PUBLIC_CHEMIN } from '#shared/admin'
import type { EtatPublicDto } from '#shared/schemas/admin-a4'

// A4 (D-A4-08) : pendant une maintenance, le studio et la connexion sont suspendus côté serveur (503 `MAINTENANCE`).
// Ici, le visiteur est dirigé vers une page qui l'explique, au lieu d'un écran qui échoue sans raison. Les vitrines
// publiques et l'administration ne sont jamais concernées. En cas d'erreur de lecture de l'état, on laisse passer :
// le serveur reste la seule autorité (503 sur les écritures).
const CHEMIN_MAINTENANCE = '/maintenance'
const PREFIXES_SUSPENDUS: readonly string[] = ['/studio', '/connexion']

const estSuspendu = (chemin: string): boolean =>
  PREFIXES_SUSPENDUS.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`))

export default defineNuxtRouteMiddleware(async (to) => {
  if (!estSuspendu(to.path) || useHoteAdmin()) return
  try {
    const etat = await $fetch<EtatPublicDto>(ETAT_PUBLIC_CHEMIN)
    if (etat.maintenance) return navigateTo(CHEMIN_MAINTENANCE, { replace: true })
  } catch {
    // Lecture impossible : aucune redirection.
  }
})
