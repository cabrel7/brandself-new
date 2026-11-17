import { ADMIN_LISTE_LIMITE_DEFAUT } from '#shared/admin'
import { RECHERCHE_DELAI_MS, saisieTropCourte, termeRecherche } from '~/utils/admin-a2'
import { lirePage } from '~/utils/admin-paiements'

type ValeurQuery = string | null | Array<string | null> | undefined
type Validateur = (valeur: string) => boolean

interface OptionsListe {
  chemin: string
  cle: string
  /** Filtres lus dans l'URL : nom -> validateur. Une valeur refusée est ignorée (le serveur reste le seul juge). */
  filtres: Record<string, Validateur>
}

const premiere = (valeur: ValeurQuery): string | undefined => {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return typeof brut === 'string' && brut !== '' ? brut : undefined
}

/**
 * Liste paginée côté serveur d'administration (A2) : recherche (anti-rebond, 3 caractères minimum), filtres et page
 * vivent dans l'URL (lien partageable, retour arrière). Aucune règle métier : paramètres et affichage.
 */
export function useAdminListe<T>(options: OptionsListe) {
  const route = useRoute()
  const router = useRouter()

  const filtres = computed(() => {
    const lus: Record<string, string> = {}
    for (const [nom, valide] of Object.entries(options.filtres)) {
      const valeur = premiere(route.query[nom])
      if (valeur !== undefined && valide(valeur)) lus[nom] = valeur
    }
    return lus
  })
  const page = computed(() => lirePage(route.query.page))
  const params = computed(() => ({ ...filtres.value, page: page.value, limite: ADMIN_LISTE_LIMITE_DEFAUT }))

  const { data, status, error, refresh } = useFetch<T>(options.chemin, {
    key: options.cle,
    server: false,
    lazy: true,
    query: params,
  })
  surveillerSessionAdmin(error)

  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const actualisation = computed(() => status.value === 'pending' && data.value !== undefined && data.value !== null)
  const filtresActifs = computed(() => Object.keys(filtres.value).length > 0)

  async function maj(patch: Record<string, string | undefined>): Promise<void> {
    const brut = { ...filtres.value, ...patch }
    const query: Record<string, string> = {}
    for (const [nom, valeur] of Object.entries(brut)) {
      if (valeur !== undefined && valeur !== '') query[nom] = valeur
    }
    // Un changement de filtre ramène à la première page (`page` n'est jamais relue de l'URL ici) ; la page 1 s'omet.
    if (patch.page === '1') delete query.page
    await router.replace({ query })
  }

  async function changerPage(numero: number): Promise<void> {
    await maj({ page: String(numero) })
  }

  // Recherche : champ local, envoyé après 300 ms et seulement à partir de 3 caractères.
  const saisie = ref(premiere(route.query.q) ?? '')
  const tropCourte = computed(() => saisieTropCourte(saisie.value))
  watchDebounced(saisie, async (valeur) => {
    const terme = termeRecherche(valeur)
    if (terme !== null) {
      if (terme !== filtres.value.q) await maj({ q: terme })
    } else if (valeur.trim() === '' && filtres.value.q !== undefined) {
      await maj({ q: undefined })
    }
  }, { debounce: RECHERCHE_DELAI_MS })

  // Retour arrière ou lien partagé : le champ suit l'URL.
  watch(() => filtres.value.q, (q) => {
    if ((q ?? '') !== (termeRecherche(saisie.value) ?? '')) saisie.value = q ?? ''
  })

  async function reinitialiser(): Promise<void> {
    saisie.value = ''
    await router.replace({ query: {} })
  }

  return {
    data, status, error, refresh, enChargement, actualisation, filtres, filtresActifs, page,
    saisie, tropCourte, maj, changerPage, reinitialiser,
  }
}
