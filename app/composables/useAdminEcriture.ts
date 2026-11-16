import { ADMIN_IDEMPOTENCE_ENTETE, ADMIN_PREFIXE_API, ADMIN_REAUTH_ENTETE } from '#shared/admin'
import type { AdminAction, AdminCible } from '#shared/admin'
import type { DemandeReauth } from '#shared/schemas/admin'
import { messageDepuisErreurApi } from '~/utils/admin-a2'

const DELAI_RENVOI_CODE_S = 60
const STATUT_SESSION_REFUSEE = 404

export type ResultatEcriture<T> = { ok: true, donnees: T } | { ok: false, message: string }

/**
 * Le 404 uniforme du serveur (sans code) signale une session d'administration refusée : retour à la connexion.
 * Un 404 AVEC code (`UTILISATEUR_INTROUVABLE`, `VITRINE_INTROUVABLE`…) est une réponse métier, affichée en page.
 */
export function surveillerSessionAdmin(erreur: Ref<unknown>): void {
  const { expirer } = useAdminSession()
  watch(erreur, (valeur) => {
    if (!valeur) return
    const lue = lireErreurApi(valeur)
    if (lue.statut === STATUT_SESSION_REFUSEE && lue.code === null) void expirer()
  })
}

/**
 * Écriture d'administration : POST avec clé d'idempotence (toujours) et code de réauthentification (si exigé).
 * Le message d'erreur est celui du serveur (`ERROR_MESSAGES`), jamais un texte écrit ici.
 */
export function useAdminEcriture() {
  const { expirer } = useAdminSession()

  async function ecrire<T>(
    chemin: string,
    corps: Record<string, string | number>,
    options: { cle: string, code?: string },
  ): Promise<ResultatEcriture<T>> {
    const entetes: Record<string, string> = { [ADMIN_IDEMPOTENCE_ENTETE]: options.cle }
    if (options.code) entetes[ADMIN_REAUTH_ENTETE] = options.code
    try {
      const donnees = await $fetch<T>(chemin, { method: 'POST', body: corps, headers: entetes })
      return { ok: true, donnees }
    } catch (e) {
      const lue = lireErreurApi(e)
      if (lue.statut === STATUT_SESSION_REFUSEE && lue.code === null) void expirer()
      return { ok: false, message: messageDepuisErreurApi(e) }
    }
  }

  return { ecrire }
}

/** Demande d'un code de réauthentification (A1) lié à l'action et à sa cible ; renvoi possible après un délai. */
export function useReauthCode() {
  const { remaining: secondesRestantes, start: demarrerDelai } = useCountdown(DELAI_RENVOI_CODE_S)
  const envoye = ref(false)
  const enCours = ref(false)
  const erreur = ref('')

  async function demander(action: AdminAction, cibleType: AdminCible, cibleId: string): Promise<boolean> {
    if (enCours.value) return false
    enCours.value = true
    erreur.value = ''
    const corps: DemandeReauth = { action, cibleType, cibleId }
    try {
      await $fetch(`${ADMIN_PREFIXE_API}/reauth/code`, { method: 'POST', body: corps })
      envoye.value = true
      demarrerDelai()
      return true
    } catch (e) {
      erreur.value = messageDepuisErreurApi(e)
      return false
    } finally {
      enCours.value = false
    }
  }

  function reinitialiser(): void {
    envoye.value = false
    erreur.value = ''
  }

  return { envoye, enCours, erreur, secondesRestantes, demander, reinitialiser }
}
