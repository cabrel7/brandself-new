import { ADMIN_PREFIXE_PAGES, cheminNormalise } from '#shared/admin'

// A1 : séparation des deux hôtes côté routeur (le serveur la fait déjà : server/middleware/00-hote.ts).
// - hôte d'administration : toute route hors /admin part vers /admin ;
// - hôte public : /admin et /admin/** répondent 404.
// Un chemin illisible est traité comme suspect : refusé sur l'hôte public, renvoyé vers /admin sur l'autre.
export default defineNuxtRouteMiddleware((to) => {
  const chemin = cheminNormalise(to.path)
  const surPagesAdmin = chemin !== null && (chemin === ADMIN_PREFIXE_PAGES || chemin.startsWith(`${ADMIN_PREFIXE_PAGES}/`))

  if (useHoteAdmin()) {
    return surPagesAdmin ? undefined : navigateTo(ADMIN_PREFIXE_PAGES, { replace: true })
  }
  if (surPagesAdmin || chemin === null) {
    showError({ statusCode: 404, statusMessage: 'Page introuvable' })
    return false
  }
})
