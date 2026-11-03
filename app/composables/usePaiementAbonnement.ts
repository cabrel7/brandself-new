import type { AbonnementDTO, DeviseOffreDTO, MoyenPaiementDTO, PaiementDTO, PaiementReponse, PrixPeriodeDTO } from '#shared/dto'
import {
  CODE_ECHEC_EXPIRE,
  PAIEMENT_SUIVI_INTERVALLE_MS,
  PAIEMENT_SUIVI_MAX_MS,
  messageEchec,
} from '#shared/paiements'
import { PERIODE_MISE_EN_AVANT, PERIODES_MOIS } from '#shared/plans'
import type { PeriodeMois } from '#shared/plans'

/**
 * Étapes du parcours de paiement : `saisie` (formulaire), `envoi` (initiation en cours), `attente` (le payeur valide sur
 * son téléphone, le suivi interroge NOTRE API), `delai` (3 minutes écoulées sans réponse), `reseau` (suivi coupé),
 * `reussi`, `echec` (échec, annulation, expiration ou anomalie).
 */
export type EtapePaiement = 'saisie' | 'envoi' | 'attente' | 'delai' | 'reseau' | 'reussi' | 'echec'

export interface ErreursPaiement {
  periode?: string
  moyen?: string
  telephone?: string
  /** Erreur qui ne se rattache à aucun champ (opérateur indisponible, trop de tentatives…). */
  general?: string
}

export const MESSAGE_DELAI_ATTENTE = 'Nous attendons encore la confirmation de l’opérateur. Vous recevrez un e-mail dès qu’elle arrive.'
export const MESSAGE_SUIVI_COUPE = 'Nous n’arrivons pas à vérifier votre paiement pour le moment. Vérifiez votre connexion, puis réessayez.'
export const MESSAGE_ANOMALIE = 'Nous vérifions ce paiement. Si un montant a été prélevé, vous en serez informé par e-mail.'
const MESSAGE_MOYEN_REQUIS = 'Choisissez votre moyen de paiement.'
const MESSAGE_TELEPHONE_REQUIS = 'Saisissez le numéro de votre compte Mobile Money.'
const MESSAGE_PAIEMENT_INTROUVABLE = 'Ce paiement est introuvable. Vous pouvez en lancer un nouveau.'
const MESSAGE_GENERIQUE = 'Nous n’avons pas pu lancer le paiement. Réessayez dans un instant.'
const MESSAGE_INDISPONIBLE = 'Le paiement en ligne n’est pas disponible pour le moment. Réessayez dans un instant.'
const MESSAGE_OPERATEUR = 'L’opérateur ne répond pas. Réessayez dans un instant.'
const MESSAGE_DEVISE = 'Cette devise n’est pas encore acceptée.'
const MESSAGE_TELEPHONE_OPERATEUR = 'Ce numéro ne correspond pas à l’opérateur choisi.'
const MESSAGE_REFUS = 'L’opérateur a refusé la demande. Vérifiez le numéro.'
const MESSAGE_MOYEN = 'Ce moyen de paiement n’est pas disponible.'
const MESSAGE_EN_COURS = 'Un paiement est déjà en cours. Validez-le sur votre téléphone.'

/** Échecs de lecture consécutifs avant d'abandonner le suivi automatique. */
const ECHECS_SUIVI_MAX = 3
const MS_PAR_SECONDE = 1000
const SECONDES_PAR_MINUTE = 60

