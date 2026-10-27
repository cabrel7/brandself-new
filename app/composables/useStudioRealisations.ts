import { useSortable } from '@vueuse/integrations/useSortable'
import type { RealisationStudioDTO, RealisationStudioReponse, RealisationsStudioReponse } from '#shared/dto'

export const CLE_REALISATIONS = 'studio-realisations'
const cleRealisation = (id: string): string => `studio-realisation-${id}`

const ANIMATION_MS = 150
const ERREUR_VISIBILITE = 'Nous n’avons pas pu modifier la visibilité de cette réalisation. Réessayez dans un instant.'
const ERREUR_ORDRE = 'Nous n’avons pas pu enregistrer le nouvel ordre. Réessayez dans un instant.'
const ERREUR_ORDRE_OBSOLETE = 'L’ordre de vos réalisations a changé entre-temps. La liste a été rechargée : réessayez.'

/** Toujours une lecture fraîche à l'ouverture d'un écran : les écritures viennent d'autres écrans. */
const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

function enChargementDe(data: Ref<unknown>, error: Ref<unknown>, status: Ref<string>): ComputedRef<boolean> {
  return computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
}

/**
 * Liste des réalisations du studio : visibilité optimiste, réordonnancement par
 * glisser (poignée) ou clavier. `listeEl` : la liste (`ul`) à rendre triable.
 * Duplication assumée avec useStudioServices (factorisation prévue au 3e usage, S5).
 */
export function useStudioRealisations(listeEl?: Ref<HTMLElement | null>) {
  const { data, status, error, refresh } = useFetch<RealisationsStudioReponse>('/api/studio/realisations', {
    key: CLE_REALISATIONS,
    ...TOUJOURS_FRAIS,
  })

  const realisations = ref<RealisationStudioDTO[]>([])
  const message = ref('')
  const annonce = ref('')
  const occupes = ref<string[]>([])
  let dernierOrdreEnvoye: string[] = []

  watch(data, (reponse) => {
    if (!reponse) return
    realisations.value = [...reponse.realisations]
    dernierOrdreEnvoye = reponse.realisations.map((r) => r.id)
  }, { immediate: true })

  const absente = computed(() => Boolean(error.value) && lireErreurApi(error.value).statut === 404)
  const enErreur = computed(() => Boolean(error.value) && !absente.value && !data.value)
  const enChargement = enChargementDe(data, error, status)
  const vide = computed(() => Boolean(data.value) && realisations.value.length === 0)

  // Dérivés de la liste locale : suivent les basculements optimistes.
  const resume = computed(() => ({
    visibles: realisations.value.filter((r) => r.actif).length,
    enVedette: realisations.value.filter((r) => r.actif && r.enVedette).length,
    vedetteMax: data.value?.compteurs.vedetteMax ?? 0,
  }))

  async function basculerVisibilite(id: string, actif: boolean): Promise<void> {
    const realisation = realisations.value.find((r) => r.id === id)
    if (!realisation || occupes.value.includes(id)) return
    const avant = { actif: realisation.actif, enVedette: realisation.enVedette }
    message.value = ''
    occupes.value = [...occupes.value, id]
    realisation.actif = actif
    // Masquer retire la vedette (règle serveur) : l'écran suit sans attendre.
    if (!actif) realisation.enVedette = false
    try {
      await $fetch(`/api/studio/realisations/${id}`, { method: 'PUT', body: { actif } })
      await refresh()
    }
    catch {
      realisation.actif = avant.actif
      realisation.enVedette = avant.enVedette
      message.value = ERREUR_VISIBILITE
    }
    finally {
      occupes.value = occupes.value.filter((courant) => courant !== id)
    }
  }

  function annoncerPosition(titre: string, index: number): void {
    annonce.value = `${titre} : position ${index + 1} sur ${realisations.value.length}.`
  }

  // Les envois d'ordre sont sérialisés : chacun part de l'état de la liste à son tour.
  let file: Promise<void> = Promise.resolve()

  async function envoyerOrdre(): Promise<void> {
    const ids = realisations.value.map((r) => r.id)
    if (ids.join() === dernierOrdreEnvoye.join()) return
    try {
      await $fetch('/api/studio/realisations/reordonner', { method: 'POST', body: { ids } })
      dernierOrdreEnvoye = ids
    }
    catch (e) {
      message.value = lireErreurApi(e).code === 'ORDRE_INVALIDE' ? ERREUR_ORDRE_OBSOLETE : ERREUR_ORDRE
      await refresh()
    }
  }

  function enregistrerOrdre(): void {
    message.value = ''
    file = file.then(envoyerOrdre)
  }

  /** Clavier : flèche haut ou bas sur la poignée. */
  async function deplacer(id: string, sens: -1 | 1): Promise<void> {
    const index = realisations.value.findIndex((r) => r.id === id)
    const cible = index + sens
    const courant = realisations.value[index]
    const voisin = realisations.value[cible]
    if (!courant || !voisin) return
    const copie = [...realisations.value]
    copie[index] = voisin
    copie[cible] = courant
    realisations.value = copie
    annoncerPosition(courant.titre, cible)
    enregistrerOrdre()
    // Le déplacement du nœud fait perdre le focus à la poignée : on le lui rend.
    await nextTick()
    listeEl?.value?.querySelector<HTMLElement>(`[data-poignee="${id}"]`)?.focus()
  }

  if (listeEl) {
    const animationReduite = useMediaQuery('(prefers-reduced-motion: reduce)')
    useSortable(listeEl, realisations, {
      handle: '[data-poignee]',
      animation: animationReduite.value ? 0 : ANIMATION_MS,
      watchElement: true,
      onEnd: (evenement) => {
        // Souris ou toucher : même annonce que le clavier (le tableau est déjà réordonné par useSortable).
        const { oldIndex, newIndex } = evenement
        const deplace = newIndex === undefined ? undefined : realisations.value[newIndex]
        if (deplace && oldIndex !== newIndex && newIndex !== undefined) annoncerPosition(deplace.titre, newIndex)
        enregistrerOrdre()
      },
    })
  }

  return {
    realisations, resume, enChargement, enErreur, absente, vide, refresh,
    message, annonce, occupes, basculerVisibilite, deplacer,
    compteurs: computed(() => data.value?.compteurs ?? null),
  }
}

/** Une réalisation du studio et les compteurs de la vitrine (nécessaires à l'interrupteur « En vedette »). */
export function useStudioRealisation(id: string) {
  const { data, status, error, refresh } = useFetch<RealisationStudioReponse>(`/api/studio/realisations/${id}`, {
    key: cleRealisation(id),
    ...TOUJOURS_FRAIS,
  })
  const code = computed(() => (error.value ? lireErreurApi(error.value).code : null))
  // Un identifiant qui n'est pas un uuid (400) ne désigne aucune réalisation : même écran.
  const introuvable = computed(() =>
    code.value === 'REALISATION_INTROUVABLE' || (error.value ? lireErreurApi(error.value).statut === 400 : false),
  )
  const sansVitrine = computed(() => code.value === 'VITRINE_INTROUVABLE')

  return {
    realisation: computed(() => data.value?.realisation ?? null),
    compteurs: computed(() => data.value?.compteurs ?? null),
    enChargement: enChargementDe(data, error, status),
    enErreur: computed(() => Boolean(error.value) && !data.value && !introuvable.value && !sansVitrine.value),
    introuvable,
    sansVitrine,
    refresh,
  }
}
