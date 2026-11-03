import type { LimitePlanDTO } from '#shared/dto'
import { RESSOURCES_QUOTA } from '#shared/plans'
import type { RessourceQuota } from '#shared/plans'

/** Limite du plan atteinte : de quoi composer UN seul message (`StudioLimitePlanMessage`). */
export interface LimiteAtteinte {
  ressource: RessourceQuota
  limite: number | null
}

function estRessource(valeur: unknown): valeur is RessourceQuota {
  return (RESSOURCES_QUOTA as readonly unknown[]).includes(valeur)
}

/**
 * Lit un 403 `LIMITE_PLAN_ATTEINTE` (`data: { ressource, limite, utilise, plan }`). `null` pour toute autre erreur.
 * `ressourceDeRepli` : la ressource de l'écran, si le serveur ne la renvoie pas.
 */
export function lireLimitePlan(erreur: unknown, ressourceDeRepli: RessourceQuota): LimiteAtteinte | null {
  const api = lireErreurApi(erreur)
  if (api.code !== 'LIMITE_PLAN_ATTEINTE') return null
  const { ressource, limite } = api.donnees
  return {
    ressource: estRessource(ressource) ? ressource : ressourceDeRepli,
    limite: typeof limite === 'number' ? limite : null,
  }
}

/**
 * Bouton « Ajouter » des listes (services, réalisations, témoignages) : quand la limite du plan est atteinte,
 * le clic affiche le message de limite à la place d'ouvrir le formulaire. `limitePlan` vient du compteur de la liste.
 */
export function useLimiteAjout(limitePlan: Ref<LimitePlanDTO | null | undefined>) {
  const atteinte = computed(() => limitePlan.value?.atteinte === true)
  const limite = computed(() => limitePlan.value?.limite ?? null)
  const affichee = ref(false)

  // Une place se libère (élément supprimé ou masqué) : le message n'a plus lieu d'être.
  watch(atteinte, (valeur) => {
    if (!valeur) affichee.value = false
  })

  /** Au clic sur « Ajouter » : `true` si la navigation peut continuer. */
  function tenter(): boolean {
    if (!atteinte.value) return true
    affichee.value = true
    return false
  }

  return { atteinte, limite, affichee, tenter }
}

/** Quota mensuel d'une ressource, lu dans l'abonnement (écran sans bouton d'action : Agenda). */
export function useQuotaAtteint(ressource: RessourceQuota) {
  const { abonnement } = useAbonnement()
  const quota = computed(() => abonnement.value?.quotas.find((q) => q.ressource === ressource) ?? null)
  const limite = computed(() => quota.value?.limite ?? null)
  const atteinte = computed(() => quota.value !== null && quota.value.limite !== null && quota.value.utilise >= quota.value.limite)
  return { atteinte, limite }
}
