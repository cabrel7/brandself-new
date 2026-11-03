import type { AbonnementDTO } from '#shared/dto'
import { TOUJOURS_FRAIS } from '~/composables/useStudioDisponibilites'

export const CLE_ABONNEMENT = 'studio-abonnement'
export const MESSAGE_ABONNEMENT_CHARGEMENT = 'Nous n’avons pas pu charger votre abonnement.'

/**
 * État d'abonnement du studio : `GET /api/studio/abonnement` (plan effectif, quotas, paiement en cours,
 * offre payable). Toujours une lecture fraîche : un paiement peut avoir abouti entre deux écrans.
 */
export function useAbonnement() {
  const { data, status, error, refresh } = useFetch<AbonnementDTO>('/api/studio/abonnement', {
    key: CLE_ABONNEMENT,
    ...TOUJOURS_FRAIS,
  })

  const abonnement = computed(() => data.value ?? null)
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const enErreur = computed(() => !data.value && Boolean(error.value))
  /** Droits du plan payant conservés après l'échéance (bandeau de grâce). */
  const enGrace = computed(() => data.value?.etat === 'grace')

  return { abonnement, enChargement, enErreur, enGrace, refresh }
}
