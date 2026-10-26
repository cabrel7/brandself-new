import { useSortable } from '@vueuse/integrations/useSortable'
import type { ServiceStudioDTO, ServiceStudioReponse, ServicesStudioReponse } from '#shared/dto'

export const CLE_SERVICES = 'studio-services'
const cleService = (id: string): string => `studio-service-${id}`

const ANIMATION_MS = 150
const ERREUR_VISIBILITE = 'Nous n’avons pas pu modifier la visibilité de ce service. Réessayez dans un instant.'
const ERREUR_ORDRE = 'Nous n’avons pas pu enregistrer le nouvel ordre. Réessayez dans un instant.'
const ERREUR_ORDRE_OBSOLETE = 'L’ordre de vos services a changé entre-temps. La liste a été rechargée : réessayez.'

/** Toujours une lecture fraîche à l'ouverture d'un écran : les écritures viennent d'autres écrans. */
const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

function enChargementDe(data: Ref<unknown>, error: Ref<unknown>, status: Ref<string>): ComputedRef<boolean> {
  return computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
}

/**
 * Liste des services du studio : visibilité optimiste, réordonnancement par
 * glisser (poignée) ou clavier. `listeEl` : la liste (`ul`) à rendre triable.
 */
export function useStudioServices(listeEl?: Ref<HTMLElement | null>) {
  const { data, status, error, refresh } = useFetch<ServicesStudioReponse>('/api/studio/services', {
    key: CLE_SERVICES,
    ...TOUJOURS_FRAIS,
  })

  const services = ref<ServiceStudioDTO[]>([])
  const message = ref('')
  const annonce = ref('')
  const occupes = ref<string[]>([])
  let dernierOrdreEnvoye: string[] = []

  watch(data, (reponse) => {
    if (!reponse) return
    services.value = [...reponse.services]
    dernierOrdreEnvoye = reponse.services.map((s) => s.id)
  }, { immediate: true })

  const absente = computed(() => Boolean(error.value) && lireErreurApi(error.value).statut === 404)
  const enErreur = computed(() => Boolean(error.value) && !absente.value && !data.value)
  const enChargement = enChargementDe(data, error, status)
  const vide = computed(() => Boolean(data.value) && services.value.length === 0)

  // Dérivés de la liste locale : suivent les basculements optimistes.
  const resume = computed(() => ({
    visibles: services.value.filter((s) => s.actif).length,
    enVedette: services.value.filter((s) => s.actif && s.enVedette).length,
    vedetteMax: data.value?.compteurs.vedetteMax ?? 0,
  }))

  async function basculerVisibilite(id: string, actif: boolean): Promise<void> {
    const service = services.value.find((s) => s.id === id)
    if (!service || occupes.value.includes(id)) return
    const avant = { actif: service.actif, enVedette: service.enVedette }
    message.value = ''
    occupes.value = [...occupes.value, id]
    service.actif = actif
    // Masquer retire la vedette (règle serveur) : l'écran suit sans attendre.
    if (!actif) service.enVedette = false
    try {
      await $fetch(`/api/studio/services/${id}`, { method: 'PUT', body: { actif } })
      await refresh()
    }
    catch {
      service.actif = avant.actif
      service.enVedette = avant.enVedette
      message.value = ERREUR_VISIBILITE
    }
    finally {
      occupes.value = occupes.value.filter((courant) => courant !== id)
    }
  }

  function annoncerPosition(titre: string, index: number): void {
    annonce.value = `${titre} : position ${index + 1} sur ${services.value.length}.`
  }

  // Les envois d'ordre sont sérialisés : chacun part de l'état de la liste à son tour.
  let file: Promise<void> = Promise.resolve()

  async function envoyerOrdre(): Promise<void> {
    const ids = services.value.map((s) => s.id)
    if (ids.join() === dernierOrdreEnvoye.join()) return
    try {
      await $fetch('/api/studio/services/reordonner', { method: 'POST', body: { ids } })
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
    const index = services.value.findIndex((s) => s.id === id)
    const cible = index + sens
    const courant = services.value[index]
    const voisin = services.value[cible]
    if (!courant || !voisin) return
    const copie = [...services.value]
    copie[index] = voisin
    copie[cible] = courant
    services.value = copie
    annoncerPosition(courant.titre, cible)
    enregistrerOrdre()
    // Le déplacement du nœud fait perdre le focus à la poignée : on le lui rend.
    await nextTick()
    listeEl?.value?.querySelector<HTMLElement>(`[data-poignee="${id}"]`)?.focus()
  }

  if (listeEl) {
    const animationReduite = useMediaQuery('(prefers-reduced-motion: reduce)')
    useSortable(listeEl, services, {
      handle: '[data-poignee]',
      animation: animationReduite.value ? 0 : ANIMATION_MS,
      watchElement: true,
      onEnd: (evenement) => {
        // Souris ou toucher : même annonce que le clavier (le tableau est déjà réordonné par useSortable).
        const { oldIndex, newIndex } = evenement
        const deplace = newIndex === undefined ? undefined : services.value[newIndex]
        if (deplace && oldIndex !== newIndex && newIndex !== undefined) annoncerPosition(deplace.titre, newIndex)
        enregistrerOrdre()
      },
    })
  }

  return {
    services, resume, enChargement, enErreur, absente, vide, refresh,
    message, annonce, occupes, basculerVisibilite, deplacer,
    compteurs: computed(() => data.value?.compteurs ?? null),
  }
}

/** Un service du studio et les compteurs de la vitrine (nécessaires à l'interrupteur « En vedette »). */
export function useStudioService(id: string) {
  const { data, status, error, refresh } = useFetch<ServiceStudioReponse>(`/api/studio/services/${id}`, {
    key: cleService(id),
    ...TOUJOURS_FRAIS,
  })
  const code = computed(() => (error.value ? lireErreurApi(error.value).code : null))
  // Un identifiant qui n'est pas un uuid (400) ne désigne aucun service : même écran.
  const introuvable = computed(() =>
    code.value === 'SERVICE_INTROUVABLE' || (error.value ? lireErreurApi(error.value).statut === 400 : false),
  )
  const sansVitrine = computed(() => code.value === 'VITRINE_INTROUVABLE')

  return {
    service: computed(() => data.value?.service ?? null),
    compteurs: computed(() => data.value?.compteurs ?? null),
    enChargement: enChargementDe(data, error, status),
    enErreur: computed(() => Boolean(error.value) && !data.value && !introuvable.value && !sansVitrine.value),
    introuvable,
    sansVitrine,
    refresh,
  }
}
