import { ADMIN_PREFIXE_API } from '#shared/admin'
import type { RechercheDto } from '#shared/schemas/admin-a2'
import { RECHERCHE_DELAI_MS, messageDepuisErreurApi, saisieTropCourte, termeRecherche } from '~/utils/admin-a2'

/** Recherche globale (comptes et vitrines) : anti-rebond 300 ms, 3 caractères minimum, dernière requête seule gagnante. */
export function useAdminRecherche() {
  const saisie = ref('')
  const resultats = ref<RechercheDto | null>(null)
  const enCours = ref(false)
  const erreur = ref('')
  const { expirer } = useAdminSession()
  let derniere = 0

  const tropCourte = computed(() => saisieTropCourte(saisie.value))
  const sansResultat = computed(() => resultats.value !== null && resultats.value.utilisateurs.length === 0 && resultats.value.vitrines.length === 0)

  async function chercher(valeur: string): Promise<void> {
    const terme = termeRecherche(valeur)
    derniere += 1
    const numero = derniere
    erreur.value = ''
    if (terme === null) {
      resultats.value = null
      enCours.value = false
      return
    }
    enCours.value = true
    try {
      const reponse = await $fetch<RechercheDto>(`${ADMIN_PREFIXE_API}/recherche`, { query: { q: terme } })
      if (numero === derniere) resultats.value = reponse
    } catch (e) {
      if (numero !== derniere) return
      const lue = lireErreurApi(e)
      if (lue.statut === 404 && lue.code === null) void expirer()
      resultats.value = null
      erreur.value = messageDepuisErreurApi(e)
    } finally {
      if (numero === derniere) enCours.value = false
    }
  }

  watchDebounced(saisie, chercher, { debounce: RECHERCHE_DELAI_MS })

  function reinitialiser(): void {
    derniere += 1
    saisie.value = ''
    resultats.value = null
    erreur.value = ''
    enCours.value = false
  }

  return { saisie, resultats, enCours, erreur, tropCourte, sansResultat, reinitialiser }
}
