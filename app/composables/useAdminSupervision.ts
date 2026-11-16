import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_ENVOIS_JOURS_DEFAUT, ADMIN_IDEMPOTENCE_ENTETE, ADMIN_PREFIXE_API, ADMIN_REAUTH_ENTETE, ADMIN_SUPERVISION_JOURS_DEFAUT } from '#shared/admin'
import type { AdminAction, AdminCible } from '#shared/admin'
import { FILES_NON_RELANCABLES } from '#shared/jobs'
import type { FileSupervisee } from '#shared/jobs'
import type {
  AgregatsAssistantsDto,
  AgregatsIaDto,
  AgregatsPwaDto,
  EnvoisDto,
  EtatFilesDto,
  JobEchecDto,
  PurgeFilesReponse,
  SanteDto,
} from '#shared/schemas/admin-a4'
import { messageDepuisErreurApi } from '~/utils/admin-a2'
import { MESSAGE_REJOUE } from '~/utils/admin-paiements'
import { accorder } from '~/utils/pluriel'
import { LIBELLES_FILES_SUPERVISION } from '~/utils/admin-supervision'
import type { ResultatEcriture } from './useAdminEcriture'

const STATUT_SESSION_REFUSEE = 404

type CorpsEcriture = Record<string, string | number | boolean | null>
type VerbeEcriture = 'POST' | 'PUT' | 'DELETE'

/**
 * Écriture d'administration avec le verbe voulu (PUT des réglages, DELETE des capacités) : clé d'idempotence dans
 * l'en-tête, code de réauthentification si exigé. Même contrat que `useAdminEcriture` (POST seulement) : le message
 * d'erreur est celui du serveur ; un 404 sans code (session refusée) renvoie à la connexion.
 */
export function useAdminEcritureVerbe() {
  const { expirer } = useAdminSession()

  async function ecrireAvecVerbe<T>(
    verbe: VerbeEcriture,
    chemin: string,
    corps: CorpsEcriture,
    options: { cle: string, code?: string },
  ): Promise<ResultatEcriture<T>> {
    const entetes: Record<string, string> = { [ADMIN_IDEMPOTENCE_ENTETE]: options.cle }
    if (options.code) entetes[ADMIN_REAUTH_ENTETE] = options.code
    try {
      const donnees = await $fetch<T>(chemin, { method: verbe, body: corps, headers: entetes })
      return { ok: true, donnees }
    } catch (e) {
      const lue = lireErreurApi(e)
      if (lue.statut === STATUT_SESSION_REFUSEE && lue.code === null) void expirer()
      return { ok: false, message: messageDepuisErreurApi(e) }
    }
  }

  return { ecrireAvecVerbe }
}

/** Une donnée serveur : états distincts de chargement, d'erreur et de contenu. */
export interface LectureSupervision<T> {
  data: Ref<T | null | undefined>
  chargement: ComputedRef<boolean>
  erreur: ComputedRef<boolean>
  message: ComputedRef<string>
  refresh: () => Promise<void>
}

export interface DialogueSupervision {
  titre: string
  description: string
  libelleAction: string
  reauth: boolean
  action: AdminAction
  cibleType: AdminCible
  cibleId: string
  destructive: boolean
}

type DemandeSupervision =
  | { type: 'relancer', file: FileSupervisee, job: JobEchecDto }
  | { type: 'purger', file: FileSupervisee }

/**
 * Supervision (A4) : santé, files, envois de codes, agrégats. Chaque donnée se charge et échoue seule (une panne
 * d'une lecture ne masque pas les autres). Relance et purge passent par une boîte de dialogue à motif.
 */
