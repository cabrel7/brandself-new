import type { DesabonnementApercuDTO, DesabonnementDTO } from '#shared/dto'
import type { PreferenceEmail } from '#shared/notifications'
import { schemaJetonDesabonnement } from '#shared/schemas/notifications'

export type EtatDesabonnement = 'chargement' | 'valide' | 'succes' | 'expire' | 'invalide' | 'erreur'

/** Libellé de ce que la personne ne recevra plus, par préférence (complète « Ne plus recevoir … » et « Vous ne recevrez plus … »). */
export const LIBELLES_DESABONNEMENT: Record<PreferenceEmail, string> = {
  email_hebdo: 'le résumé de la semaine',
  email_rappel_jour: 'les rendez-vous du jour',
}

export const MESSAGE_DESABONNEMENT_ECHEC = 'Nous n’avons pas pu enregistrer votre choix. Réessayez dans un instant.'
export const MESSAGE_DESABONNEMENT_TROP_DE_REQUETES = 'Trop de tentatives. Patientez un instant, puis réessayez.'
export const MESSAGE_DESABONNEMENT_APERCU = 'Nous n’avons pas pu vérifier ce lien. Réessayez dans un instant.'

/**
 * Page publique de désabonnement : aperçu sans effet (GET), puis désabonnement sur confirmation explicite (POST).
 * Aucun store, aucune session : le jeton signé du lien fait foi. Il n'est jamais écrit ailleurs que dans la requête.
 */
export function useDesabonnement() {
  const route = useRoute()

  const jeton = computed(() => {
    const brut = Array.isArray(route.query.jeton) ? route.query.jeton[0] : route.query.jeton
    const lu = schemaJetonDesabonnement.safeParse(brut)
    return lu.success ? lu.data : null
  })

  const etat = ref<EtatDesabonnement>('chargement')
  const preference = ref<PreferenceEmail | null>(null)
  const envoi = ref(false)
  const message = ref('')

  const libelle = computed(() => (preference.value ? LIBELLES_DESABONNEMENT[preference.value] : ''))

  function classerEchec(erreur: unknown): EtatDesabonnement | null {
    const { statut, code } = lireErreurApi(erreur)
    if (statut === 410 || code === 'JETON_EXPIRE') return 'expire'
    if (statut === 404 || code === 'JETON_INVALIDE') return 'invalide'
    return null
  }

  /** Aperçu : GET sans aucun effet. */
  async function apercu(): Promise<void> {
    message.value = ''
    if (!jeton.value) {
      etat.value = 'invalide'
      return
    }
    etat.value = 'chargement'
    try {
      const reponse = await $fetch<DesabonnementApercuDTO>('/api/public/desabonnement', { query: { jeton: jeton.value } })
      preference.value = reponse.preference
      etat.value = 'valide'
    } catch (erreur) {
      etat.value = classerEchec(erreur) ?? 'erreur'
      if (etat.value === 'erreur') {
        message.value = lireErreurApi(erreur).statut === 429 ? MESSAGE_DESABONNEMENT_TROP_DE_REQUETES : MESSAGE_DESABONNEMENT_APERCU
      }
    }
  }

  /** Désabonnement : POST, uniquement sur le clic de la personne. */
  async function confirmer(): Promise<void> {
    if (envoi.value || !jeton.value) return
    message.value = ''
    envoi.value = true
    try {
      const reponse = await $fetch<DesabonnementDTO>('/api/public/desabonnement', { method: 'POST', body: { jeton: jeton.value } })
      preference.value = reponse.preference
      etat.value = 'succes'
    } catch (erreur) {
      const classe = classerEchec(erreur)
      if (classe) etat.value = classe
      else message.value = lireErreurApi(erreur).statut === 429 ? MESSAGE_DESABONNEMENT_TROP_DE_REQUETES : MESSAGE_DESABONNEMENT_ECHEC
    } finally {
      envoi.value = false
    }
  }

  return { etat, libelle, envoi, message, apercu, confirmer }
}