/** `retryAfter` (secondes) -> message de patience pour une limite de tentatives de paiement. */
export function messageTropDeTentatives(retryAfter: number | null): string {
  if (retryAfter === null) return 'Trop de tentatives de paiement. Réessayez dans un moment.'
  const minutes = Math.max(1, Math.ceil(retryAfter / SECONDES_PAR_MINUTE))
  return `Trop de tentatives de paiement. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
}

/** Message affiché à la fin d'un paiement qui n'a pas abouti (le serveur fournit le sien, sinon repli par statut). */
export function messageFinPaiement(paiement: PaiementDTO): string {
  if (paiement.messageEchec) return paiement.messageEchec
  if (paiement.statut === 'anomalie') return MESSAGE_ANOMALIE
  return messageEchec(paiement.statut === 'expire' ? CODE_ECHEC_EXPIRE : null)
}

function estPeriode(valeur: unknown): valeur is PeriodeMois {
  return (PERIODES_MOIS as readonly unknown[]).includes(valeur)
}

/**
 * Parcours « Payer / Renouveler » : choix de la durée et du moyen, numéro du payeur, initiation
 * (`POST /api/studio/abonnement/paiements`), puis suivi par lecture de NOTRE API (jamais du fournisseur) toutes les
 * `PAIEMENT_SUIVI_INTERVALLE_MS`, pendant `PAIEMENT_SUIVI_MAX_MS` au plus, en pause quand l'onglet est caché.
 * Le numéro reste en mémoire de l'écran : il n'est ni stocké ni journalisé côté navigateur.
 */
export function usePaiementAbonnement(
  abonnement: Ref<AbonnementDTO | null>,
  /** Appelé une fois le paiement réussi : recharge l'abonnement affiché. */
  surReussite: () => Promise<unknown>,
) {
  const route = useRoute()
  const visibilite = useDocumentVisibility()

  const periode = ref<PeriodeMois>(PERIODE_MISE_EN_AVANT)
  const moyenId = ref('')
  const telephone = ref('')
  const deviseChoisie = ref<string | null>(null)
  const paiement = ref<PaiementDTO | null>(null)
  const etape = ref<EtapePaiement>('saisie')
  const erreurs = ref<ErreursPaiement>({})
  /** Incrémenté à chaque refus (contrôle local ou serveur) : le formulaire y répond en focalisant le premier champ invalide. */
  const signalErreur = ref(0)

  const offre = computed(() => abonnement.value?.offre ?? null)
  /** Devise payable choisie, ou celle proposée par défaut par le serveur. */
  const devise = computed<string | null>({
    get: () => deviseChoisie.value ?? offre.value?.deviseParDefaut ?? null,
    set: (valeur) => {
      deviseChoisie.value = valeur
    },
  })
  const deviseOffre = computed<DeviseOffreDTO | null>(() =>
    offre.value?.devises.find((d) => d.devise === devise.value) ?? null,
  )
  const prixPeriodes = computed<PrixPeriodeDTO[]>(() => deviseOffre.value?.prix ?? [])
  const moyens = computed<MoyenPaiementDTO[]>(() => offre.value?.moyens.filter((m) => m.devise === devise.value) ?? [])
  const prixChoisi = computed(() => prixPeriodes.value.find((p) => p.periodeMois === periode.value) ?? null)
  const moyenChoisi = computed(() => moyens.value.find((m) => m.id === moyenId.value) ?? null)
  const devisesProposees = computed(() => offre.value?.devises ?? [])

  // Valeurs initiales, une seule fois par chargement : `?periode=` (lien de rappel) puis la durée mise en avant.
  let initialise = false
  watch(abonnement, (courant) => {
    if (!courant || initialise) return
    initialise = true
    const demandee = Number(Array.isArray(route.query.periode) ? route.query.periode[0] : route.query.periode)
    if (estPeriode(demandee)) periode.value = demandee
  }, { immediate: true })

  // Un seul moyen proposé : il est choisi d'office. Un moyen qui n'est plus proposé est retiré.
  watch(moyens, (liste) => {
    if (!liste.some((m) => m.id === moyenId.value)) moyenId.value = ''
    if (moyenId.value === '' && liste.length === 1 && liste[0]) moyenId.value = liste[0].id
  }, { immediate: true })

  // Si la durée choisie n'existe pas dans la devise courante, on retombe sur la durée mise en avant.
  watch(prixPeriodes, (liste) => {
    if (liste.length > 0 && !liste.some((p) => p.periodeMois === periode.value)) {
      periode.value = liste.find((p) => p.miseEnAvant)?.periodeMois ?? liste[0]?.periodeMois ?? periode.value
    }
  })

  // --- Suivi -----------------------------------------------------------------------------------------------------
  let minuteur: ReturnType<typeof setTimeout> | null = null
  let sequence = 0
  let debutSuivi = 0
  let echecs = 0

  function arreterSuivi(): void {
    sequence += 1
    if (minuteur !== null) clearTimeout(minuteur)
    minuteur = null
  }

  function planifier(delaiMs: number): void {
    if (minuteur !== null) clearTimeout(minuteur)
    minuteur = setTimeout(() => {
      minuteur = null
      void interroger()
    }, delaiMs)
  }

  /** Applique un paiement lu ou créé : statut final = fin du suivi ; sinon le suivi continue. */
  async function appliquer(courant: PaiementDTO): Promise<void> {
    paiement.value = courant
    if (paiementEstOuvert(courant.statut)) return
    arreterSuivi()
    if (courant.statut === 'reussi') {
      etape.value = 'reussi'
      await surReussite()
    } else {
      etape.value = 'echec'
    }
  }

  async function interroger(): Promise<void> {
    const cible = paiement.value
    if (!cible || etape.value !== 'attente') return
    const courante = sequence
    const delaiDepasse = Date.now() - debutSuivi >= PAIEMENT_SUIVI_MAX_MS
    // Onglet caché : aucune lecture, le suivi reprend dès son retour (une dernière lecture avant de conclure).
    if (visibilite.value === 'hidden') {
      planifier(PAIEMENT_SUIVI_INTERVALLE_MS)
      return
    }
    try {
      const reponse = await $fetch<PaiementReponse>(`/api/studio/abonnement/paiements/${cible.id}`)
      if (courante !== sequence) return
      echecs = 0
      await appliquer(reponse.paiement)
      if (etape.value !== 'attente') return
      if (delaiDepasse) etape.value = 'delai'
      else planifier(PAIEMENT_SUIVI_INTERVALLE_MS)
    } catch (e) {
      if (courante !== sequence) return
      const api = lireErreurApi(e)
      if (api.statut === 404) {
        arreterSuivi()
        paiement.value = null
        etape.value = 'saisie'
        erreurs.value = { general: MESSAGE_PAIEMENT_INTROUVABLE }
        return
      }
      // Limite de lectures atteinte : on patiente, ce n'est pas une panne.
      if (api.code === 'TROP_DE_REQUETES') {
        planifier(Math.max((api.retryAfter ?? 0) * MS_PAR_SECONDE, PAIEMENT_SUIVI_INTERVALLE_MS))
        return
      }
      echecs += 1
      if (echecs >= ECHECS_SUIVI_MAX) etape.value = 'reseau'
      else if (delaiDepasse) etape.value = 'delai'
      else planifier(PAIEMENT_SUIVI_INTERVALLE_MS)
    }
  }

  function suivre(courant: PaiementDTO): void {
    arreterSuivi()
    paiement.value = courant
    etape.value = 'attente'
    debutSuivi = Date.now()
    echecs = 0
    planifier(PAIEMENT_SUIVI_INTERVALLE_MS)
  }

  // Rechargement de la page pendant un paiement : l'attente reprend là où elle en était.
  watch(abonnement, (courant) => {
    const ouvert = courant?.paiementEnCours
    if (ouvert && etape.value === 'saisie' && paiementEstOuvert(ouvert.statut)) suivre(ouvert)
  }, { immediate: true })

  onScopeDispose(arreterSuivi)

  // --- Actions ---------------------------------------------------------------------------------------------------
  async function reprendreEnCours(id: string): Promise<boolean> {
    try {
      const reponse = await $fetch<PaiementReponse>(`/api/studio/abonnement/paiements/${id}`)
      if (paiementEstOuvert(reponse.paiement.statut)) suivre(reponse.paiement)
      else await appliquer(reponse.paiement)
      return true
    } catch {
      return false
    }
  }

  async function ranger(e: unknown): Promise<void> {
    const api = lireErreurApi(e)
    switch (api.code) {
      case 'PAIEMENT_EN_COURS': {
        const id = api.donnees.paiementId
        if (typeof id === 'string' && await reprendreEnCours(id)) return
        erreurs.value = { general: MESSAGE_EN_COURS }
        return
      }
      case 'TELEPHONE_INVALIDE':
        erreurs.value = { telephone: MESSAGE_TELEPHONE_OPERATEUR }
        return
      case 'PAIEMENT_REFUSE':
        erreurs.value = { telephone: MESSAGE_REFUS }
        return
      case 'MOYEN_PAIEMENT_INVALIDE':
        erreurs.value = { moyen: MESSAGE_MOYEN }
        return
      case 'DEVISE_NON_PAYABLE':
        erreurs.value = { general: MESSAGE_DEVISE }
        return
      case 'PAIEMENT_INDISPONIBLE':
        erreurs.value = { general: MESSAGE_INDISPONIBLE }
        return
      case 'FOURNISSEUR_INDISPONIBLE':
        erreurs.value = { general: MESSAGE_OPERATEUR }
        return
      case 'TROP_DE_REQUETES':
        erreurs.value = { general: messageTropDeTentatives(api.retryAfter) }
        return
      case 'VALIDATION':
        erreurs.value = api.champs.telephone?.[0]
          ? { telephone: api.champs.telephone[0] }
          : { general: MESSAGE_GENERIQUE }
        return
      default:
        erreurs.value = { general: MESSAGE_GENERIQUE }
    }
  }

  /** Contrôle local minimal (le serveur fait foi) : évite un aller-retour pour un champ oublié. */
  function controler(): boolean {
    const manques: ErreursPaiement = {}
    if (!prixChoisi.value) manques.periode = 'Choisissez une durée.'
    if (!moyenChoisi.value) manques.moyen = MESSAGE_MOYEN_REQUIS
    if (!telephoneSaisiPlausible(telephone.value)) manques.telephone = MESSAGE_TELEPHONE_REQUIS
    erreurs.value = manques
    return Object.keys(manques).length === 0
  }

  async function payer(): Promise<void> {
    if (etape.value !== 'saisie') return
    erreurs.value = {}
    if (!controler() || !devise.value || !moyenChoisi.value) {
      signalErreur.value += 1
      return
    }

    etape.value = 'envoi'
    try {
      const reponse = await $fetch<PaiementReponse>('/api/studio/abonnement/paiements', {
        method: 'POST',
        body: {
          periodeMois: periode.value,
          devise: devise.value,
          moyen: moyenChoisi.value.id,
          telephone: chiffresTelephone(telephone.value),
        },
      })
      if (paiementEstOuvert(reponse.paiement.statut)) suivre(reponse.paiement)
      else await appliquer(reponse.paiement)
    } catch (e) {
      etape.value = 'saisie'
      await ranger(e)
      signalErreur.value += 1
    }
  }

  /** Après un échec : retour au formulaire, avec le numéro saisi conservé. */
  function reessayer(): void {
    arreterSuivi()
    paiement.value = null
    etape.value = 'saisie'
    erreurs.value = {}
  }

  /** Après 3 minutes ou une coupure du suivi : on relit le statut, pour 3 minutes de plus. */
  function verifierEncore(): void {
    if (paiement.value) suivre(paiement.value)
  }

  function viderErreur(champ: keyof ErreursPaiement): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  return {
    periode, moyenId, telephone, paiement, etape, erreurs, signalErreur,
    devise, deviseOffre, devisesProposees, prixPeriodes, prixChoisi, moyens, moyenChoisi,
    payer, reessayer, verifierEncore, viderErreur,
  }
}
