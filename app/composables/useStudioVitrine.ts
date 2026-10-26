import type { StudioResumeDTO, VitrineStudioDTO } from '#shared/dto'

export interface ReponseVitrine {
  vitrine: VitrineStudioDTO
  resume: StudioResumeDTO
}

export const LIBELLES_CHAMPS_PUBLICATION: Record<string, string> = {
  prenom: 'prénom',
  nom: 'nom',
  metier: 'métier',
  ville: 'ville',
  pays: 'pays',
}

export function libelleChampsManquants(manquants: readonly string[]): string {
  return manquants.map((champ) => LIBELLES_CHAMPS_PUBLICATION[champ] ?? champ).join(', ')
}

export type ResultatPublication =
  | { ok: true }
  | { ok: false, manquants: string[], message: string }

const ERREUR_PUBLICATION = 'Nous n’avons pas pu publier votre vitrine. Réessayez dans un instant.'
const ERREUR_DEPUBLICATION = 'Nous n’avons pas pu dépublier votre vitrine. Réessayez dans un instant.'

/**
 * Vitrine du studio et son résumé (clé partagée : layout, accueil et profil
 * lisent la même donnée). Studio sans rendu serveur : le chargement est client.
 */
export function useStudioVitrine() {
  const { data, status, error, refresh } = useFetch<ReponseVitrine>('/api/studio/vitrine', {
    key: 'studio-vitrine',
    server: false,
    lazy: true,
  })

  const vitrine = computed(() => data.value?.vitrine ?? null)
  const resume = computed(() => data.value?.resume ?? null)
  const absente = computed(() => error.value !== undefined && error.value !== null && lireErreurApi(error.value).statut === 404)
  const enErreur = computed(() => error.value !== undefined && error.value !== null && !absente.value)
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))

  const publicationEnCours = ref(false)

  async function changerPublication(action: 'publier' | 'depublier'): Promise<ResultatPublication> {
    publicationEnCours.value = true
    try {
      await $fetch(`/api/studio/vitrine/${action}`, { method: 'POST' })
      await refresh()
      return { ok: true }
    } catch (e) {
      const erreur = lireErreurApi(e)
      if (erreur.code === 'PUBLICATION_INCOMPLETE') {
        return {
          ok: false,
          manquants: erreur.manquants,
          message: `Il manque encore : ${libelleChampsManquants(erreur.manquants) || 'des informations'}. Complétez votre profil pour publier.`,
        }
      }
      return { ok: false, manquants: [], message: action === 'publier' ? ERREUR_PUBLICATION : ERREUR_DEPUBLICATION }
    } finally {
      publicationEnCours.value = false
    }
  }

  return { vitrine, resume, enChargement, enErreur, absente, refresh, publicationEnCours, changerPublication }
}
