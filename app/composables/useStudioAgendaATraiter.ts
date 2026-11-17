import { TOUJOURS_FRAIS as OPTIONS_FRAIS } from '~/composables/useStudioDisponibilites'

/** Réponse de GET /api/studio/agenda/a-traiter. */
interface AgendaATraiterReponse {
  nombre: number
}

/** Clé partagée : permet `refreshNuxtData(CLE_AGENDA_A_TRAITER)` depuis n'importe quel écran. */
export const CLE_AGENDA_A_TRAITER = 'studio-agenda-a-traiter'

/** Entrée de navigation qui porte la pastille. */
export const CHEMIN_AGENDA = '/studio/agenda'

const PLAFOND_AFFICHAGE = 9

/**
 * Éléments de l'agenda à traiter (réservations en attente + demandes nouvelles), pour la
 * pastille des barres de navigation. Lecture annexe : une erreur est silencieuse (0), elle
 * ne bloque ni n'affiche jamais rien. Rafraîchi à chaque changement de route du studio.
 */
export function useStudioAgendaATraiter() {
  const route = useRoute()
  const { data, refresh } = useFetch<AgendaATraiterReponse>('/api/studio/agenda/a-traiter', {
    key: CLE_AGENDA_A_TRAITER,
    ...OPTIONS_FRAIS,
  })

  // Les deux barres consomment ce composable : `defer` fusionne leurs requêtes en une seule.
  watch(() => route.path, () => {
    void refresh({ dedupe: 'defer' })
  })

  const nombre = computed(() => {
    const valeur = data.value?.nombre
    return typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? Math.floor(valeur) : 0
  })
  /** Texte de la pastille : « 1 » à « 9 », puis « 9+ ». */
  const affichage = computed(() => (nombre.value > PLAFOND_AFFICHAGE ? `${PLAFOND_AFFICHAGE}+` : String(nombre.value)))
  /** Libellé pour lecteurs d'écran, avec le nombre exact. */
  const libelleAccessible = computed(() => `${nombre.value} à traiter`)

  return { nombre, affichage, libelleAccessible, refresh }
}
