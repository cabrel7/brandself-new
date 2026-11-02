// Composables « liens » du studio (S6) : même contrat que services/réalisations
// (lecture toujours fraîche, visibilité optimiste, réordonnancement souris ou clavier).
import { useSortable } from '@vueuse/integrations/useSortable'
import { nextTick, ref, computed, watch } from 'vue'
import type { LienStudioDTO, LiensCompteursDTO, LiensStudioReponse } from '#shared/dto'

const CLE_LIENS = 'studio-liens'
const cleLien = (id: string): string => `studio-lien-${id}`

const ANIMATION_MS = 150
const ERREUR_VISIBILITE = 'Nous n’avons pas pu modifier la visibilité de ce lien. Réessayez dans un instant.'
const ERREUR_ORDRE = 'Nous n’avons pas pu enregistrer le nouvel ordre. Réessayez dans un instant.'
const ERREUR_ORDRE_OBSOLETE = 'L’ordre de vos liens a changé entre-temps. La liste a été rechargée : réessayez.'

/** Toujours une lecture fraîche à l’ouverture d’un écran : les écritures viennent d’autres écrans. */
const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

function enChargementDe(data: Ref<unknown>, error: Ref<unknown>, status: Ref<string>): ComputedRef<boolean> {
  return computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
}

/**
 * Liste des liens du studio : visibilité optimiste, réordonnancement par glisser (poignée)
 * ou clavier. `listeEl` : la liste (`ul`) à rendre triable.
 */
export function useStudioLiens(listeEl?: Ref<HTMLElement | null>) {
  const { data, status, error, refresh } = useFetch<LiensStudioReponse>('/api/studio/liens', {
    key: CLE_LIENS,
    ...TOUJOURS_FRAIS,
  })

  const liens = ref<LienStudioDTO[]>([])
  const message = ref('')
  const annonce = ref('')
  const occupes = ref<string[]>([])
  let dernierOrdreEnvoye: string[] = []

  watch(data, (reponse) => {
    if (!reponse) return
    liens.value = [...reponse.liens]
    dernierOrdreEnvoye = reponse.liens.map((ligne) => ligne.id)
  }, { immediate: true })

  const absente = computed(() => Boolean(error.value) && lireErreurApi(error.value).statut === 404)
  const enErreur = computed(() => Boolean(error.value) && !absente.value && !data.value)
  const enChargement = enChargementDe(data, error, status)
  const vide = computed(() => Boolean(data.value) && liens.value.length === 0)

  const resume = computed(() => ({
    visibles: liens.value.filter((ligne) => ligne.actif).length,
    clicsSemaine: (data.value?.compteurs as LiensCompteursDTO)?.clicsSemaine ?? 0,
  }))

  function annoncerPosition(titre: string, index: number): void {
    annonce.value = `${titre} : position ${index + 1} sur ${liens.value.length}.`
  }

  async function basculerVisibilite(id: string, actif: boolean): Promise<void> {
    const lien = liens.value.find((ligne) => ligne.id === id)
    if (!lien || occupes.value.includes(id)) return
    const avant = lien.actif
    message.value = ''
    occupes.value = [...occupes.value, id]
    lien.actif = actif
    try {
      await $fetch(`/api/studio/liens/${id}`, { method: 'PUT', body: { actif } })
      await refresh()
    }
    catch {
      lien.actif = avant
      message.value = ERREUR_VISIBILITE
    }
    finally {
      occupes.value = occupes.value.filter((courant) => courant !== id)
    }
  }

  // Les envois d’ordre sont sérialisés : chacun part de l’état de la liste à son tour.
  let file: Promise<void> = Promise.resolve()

  async function envoyerOrdre(): Promise<void> {
    const ids = liens.value.map((ligne) => ligne.id)
    if (ids.join() === dernierOrdreEnvoye.join()) return
    try {
      await $fetch('/api/studio/liens/reordonner', { method: 'POST', body: { ids } })
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
    const index = liens.value.findIndex((ligne) => ligne.id === id)
    const cible = index + sens
    const courant = liens.value[index]
    const voisin = liens.value[cible]
    if (!courant || !voisin) return
    const copie = [...liens.value]
    copie[index] = voisin
    copie[cible] = courant
    liens.value = copie
    annoncerPosition(courant.libelle, cible)
    enregistrerOrdre()
    await nextTick()
    listeEl?.value?.querySelector<HTMLElement>(`[data-poignee="${id}"]`)?.focus()
  }

  if (listeEl) {
    const animationReduite = useMediaQuery('(prefers-reduced-motion: reduce)')
    useSortable(listeEl, liens, {
      handle: '[data-poignee]',
      animation: animationReduite.value ? 0 : ANIMATION_MS,
      watchElement: true,
      onEnd: (evenement) => {
        const deplace = evenement.newIndex === undefined ? undefined : liens.value[evenement.newIndex]
        if (deplace && evenement.oldIndex !== evenement.newIndex && evenement.newIndex !== undefined) annoncerPosition(deplace.libelle, evenement.newIndex)
        enregistrerOrdre()
      },
    })
  }

  return {
    liens, resume, enChargement, enErreur, absente, vide, refresh,
    message, annonce, occupes, basculerVisibilite, deplacer,
    compteurs: computed(() => (data.value?.compteurs as LiensCompteursDTO) ?? null),
  }
}

/** Un lien du studio et les compteurs de la vitrine (pour l’éditeur). */
export function useStudioLien(id: string) {
  const { data, status, error, refresh } = useFetch<{ lien: LienStudioDTO }>(`/api/studio/liens/${id}`, {
    key: cleLien(id),
    ...TOUJOURS_FRAIS,
  })
  const code = computed(() => (error.value ? lireErreurApi(error.value).code : null))
  const introuvable = computed(() =>
    code.value === 'LIEN_INTROUVABLE' || (error.value ? lireErreurApi(error.value).statut === 400 : false),
  )

  return {
    lien: computed(() => data.value?.lien ?? null),
    enChargement: enChargementDe(data, error, status),
    enErreur: computed(() => Boolean(error.value) && !data.value && !introuvable.value),
    introuvable,
    refresh,
  }
}
