// Types de la réponse de GET /api/studio/assistants[/journal] (server/resources/assistant.ts, non partagés : copie locale).
export interface AssistantStudio {
  id: string
  nom: string
  portees: string[]
  connecteLe: string
  derniereActiviteLe: string | null
}

interface AssistantsReponse {
  actif: boolean
  adresse: string
  planPayant: boolean
  assistants: AssistantStudio[]
}

interface EntreeJournalReponse {
  id: string
  assistant: string
  outil: string
  resume: unknown
  erreur: string | null
  avant: unknown
  apres: unknown
  date: string
}

interface JournalReponse {
  entrees: EntreeJournalReponse[]
}

export interface EntreeJournalAffichee {
  id: string
  date: string
  phrase: string
  echec: boolean
}

export const CLE_ASSISTANTS = 'studio-assistants'
export const CLE_JOURNAL_ASSISTANTS = 'studio-assistants-journal'

const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

const DELAI_CONFIRMATION_COPIE_MS = 2000
const ERREUR_RETRAIT = 'Nous n’avons pas pu retirer cet accès. Réessayez dans un instant.'
const NOM_REPLI = 'Votre assistant'

const LIBELLES_PORTEES: Record<string, string> = {
  'vitrine:lecture': 'Lire votre vitrine',
  'contenu:ecriture': 'Ajouter et modifier',
  'reservations:lecture': 'Consulter vos réservations',
  'messages:lecture': 'Consulter vos messages',
}

/** Verbe de la phrase du journal : « <assistant> <verbe> ». */
const ACTIONS_OUTILS: Record<string, string> = {
  obtenir_vitrine: 'a consulté votre vitrine',
  lister_services: 'a consulté vos services',
  creer_service: 'a créé un service',
  modifier_service: 'a modifié un service',
  lister_realisations: 'a consulté vos réalisations',
  creer_realisation: 'a créé une réalisation',
  modifier_realisation: 'a modifié une réalisation',
  lister_reservations: 'a consulté vos réservations',
  lister_messages: 'a consulté vos messages',
  obtenir_agenda: 'a consulté votre agenda',
  lister_creneaux_libres: 'a consulté vos créneaux libres',
  lister_demandes: 'a consulté vos demandes',
}
const ACTION_REPLI = 'a effectué une action'

const formatDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })
const formatDateHeure = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function libellePortee(portee: string): string | null {
  return LIBELLES_PORTEES[portee] ?? null
}

function titreDuResume(resume: unknown): string | null {
  if (typeof resume !== 'object' || resume === null) return null
  const titre = (resume as { titre?: unknown }).titre
  return typeof titre === 'string' && titre.trim() ? titre.trim() : null
}

function phraseJournal(entree: EntreeJournalReponse): string {
  const action = ACTIONS_OUTILS[entree.outil] ?? ACTION_REPLI
  const titre = titreDuResume(entree.resume)
  const base = `${entree.assistant} ${action}`
  const avecTitre = titre ? `${base} « ${titre} »` : base
  return entree.erreur ? `${avecTitre} : l’action n’a pas abouti.` : `${avecTitre}.`
}

/**
 * Assistants connectés (MCP) : liste, retrait d'accès avec confirmation sur la même vue,
 * journal des dernières actions et copie de l'adresse du serveur.
 */
