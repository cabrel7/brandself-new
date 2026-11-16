import type { ReferentielsDto } from '#shared/schemas/admin-catalogues'
import { REFERENTIELS_CHEMIN } from '~/utils/referentiels'

/**
 * Pays, indicatifs et canaux ouverts, lus sur les référentiels publics (cache serveur de 60 s). Une erreur de lecture
 * n'est pas affichée : `referentiels` vaut `null` et les pages retombent sur les listes du code.
 */
export function useReferentiels() {
  const { data } = useFetch<ReferentielsDto | null>(REFERENTIELS_CHEMIN, {
    key: 'referentiels-publics',
    default: () => null,
  })
  const referentiels = computed(() => data.value ?? null)
  return { referentiels }
}
