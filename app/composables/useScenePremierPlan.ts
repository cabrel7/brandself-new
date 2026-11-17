interface OptionsScenePremierPlan {
  /** Part de l'élément visible à partir de laquelle il est « au premier plan » (0 à 1). */
  seuil?: number
  auEntree: () => void
  auSortie: () => void
}

/**
 * Appelle `auEntree` quand l'élément passe au premier plan et `auSortie` quand il le quitte
 * (jamais deux fois de suite le même appel). L'observateur est retiré au démontage.
 * Sans IntersectionObserver (ou côté serveur), rien ne se déclenche : l'état de repos reste affiché.
 */
export function useScenePremierPlan(cible: Ref<HTMLElement | null>, options: OptionsScenePremierPlan) {
  const auPremierPlan = ref(false)
  let observateur: IntersectionObserver | null = null

  onMounted(() => {
    const element = cible.value
    if (!element || typeof IntersectionObserver === 'undefined') return
    observateur = new IntersectionObserver(
      (entrees) => {
        const entree = entrees[entrees.length - 1]
        if (!entree) return
        if (entree.isIntersecting && !auPremierPlan.value) {
          auPremierPlan.value = true
          options.auEntree()
        }
        else if (!entree.isIntersecting && auPremierPlan.value) {
          auPremierPlan.value = false
          options.auSortie()
        }
      },
      { threshold: options.seuil ?? 0.6 },
    )
    observateur.observe(element)
  })

  onBeforeUnmount(() => {
    observateur?.disconnect()
    observateur = null
  })

  return { auPremierPlan: readonly(auPremierPlan) }
}