export function useStudioAssistants() {
  const { data, status, error, refresh } = useFetch<AssistantsReponse>('/api/studio/assistants', {
    key: CLE_ASSISTANTS,
    ...TOUJOURS_FRAIS,
  })

  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const enErreur = computed(() => !data.value && Boolean(error.value))
  const actif = computed(() => data.value?.actif ?? false)
  const planPayant = computed(() => data.value?.planPayant ?? false)
  const adresse = computed(() => data.value?.adresse ?? '')
  const assistants = computed(() => data.value?.assistants ?? [])

  // --- Journal : lu seulement quand il peut avoir un sens (plan payant). Erreur indépendante de la liste.
  const journal = useFetch<JournalReponse>('/api/studio/assistants/journal', {
    key: CLE_JOURNAL_ASSISTANTS,
    ...TOUJOURS_FRAIS,
    immediate: false,
  })
  watch(planPayant, (payant) => {
    if (payant) void journal.execute()
  }, { immediate: true })

  const journalEnChargement = computed(() =>
    planPayant.value && !journal.data.value && !journal.error.value
    && (journal.status.value === 'pending' || journal.status.value === 'idle'),
  )
  const journalEnErreur = computed(() => !journal.data.value && Boolean(journal.error.value))
  const entrees = computed<EntreeJournalAffichee[]>(() =>
    (journal.data.value?.entrees ?? []).map((entree) => ({
      id: entree.id,
      date: formatDateHeure.format(new Date(entree.date)),
      phrase: phraseJournal(entree),
      echec: entree.erreur !== null,
    })),
  )

  function portees(assistant: AssistantStudio): string[] {
    return assistant.portees.map(libellePortee).filter((libelle): libelle is string => libelle !== null)
  }

  function connecteLe(assistant: AssistantStudio): string {
    return `Connecté le ${formatDate.format(new Date(assistant.connecteLe))}`
  }

  function nomAssistant(assistant: AssistantStudio): string {
    return assistant.nom.trim() || NOM_REPLI
  }

  // --- Retrait d'un accès : une seule confirmation à la fois, sur la ligne concernée.
  const aConfirmer = ref<string | null>(null)
  const enRetrait = ref<string | null>(null)
  const erreurRetrait = ref('')

  function demanderRetrait(id: string): void {
    if (enRetrait.value) return
    erreurRetrait.value = ''
    aConfirmer.value = id
  }

  function annulerRetrait(): void {
    if (enRetrait.value) return
    aConfirmer.value = null
    erreurRetrait.value = ''
  }

  async function confirmerRetrait(id: string): Promise<void> {
    if (enRetrait.value) return
    erreurRetrait.value = ''
    enRetrait.value = id
    try {
      await $fetch(`/api/studio/assistants/${id}`, { method: 'DELETE' })
      aConfirmer.value = null
      await Promise.all([refresh(), planPayant.value ? journal.refresh() : Promise.resolve()])
    }
    catch (e) {
      // Déjà retiré ailleurs : la liste se met à jour, ce n'est pas une erreur pour l'utilisateur.
      if (lireErreurApi(e).code === 'ASSISTANT_INTROUVABLE') {
        aConfirmer.value = null
        await refresh()
      }
      else {
        erreurRetrait.value = ERREUR_RETRAIT
      }
    }
    finally {
      enRetrait.value = null
    }
  }

  // --- Copie de l'adresse.
  const adresseCopiee = ref(false)
  const erreurCopie = ref(false)
  let minuterie: ReturnType<typeof setTimeout> | null = null

  async function copierAdresse(): Promise<void> {
    if (minuterie) clearTimeout(minuterie)
    try {
      await navigator.clipboard.writeText(adresse.value)
      adresseCopiee.value = true
      erreurCopie.value = false
    }
    catch {
      erreurCopie.value = true
      adresseCopiee.value = false
    }
    minuterie = setTimeout(() => {
      adresseCopiee.value = false
      erreurCopie.value = false
    }, DELAI_CONFIRMATION_COPIE_MS)
  }

  onScopeDispose(() => {
    if (minuterie) clearTimeout(minuterie)
  })

  return {
    enChargement, enErreur, actif, planPayant, adresse, assistants, refresh,
    portees, connecteLe, nomAssistant,
    aConfirmer, enRetrait, erreurRetrait, demanderRetrait, annulerRetrait, confirmerRetrait,
    entrees, journalEnChargement, journalEnErreur, rafraichirJournal: journal.refresh,
    adresseCopiee, erreurCopie, copierAdresse,
  }
}
