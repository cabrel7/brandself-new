import type { ProchaineEtapeDTO } from '#shared/dto'
import type { NextStep } from '#shared/vitrine'
import { TOUJOURS_FRAIS } from '~/composables/useStudioDisponibilites'

export const MESSAGE_ETAPE_CHARGEMENT = 'Nous n’avons pas pu charger votre prochaine étape.'
export const MESSAGE_ETAPE_IGNORER = 'Nous n’avons pas pu masquer cette étape. Réessayez dans un instant.'
export const ANNONCE_ETAPE_MASQUEE = 'Étape masquée.'

/**
 * « Prochaine étape » unique de l'accueil du studio : `GET /api/studio/prochaine-etape` (ordre et étapes
 * déjà ignorées décidés par le serveur) et `POST …/ignorer`, qui renvoie directement la suivante.
 */
export function useProchaineEtape() {
  const { data, status, error, refresh } = useFetch<ProchaineEtapeDTO>('/api/studio/prochaine-etape', {
    key: 'studio-prochaine-etape',
    ...TOUJOURS_FRAIS,
  })

  const etape = computed<NextStep | null>(() => data.value?.etape ?? null)
  const definition = computed(() => prochaineEtape(etape.value))
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const enErreur = computed(() => !data.value && !!error.value)

  const ignorerEnCours = ref(false)
  const erreurIgnorer = ref('')
  const annonce = ref('')

  /** Retire l'étape affichée pour toujours puis affiche la suivante. Renvoie `false` en cas d'échec. */
  async function ignorer(): Promise<boolean> {
    const courante = etape.value
    if (!courante || ignorerEnCours.value) return false
    ignorerEnCours.value = true
    erreurIgnorer.value = ''
    try {
      data.value = await $fetch<ProchaineEtapeDTO>('/api/studio/prochaine-etape/ignorer', {
        method: 'POST',
        body: { etape: courante },
      })
      // Vider puis réécrire : l'annonce est lue même si la précédente est identique.
      annonce.value = ''
      await nextTick()
      annonce.value = ANNONCE_ETAPE_MASQUEE
      return true
    } catch {
      erreurIgnorer.value = MESSAGE_ETAPE_IGNORER
      return false
    } finally {
      ignorerEnCours.value = false
    }
  }

  return {
    etape, definition, enChargement, enErreur, ignorerEnCours, erreurIgnorer, annonce, ignorer, refresh,
  }
}
