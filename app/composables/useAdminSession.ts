import { ADMIN_PREFIXE_API, ADMIN_PREFIXE_PAGES } from '#shared/admin'
import type { AdminSessionDto } from '#shared/schemas/admin'

export const CHEMIN_CONNEXION_ADMIN = `${ADMIN_PREFIXE_PAGES}/connexion`
const MESSAGE_ECHEC_DECONNEXION = 'Nous n’avons pas pu vous déconnecter. Réessayez dans un instant.'

/**
 * Session de l'administrateur (A1). La garde réelle est côté serveur (`requireSuperadmin`, 404 uniforme) : ce
 * composable ne fait que lire l'état et lancer la déconnexion. Aucune donnée n'est stockée dans le navigateur.
 */
export function useAdminSession() {
  const session = useState<AdminSessionDto | null>('admin-session', () => null)
  const deconnexionEnCours = ref(false)
  const requete = useRequestFetch()
  const toast = useToast()

  /** Lit la session : vrai si l'administrateur est connecté, faux pour toute erreur (404 uniforme du serveur compris). */
  async function charger(): Promise<boolean> {
    try {
      session.value = await requete<AdminSessionDto>(`${ADMIN_PREFIXE_API}/session`)
      return true
    } catch {
      session.value = null
      return false
    }
  }

  /** Session expirée ou refusée en cours d'usage : on oublie l'état local et on revient à la connexion. */
  async function expirer(): Promise<void> {
    session.value = null
    await navigateTo(CHEMIN_CONNEXION_ADMIN)
  }

  async function deconnecter(): Promise<void> {
    if (deconnexionEnCours.value) return
    deconnexionEnCours.value = true
    try {
      await requete(`${ADMIN_PREFIXE_API}/deconnexion`, { method: 'POST' })
    } catch {
      toast.add({ title: MESSAGE_ECHEC_DECONNEXION, color: 'error', icon: 'i-ph-warning-circle' })
      return
    } finally {
      deconnexionEnCours.value = false
    }
    await expirer()
  }

  return { session, deconnexionEnCours, charger, expirer, deconnecter }
}
