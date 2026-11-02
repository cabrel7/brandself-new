import { USERNAME_DEBOUNCE_MS } from '#shared/onboarding'
import { isReserved } from '#shared/reserved'
import { validateUsername } from '#shared/schemas/username'

export type EtatUsername = 'vide' | 'verification' | 'libre' | 'pris' | 'reserve' | 'format' | 'erreur'

type RaisonDisponibilite = 'libre' | 'actuel' | 'pris' | 'reserve' | 'format'

interface ReponseDisponibilite {
  username: string
  disponible: boolean
  raison: RaisonDisponibilite
}

const ETAT_PAR_RAISON: Record<RaisonDisponibilite, EtatUsername> = {
  libre: 'libre',
  actuel: 'libre',
  pris: 'pris',
  reserve: 'reserve',
  format: 'format',
}

/**
 * Vérifie en direct (après une courte pause de saisie) qu'une adresse est utilisable.
 * Une valeur déjà présente à l'appel (adresse suggérée) est vérifiée aussi.
 */
export function useUsernameDisponible(username: Ref<string>) {
  const etat = ref<EtatUsername>('vide')
  let sequence = 0

  watch(username, (valeur) => {
    sequence += 1
    etat.value = valeur.trim() === '' ? 'vide' : 'verification'
  }, { immediate: true })

  watchDebounced(
    username,
    async (valeur) => {
      const candidat = valeur.trim().toLowerCase()
      if (candidat === '') return
      const courante = sequence

      if (isReserved(candidat)) {
        etat.value = 'reserve'
        return
      }
      if (!validateUsername(candidat).success) {
        etat.value = 'format'
        return
      }

      try {
        const reponse = await $fetch<ReponseDisponibilite>('/api/studio/username-disponible', {
          query: { username: candidat },
        })
        if (courante === sequence) etat.value = ETAT_PAR_RAISON[reponse.raison]
      } catch {
        if (courante === sequence) etat.value = 'erreur'
      }
    },
    { debounce: USERNAME_DEBOUNCE_MS, immediate: true },
  )

  return { etat }
}
