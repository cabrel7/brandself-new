const STATUT_SESSION_REFUSEE = 404

/** Session refusée en cours d'usage (404 uniforme du serveur) : retour à la connexion, comme la vue d'ensemble d'A1. */
export function useAdminSessionExpiree(erreur: Ref<unknown>): void {
  const { expirer } = useAdminSession()
  watch(erreur, (valeur) => {
    if (valeur && lireErreurApi(valeur).statut === STATUT_SESSION_REFUSEE) void expirer()
  })
}
