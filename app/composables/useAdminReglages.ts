import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_PREFIXE_API } from '#shared/admin'
import type { ReglageCategorie, ReglageValeur } from '#shared/reglages'
import type { ListeReglagesDto, ModifierReglageReponse, ReglageDto } from '#shared/schemas/admin-a4'
import { messageDepuisErreurApi } from '~/utils/admin-a2'
import { MESSAGE_REJOUE } from '~/utils/admin-paiements'
import {
  CATEGORIE_REGLAGE_PAR_DEFAUT,
  corpsModificationReglage,
  libelleValeurReglage,
  lireCategorieReglage,
  reglagesDeCategorie,
} from '~/utils/admin-reglages'
import type { DialogueSupervision } from './useAdminSupervision'

interface DemandeReglage {
  reglage: ReglageDto
  /** `null` : rétablir le défaut. */
  valeur: ReglageValeur | null
}

/**
 * Registre des réglages (A4) : lecture, filtre par catégorie (dans l'URL), modification avec motif, code de
 * réauthentification (si le réglage l'exige) et clé d'idempotence. Aucune règle métier : le serveur valide.
 */
export function useAdminReglages() {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()
  const { ecrireAvecVerbe } = useAdminEcritureVerbe()

  const categorie = computed<ReglageCategorie>(() => lireCategorieReglage(route.query.categorie))

  const { data, status, error, refresh } = useFetch<ListeReglagesDto>(`${ADMIN_PREFIXE_API}/reglages`, {
    key: 'admin-reglages',
    server: false,
    lazy: true,
  })
  surveillerSessionAdmin(error)

  const elements = computed<ReglageDto[]>(() => data.value?.elements ?? [])
  const visibles = computed(() => reglagesDeCategorie(elements.value, categorie.value))
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const messageErreur = computed(() => (error.value ? messageDepuisErreurApi(error.value) : ''))

  async function changerCategorie(valeur: ReglageCategorie): Promise<void> {
    await router.replace({ query: valeur === CATEGORIE_REGLAGE_PAR_DEFAUT ? {} : { categorie: valeur } })
  }

  // --- Modification ---

  const demande = ref<DemandeReglage | null>(null)
  const dialogueOuvert = ref(false)
  const enCours = ref(false)
  const erreurEcriture = ref('')

  const dialogue = computed<DialogueSupervision | null>(() => {
    const courante = demande.value
    if (!courante) return null
    const { reglage, valeur } = courante
    return {
      titre: valeur === null ? 'Rétablir la valeur par défaut' : 'Enregistrer ce réglage',
      description: 'Le motif est conservé dans le journal.',
      libelleAction: valeur === null ? 'Rétablir' : 'Enregistrer',
      reauth: reglage.reauth,
      action: ADMIN_ACTIONS.reglageModifier,
      cibleType: ADMIN_CIBLES.reglage,
      cibleId: reglage.cle,
      destructive: false,
    }
  })

  /** Résumé affiché dans la boîte de dialogue : réglage, valeur actuelle, nouvelle valeur. */
  const resume = computed(() => {
    const courante = demande.value
    if (!courante) return null
    const nouvelle = courante.valeur === null ? courante.reglage.defaut : courante.valeur
    return {
      libelle: courante.reglage.libelle,
      actuelle: libelleValeurReglage(courante.reglage.valeur),
      nouvelle: libelleValeurReglage(nouvelle),
    }
  })

  function demander(reglage: ReglageDto, valeur: ReglageValeur | null): void {
    demande.value = { reglage, valeur }
    erreurEcriture.value = ''
    dialogueOuvert.value = true
  }

  async function confirmer(saisie: { motif: string, code: string, cle: string }): Promise<void> {
    const courante = demande.value
    if (!courante || enCours.value) return
    enCours.value = true
    erreurEcriture.value = ''
    const resultat = await ecrireAvecVerbe<ModifierReglageReponse>(
      'PUT',
      `${ADMIN_PREFIXE_API}/reglages/${encodeURIComponent(courante.reglage.cle)}`,
      corpsModificationReglage(courante.valeur, saisie.motif, saisie.cle),
      { cle: saisie.cle, code: courante.reglage.reauth ? saisie.code : undefined },
    )
    enCours.value = false
    if (!resultat.ok) {
      erreurEcriture.value = resultat.message
      return
    }
    toast.add({
      title: resultat.donnees.rejoue ? MESSAGE_REJOUE : 'Le réglage est enregistré.',
      color: 'success',
      icon: 'i-ph-check-circle',
    })
    dialogueOuvert.value = false
    await refresh()
  }

  return {
    categorie, elements, visibles, enChargement, erreurLecture: error, messageErreur, refresh, changerCategorie,
    dialogue, resume, dialogueOuvert, enCours, erreurEcriture, demander, confirmer,
  }
}
