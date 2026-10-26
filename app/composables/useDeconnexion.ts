const MESSAGE_ECHEC = 'Nous n’avons pas pu vous déconnecter. Réessayez dans un instant.'

/** Déconnexion via Better Auth ; redirige vers /connexion (auth.redirects.logout). */
export function useDeconnexion() {
  const { signOut } = useUserSession()
  const enCours = ref(false)
  const erreur = ref('')

  async function deconnecter(): Promise<void> {
    erreur.value = ''
    enCours.value = true
    try {
      await signOut()
    } catch {
      erreur.value = MESSAGE_ECHEC
    } finally {
      enCours.value = false
    }
  }

  return { enCours, erreur, deconnecter }
}
