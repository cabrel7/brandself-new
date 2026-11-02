// Composables « témoignages » du studio : même contrat que services/réalisations/liens
// (lecture toujours fraîche, visibilité optimiste, réordonnancement souris ou clavier).
import { useSortable } from '@vueuse/integrations/useSortable'
import { nextTick, ref, computed, watch } from 'vue'
import type { TemoignageStudioDTO, TemoignagesStudioReponse } from '#shared/dto'

export const CLE_TEMOIGNAGES = 'studio-temoignages'
const cleTemoignage = (slug: string): string => `studio-temoignage-${slug}`

const ANIMATION_MS = 150
const ERREUR_VISIBILITE = 'Nous n’avons pas pu modifier la visibilité de ce témoignage. Réessayez dans un instant.'
const ERREUR_ORDRE = 'Nous n’avons pas pu enregistrer le nouvel ordre. Réessayez dans un instant.'
const ERREUR_ORDRE_OBSOLETE = 'L’ordre de vos témoignages a changé entre-temps. La liste a été rechargée : réessayez.'

/** Toujours une lecture fraîche à l’ouverture d’un écran : les écritures viennent d’autres écrans. */
const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

function enChargementDe(data: Ref<unknown>, error: Ref<unknown>, status: Ref<string>): ComputedRef<boolean> {
  return computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
}

/**
 * Liste des témoignages du studio : visibilité optimiste, réordonnancement par glisser (poignée)
 * ou clavier. `listeEl` : la liste (`ul`) à rendre triable.
 */
export function useStudioTemoignages(listeEl?: Ref<HTMLElement | null>) {
  const { data, status, error, refresh } = useFetch<TemoignagesStudioReponse>('/api/studio/temoignages', {
    key: CLE_TEMOIGNAGES,
    ...TOUJOURS_FRAIS,
  })

  const temoignages = ref<TemoignageStudioDTO[]>([])
  const message = ref('')
  const annonce = ref('')
  const occupes = ref<string[]>([])
  let dernierOrdreEnvoye: string[] = []

  watch(data, (reponse) => {
    if (!reponse) return
    temoignages.value = [...reponse.temoignages]
    dernierOrdreEnvoye = reponse.temoignages.map((ligne) => ligne.id)
  }, { immediate: true })

  const absente = computed(() => Boolean(error.value) && lireErreurApi(error.value).statut === 404)
  const enErreur = computed(() => Boolean(error.value) && !absente.value)
  const enChargement = enChargementDe(data, error, status)
  const vide = computed(() => Boolean(data.value) && temoignages.value.length === 0)

  // Le résumé suit les basculements optimistes ; le plafond vient toujours de la réponse serveur.
  const resume = computed(() => ({
    visibles: temoignages.value.filter((ligne) => ligne.actif).length,
    enVedette: temoignages.value.filter((ligne) => ligne.enVedette).length,
    vedetteMax: data.value?.compteurs.vedetteMax ?? 0,
  }))
  const compteurs = computed(() => error.value ? null : data.value?.compteurs ?? null)

  async function basculerVisibilite(id: string, actif: boolean): Promise<void> {
    const temoignage = temoignages.value.find((ligne) => ligne.id === id)
    if (!temoignage || occupes.value.includes(id)) return
    const avant = { actif: temoignage.actif, enVedette: temoignage.enVedette }
    message.value = ''
    occupes.value = [...occupes.value, id]
    temoignage.actif = actif
    if (!actif) temoignage.enVedette = false
    try {
      const body = actif ? { actif: true } : { actif: false, enVedette: false }
      await $fetch(`/api/studio/temoignages/${temoignage.slug}`, { method: 'PUT', body })
      await refresh()
    }
    catch {
      temoignage.actif = avant.actif
      temoignage.enVedette = avant.enVedette
      message.value = ERREUR_VISIBILITE
    }
    finally {
      occupes.value = occupes.value.filter((courant) => courant !== id)
    }
  }

  function annoncerPosition(auteur: string, index: number): void {
    annonce.value = `${auteur} : position ${index + 1} sur ${temoignages.value.length}.`
  }

  // Les envois d’ordre sont sérialisés : chacun part de l’état de la liste à son tour.
  let file: Promise<void> = Promise.resolve()

  async function envoyerOrdre(): Promise<void> {
    const ids = temoignages.value.map((ligne) => ligne.id)
    if (ids.join() === dernierOrdreEnvoye.join()) return
    try {
      await $fetch('/api/studio/temoignages/reordonner', { method: 'POST', body: { ids } })
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
    const index = temoignages.value.findIndex((ligne) => ligne.id === id)
    const cible = index + sens
    const courant = temoignages.value[index]
    const voisin = temoignages.value[cible]
    if (!courant || !voisin) return
    const copie = [...temoignages.value]
    copie[index] = voisin
    copie[cible] = courant
    temoignages.value = copie
    annoncerPosition(courant.auteur, cible)
    enregistrerOrdre()
    // Le déplacement du nœud fait perdre le focus à la poignée : on le lui rend.
    await nextTick()
    listeEl?.value?.querySelector<HTMLElement>(`[data-poignee="${id}"]`)?.focus()
  }

  if (listeEl) {
    const animationReduite = useMediaQuery('(prefers-reduced-motion: reduce)')
    useSortable(listeEl, temoignages, {
      handle: '[data-poignee]',
      animation: animationReduite.value ? 0 : ANIMATION_MS,
      watchElement: true,
      onEnd: (evenement) => {
        // Souris ou toucher : même annonce que le clavier (le tableau est déjà réordonné par useSortable).
        const { oldIndex, newIndex } = evenement
        const deplace = newIndex === undefined ? undefined : temoignages.value[newIndex]
        if (deplace && oldIndex !== newIndex && newIndex !== undefined) annoncerPosition(deplace.auteur, newIndex)
        enregistrerOrdre()
      },
    })
  }

  return {
    temoignages, compteurs, resume, enChargement, enErreur, absente, vide, refresh,
    message, annonce, occupes, basculerVisibilite, deplacer,
  }
}

/** Un témoignage du studio, chargé par son slug (l’API descriptif est en slug, pas en id). */
export function useStudioTemoignage(slug: string) {
  const { data, status, error, refresh } = useFetch<{ temoignage: TemoignageStudioDTO }>(`/api/studio/temoignages/${slug}`, {
    key: cleTemoignage(slug),
    ...TOUJOURS_FRAIS,
  })
  // La route [slug] renvoie un 404 simple (sans code métier) ; le code est lu par défaut.
  const introuvable = computed(() => {
    if (!error.value) return false
    const api = lireErreurApi(error.value)
    return api.statut === 404 || api.code === 'TEMOINAGE_INTROUVABLE'
  })

  return {
    temoignage: computed(() => data.value?.temoignage ?? null),
    enChargement: enChargementDe(data, error, status),
    enErreur: computed(() => Boolean(error.value) && !data.value && !introuvable.value),
    introuvable,
    refresh,
  }
}