export function useAdminSupervision() {
  const toast = useToast()
  const { ecrireAvecVerbe } = useAdminEcritureVerbe()

  const joursEnvois = ref<number>(ADMIN_ENVOIS_JOURS_DEFAUT)
  const joursAgregats = ref<number>(ADMIN_SUPERVISION_JOURS_DEFAUT)
  const queryEnvois = computed(() => ({ jours: joursEnvois.value }))
  const queryAgregats = computed(() => ({ jours: joursAgregats.value }))

  function lire<T>(segment: string, cle: string, query?: Ref<{ jours: number }>): LectureSupervision<T> {
    const { data, status, error, refresh } = useFetch<T>(`${ADMIN_PREFIXE_API}/systemes/${segment}`, {
      key: cle,
      server: false,
      lazy: true,
      ...(query ? { query } : {}),
    })
    surveillerSessionAdmin(error)
    return {
      data,
      chargement: computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle')),
      erreur: computed(() => !!error.value),
      message: computed(() => (error.value ? messageDepuisErreurApi(error.value) : '')),
      refresh: async () => { await refresh() },
    }
  }

  const sante = lire<SanteDto>('sante', 'admin-systemes-sante')
  const files = lire<EtatFilesDto>('jobs', 'admin-systemes-jobs')
  const envois = lire<EnvoisDto>('envois', 'admin-systemes-envois', queryEnvois)
  const ia = lire<AgregatsIaDto>('ia', 'admin-systemes-ia', queryAgregats)
  const pwa = lire<AgregatsPwaDto>('pwa', 'admin-systemes-pwa', queryAgregats)
  const assistants = lire<AgregatsAssistantsDto>('assistants', 'admin-systemes-assistants', queryAgregats)

  const actualisationEnCours = ref(false)
  async function actualiserTout(): Promise<void> {
    if (actualisationEnCours.value) return
    actualisationEnCours.value = true
    try {
      await Promise.all([sante.refresh(), files.refresh(), envois.refresh(), ia.refresh(), pwa.refresh(), assistants.refresh()])
    } finally {
      actualisationEnCours.value = false
    }
  }

  // --- Relance et purge ---

  const demande = ref<DemandeSupervision | null>(null)
  const dialogueOuvert = ref(false)
  const enCours = ref(false)
  const erreur = ref('')

  const dialogue = computed<DialogueSupervision | null>(() => {
    const courante = demande.value
    if (!courante) return null
    const nomFile = LIBELLES_FILES_SUPERVISION[courante.file]
    if (courante.type === 'relancer') {
      return {
        titre: 'Relancer cette tâche',
        description: `La tâche de la file « ${nomFile} » repasse en attente. Le motif est conservé dans le journal.`,
        libelleAction: 'Relancer',
        reauth: false,
        action: ADMIN_ACTIONS.jobRelancer,
        cibleType: ADMIN_CIBLES.job,
        cibleId: courante.job.id,
        destructive: false,
      }
    }
    return {
      titre: 'Purger les tâches en échec',
      description: `Les tâches en échec de la file « ${nomFile} » sont supprimées (1 000 au plus). Cette action est définitive.`,
      libelleAction: 'Purger',
      reauth: true,
      action: ADMIN_ACTIONS.jobPurger,
      cibleType: ADMIN_CIBLES.job,
      cibleId: courante.file,
      destructive: true,
    }
  })

  function ouvrirRelance(file: FileSupervisee, job: JobEchecDto): void {
    if (FILES_NON_RELANCABLES.includes(file)) return
    demande.value = { type: 'relancer', file, job }
    erreur.value = ''
    dialogueOuvert.value = true
  }

  function ouvrirPurge(file: FileSupervisee): void {
    demande.value = { type: 'purger', file }
    erreur.value = ''
    dialogueOuvert.value = true
  }

  async function confirmer(saisie: { motif: string, code: string, cle: string }): Promise<void> {
    const courante = demande.value
    if (!courante || enCours.value) return
    enCours.value = true
    erreur.value = ''
    const motif = saisie.motif.trim()
    const resultat: ResultatEcriture<{ rejoue?: boolean } | PurgeFilesReponse> = courante.type === 'relancer'
      ? await ecrireAvecVerbe<{ rejoue?: boolean }>(
        'POST',
        `${ADMIN_PREFIXE_API}/systemes/jobs/relancer`,
        { file: courante.file, id: courante.job.id, motif, cleIdempotence: saisie.cle },
        { cle: saisie.cle },
      )
      : await ecrireAvecVerbe<PurgeFilesReponse>(
        'POST',
        `${ADMIN_PREFIXE_API}/systemes/jobs/purger`,
        { file: courante.file, motif },
        { cle: saisie.cle, code: saisie.code },
      )
    enCours.value = false
    if (!resultat.ok) {
      erreur.value = resultat.message
      return
    }
    const donnees = resultat.donnees
    const purges = 'purges' in donnees ? donnees.purges : 0
    toast.add({
      title: 'rejoue' in donnees && donnees.rejoue === true
        ? MESSAGE_REJOUE
        : courante.type === 'relancer'
          ? 'La tâche est relancée.'
          : `${purges} ${accorder(purges, 'tâche supprimée', 'tâches supprimées')}.`,
      color: 'success',
      icon: 'i-ph-check-circle',
    })
    dialogueOuvert.value = false
    await files.refresh()
  }

  return {
    sante, files, envois, ia, pwa, assistants,
    joursEnvois, joursAgregats, actualiserTout, actualisationEnCours,
    dialogue, dialogueOuvert, enCours, erreur, ouvrirRelance, ouvrirPurge, confirmer,
  }
}
