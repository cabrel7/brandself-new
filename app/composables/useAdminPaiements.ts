import { ADMIN_PREFIXE_API } from '#shared/admin'
import { EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE, PAIEMENT_SOURCES } from '#shared/admin-paiements'
import { PAIEMENT_STATUTS } from '#shared/paiements'
import type { ExportPaiements, FiltresPaiements, ListePaiementsDto } from '#shared/schemas/admin-paiements'
import { lireFiltresPaiements, lirePage, messageErreurAdmin, nomFichierExport } from '~/utils/admin-paiements'

/** Liste des paiements : filtres, page et détail ouvert vivent dans l'URL (lien partageable, retour arrière cohérent). */
export function useAdminPaiements() {
  const route = useRoute()
  const router = useRouter()

  const filtres = computed<FiltresPaiements>(() => lireFiltresPaiements(route.query, PAIEMENT_STATUTS, PAIEMENT_SOURCES))
  const page = computed(() => lirePage(route.query.page))
  const idDetail = computed(() => {
    const brut = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id
    return typeof brut === 'string' && brut !== '' ? brut : null
  })
  const filtresActifs = computed(() => Object.keys(filtres.value).length > 0)

  const { data, status, error, refresh } = useFetch<ListePaiementsDto>(`${ADMIN_PREFIXE_API}/paiements`, {
    key: 'admin-paiements',
    server: false,
    lazy: true,
    query: computed(() => ({ ...filtres.value, page: page.value })),
  })
  useAdminSessionExpiree(error)

  async function appliquerFiltres(valeur: FiltresPaiements): Promise<void> {
    await router.replace({ query: { ...valeur } })
  }

  async function changerPage(valeur: number): Promise<void> {
    await router.replace({ query: { ...filtres.value, page: String(valeur) } })
  }

  async function ouvrirDetail(id: string): Promise<void> {
    await router.replace({ query: { ...route.query, id } })
  }

  async function fermerDetail(): Promise<void> {
    const query = { ...route.query }
    delete query.id
    await router.replace({ query })
  }

  // Export CSV : motif obligatoire, mêmes filtres que la liste. Le fichier est construit côté serveur.
  const exportEnCours = ref(false)
  const erreurExport = ref('')

  async function exporter(motif: string): Promise<boolean> {
    if (exportEnCours.value) return false
    exportEnCours.value = true
    erreurExport.value = ''
    const corps: ExportPaiements = { motif: motif.trim(), filtres: filtres.value }
    try {
      const csv = await $fetch<string>(`${ADMIN_PREFIXE_API}/export/paiements`, { method: 'POST', body: corps })
      telecharger(csv, nomFichierExport(EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE, new Date()))
      return true
    } catch (e) {
      erreurExport.value = messageErreurAdmin(lireErreurApi(e).code)
      return false
    } finally {
      exportEnCours.value = false
    }
  }

  return {
    filtres, page, idDetail, filtresActifs, data, status, error, refresh,
    appliquerFiltres, changerPage, ouvrirDetail, fermerDetail,
    exportEnCours, erreurExport, exporter,
  }
}

function telecharger(contenu: string, nom: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  lien.click()
  URL.revokeObjectURL(url)
}
