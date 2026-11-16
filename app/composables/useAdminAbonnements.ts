import { ADMIN_PREFIXE_API } from '#shared/admin'
import { ABONNEMENT_ONGLETS, type AbonnementOnglet } from '#shared/admin-paiements'
import type { AbonnementAdminDto, ListeAbonnementsDto, RappelAbonnement } from '#shared/schemas/admin-paiements'
import { lirePage, messageErreurAdmin } from '~/utils/admin-paiements'

const ONGLET_PAR_DEFAUT: AbonnementOnglet = 'renouvellement'
const MESSAGE_RAPPEL_PLANIFIE = 'Le rappel est planifié.'

function lireOnglet(valeur: unknown): AbonnementOnglet {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return (ABONNEMENT_ONGLETS as readonly unknown[]).includes(brut) ? (brut as AbonnementOnglet) : ONGLET_PAR_DEFAUT
}

/** Liste des abonnements à suivre (onglet et page dans l'URL) et envoi d'un rappel manuel. */
export function useAdminAbonnements() {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()

  const onglet = computed(() => lireOnglet(route.query.onglet))
  const page = computed(() => lirePage(route.query.page))

  const { data, status, error, refresh } = useFetch<ListeAbonnementsDto>(`${ADMIN_PREFIXE_API}/abonnements`, {
    key: 'admin-abonnements',
    server: false,
    lazy: true,
    query: computed(() => ({ onglet: onglet.value, page: page.value })),
  })
  useAdminSessionExpiree(error)

  async function changerOnglet(valeur: AbonnementOnglet): Promise<void> {
    await router.replace({ query: { onglet: valeur } })
  }

  async function changerPage(valeur: number): Promise<void> {
    await router.replace({ query: { onglet: onglet.value, page: String(valeur) } })
  }

  // Rappel manuel : un seul à la fois, motif obligatoire (journalisé côté serveur).
  const cible = ref<AbonnementAdminDto | null>(null)
  const rappelEnCours = ref(false)
  const erreurRappel = ref('')

  function ouvrirRappel(abonnement: AbonnementAdminDto): void {
    erreurRappel.value = ''
    cible.value = abonnement
  }

  function fermerRappel(): void {
    if (!rappelEnCours.value) cible.value = null
  }

  async function envoyerRappel(motif: string): Promise<void> {
    if (!cible.value || rappelEnCours.value) return
    rappelEnCours.value = true
    erreurRappel.value = ''
    const corps: RappelAbonnement = { motif: motif.trim() }
    try {
      await $fetch(`${ADMIN_PREFIXE_API}/abonnements/${encodeURIComponent(cible.value.id)}/rappel`, {
        method: 'POST',
        body: corps,
      })
      cible.value = null
      toast.add({ title: MESSAGE_RAPPEL_PLANIFIE, color: 'success', icon: 'i-ph-check-circle' })
      await refresh()
    } catch (e) {
      erreurRappel.value = messageErreurAdmin(lireErreurApi(e).code)
    } finally {
      rappelEnCours.value = false
    }
  }

  return {
    onglet, page, data, status, error, refresh, changerOnglet, changerPage,
    cible, rappelEnCours, erreurRappel, ouvrirRappel, fermerRappel, envoyerRappel,
  }
}
