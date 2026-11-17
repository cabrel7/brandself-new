import { ADMIN_LISTE_LIMITE_DEFAUT, ADMIN_PREFIXE_API } from '#shared/admin'
import type { AdminCatalogue } from '#shared/admin'
import type { ListeCatalogueDto } from '#shared/schemas/admin-catalogues'
import { lireOngletCatalogue } from '~/utils/admin-catalogues'
import { lirePage } from '~/utils/admin-paiements'
import type { ResultatEcriture } from '~/composables/useAdminEcriture'

/** Confirmation d'une écriture : motif, code de réauthentification et clé d'idempotence de l'intention. */
export interface ConfirmationEcriture {
  motif: string
  code: string
  cle: string
}

interface ReponseEcriture {
  rejoue: boolean
}

/**
 * Catalogues d'administration (A5) : onglet et page dans l'URL (lien partageable), lecture de
 * `GET /api/admin/catalogues/[nom]`. Aucune règle métier : le serveur valide et décide.
 */
export function useAdminCatalogues() {
  const route = useRoute()
  const router = useRouter()
  const onglet = computed<AdminCatalogue>(() => lireOngletCatalogue(route.query.onglet))
  const page = computed(() => lirePage(route.query.page))

  const { data, status, error, refresh } = useFetch<ListeCatalogueDto>(
    () => `${ADMIN_PREFIXE_API}/catalogues/${onglet.value}`,
    {
      server: false,
      lazy: true,
      query: computed(() => ({ page: page.value, limite: ADMIN_LISTE_LIMITE_DEFAUT })),
    },
  )
  surveillerSessionAdmin(error)

  /** La réponse n'est exposée que si elle correspond à l'onglet affiché (pas de contenu d'un autre catalogue). */
  const liste = computed(() => (data.value && data.value.nom === onglet.value ? data.value : null))
  const enChargement = computed(() => !liste.value && !error.value)

  async function changerOnglet(valeur: AdminCatalogue): Promise<void> {
    await router.replace({ query: valeur === lireOngletCatalogue(undefined) ? {} : { onglet: valeur } })
  }

  async function changerPage(numero: number): Promise<void> {
    const query: Record<string, string> = {}
    if (onglet.value !== lireOngletCatalogue(undefined)) query.onglet = onglet.value
    if (numero > 1) query.page = String(numero)
    await router.replace({ query })
  }

  return { onglet, page, liste, status, error, enChargement, refresh, changerOnglet, changerPage }
}

/**
 * Écritures des catalogues (modifier, ajouter un nom bloqué, retirer) : clé d'idempotence en en-tête, code de
 * réauthentification, motif dans le corps. Séparé de la lecture pour ne pas doubler la requête de la liste.
 */
export function useAdminCatalogueEcritures() {
  const { ecrire } = useAdminEcriture()

  function chemin(nom: AdminCatalogue, id?: string): string {
    return id === undefined
      ? `${ADMIN_PREFIXE_API}/catalogues/${nom}`
      : `${ADMIN_PREFIXE_API}/catalogues/${nom}/${encodeURIComponent(id)}`
  }

  function modifier(nom: AdminCatalogue, id: string, champs: Record<string, unknown>, confirmation: ConfirmationEcriture): Promise<ResultatEcriture<ReponseEcriture>> {
    return ecrire<ReponseEcriture>(chemin(nom, id), { ...champs, motif: confirmation.motif }, {
      cle: confirmation.cle,
      code: confirmation.code,
      methode: 'PATCH',
    })
  }

  function ajouterNomBloque(valeur: string, confirmation: ConfirmationEcriture): Promise<ResultatEcriture<ReponseEcriture>> {
    return ecrire<ReponseEcriture>(chemin('noms-bloques'), { valeur, motif: confirmation.motif }, {
      cle: confirmation.cle,
      code: confirmation.code,
    })
  }

  function retirer(nom: AdminCatalogue, id: string, confirmation: ConfirmationEcriture): Promise<ResultatEcriture<ReponseEcriture>> {
    return ecrire<ReponseEcriture>(chemin(nom, id), { motif: confirmation.motif }, {
      cle: confirmation.cle,
      code: confirmation.code,
      methode: 'DELETE',
    })
  }

  return { modifier, ajouterNomBloque, retirer }
}
