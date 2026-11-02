import type { GenerationDTO, GenerationReponse } from '#shared/dto'
import {
  GENERATION_POLL_MAX_MS,
  GENERATION_POLL_MS,
  GENERATION_STATUTS_TERMINAUX,
} from '#shared/ia'
import type { GenerationStatut } from '#shared/ia'

/** Cause d'un arrêt du suivi sans résultat. */
export type ErreurGeneration = 'reseau' | 'introuvable' | 'delai'

const ECHECS_RESEAU_MAX = 3
/** Au-delà de ce délai d'attente, l'interface change de message (« Encore un instant… »). */
const ATTENTE_LONGUE_MS = 10_000
const HTTP_NOT_FOUND = 404

export function estTerminal(statut: GenerationStatut): boolean {
  return (GENERATION_STATUTS_TERMINAUX as readonly GenerationStatut[]).includes(statut)
}

/**
 * Suit une génération IA : interroge `GET /api/studio/generations/:id` toutes les
 * `GENERATION_POLL_MS` (`setTimeout` chaîné) jusqu'à un état terminal.
 * Arrêt : état terminal, démontage, plafond `GENERATION_POLL_MAX_MS` (erreur `delai`),
 * 3 échecs réseau consécutifs (erreur `reseau`) ou 404 (erreur `introuvable`).
 * En pause tant que l'onglet est caché.
 */
export function useGeneration(id: Ref<string | null>) {
  const generation = ref<GenerationDTO | null>(null)
  const erreur = ref<ErreurGeneration | null>(null)
  const attenteLongue = ref(false)

  const statut = computed<GenerationStatut | null>(() => generation.value?.statut ?? null)
  const termine = computed(() => statut.value !== null && estTerminal(statut.value))
  const enAttente = computed(() => id.value !== null && !termine.value && erreur.value === null)

  const visibilite = useDocumentVisibility()

  let minuteur: ReturnType<typeof setTimeout> | null = null
  let minuteurLong: ReturnType<typeof setTimeout> | null = null
  let sequence = 0
  let interrogations = 0
  let echecs = 0

  function annulerMinuteur(): void {
    if (minuteur !== null) clearTimeout(minuteur)
    minuteur = null
  }

  function arreter(): void {
    sequence += 1
    annulerMinuteur()
    if (minuteurLong !== null) clearTimeout(minuteurLong)
    minuteurLong = null
  }

  function planifier(delaiMs: number): void {
    annulerMinuteur()
    minuteur = setTimeout(() => {
      minuteur = null
      void interroger()
    }, delaiMs)
  }

  async function interroger(): Promise<void> {
    const cible = id.value
    if (cible === null) return
    const courante = sequence
    if (visibilite.value === 'hidden') {
      planifier(GENERATION_POLL_MS)
      return
    }
    interrogations += 1
    try {
      const reponse = await $fetch<GenerationReponse>(`/api/studio/generations/${cible}`)
      if (courante !== sequence) return
      echecs = 0
      generation.value = reponse.generation
      if (estTerminal(reponse.generation.statut)) return
    } catch (e) {
      if (courante !== sequence) return
      echecs += 1
      if (lireErreurApi(e).statut === HTTP_NOT_FOUND) {
        erreur.value = 'introuvable'
        return
      }
      if (echecs >= ECHECS_RESEAU_MAX) {
        erreur.value = 'reseau'
        return
      }
    }
    if (interrogations * GENERATION_POLL_MS >= GENERATION_POLL_MAX_MS) {
      erreur.value = 'delai'
      return
    }
    planifier(GENERATION_POLL_MS)
  }

  function demarrer(): void {
    arreter()
    interrogations = 0
    echecs = 0
    erreur.value = null
    attenteLongue.value = false
    if (id.value === null || termine.value) return
    minuteurLong = setTimeout(() => {
      attenteLongue.value = true
    }, ATTENTE_LONGUE_MS)
    void interroger()
  }

  /** Reprend le suivi après une erreur (bouton « Réessayer »). */
  function relancer(): void {
    demarrer()
  }

  /** Installe une génération déjà connue (réponse de `generer`) sans interroger le serveur pour rien. */
  function amorcer(connue: GenerationDTO): void {
    generation.value = connue
  }

  watch(id, (courant) => {
    if (generation.value && generation.value.id !== courant) generation.value = null
    if (import.meta.client) demarrer()
  }, { immediate: true })

  watch(visibilite, (valeur) => {
    // Retour sur l'onglet : on interroge tout de suite plutôt qu'à la prochaine échéance.
    if (valeur === 'visible' && minuteur !== null) planifier(0)
  })

  onScopeDispose(arreter)

  return { generation, statut, termine, enAttente, attenteLongue, erreur, relancer, amorcer }
}
