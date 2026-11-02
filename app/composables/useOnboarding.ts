import type {
  GenerationLanceeReponse,
  MediaDTO,
  OnboardingEnCoursDTO,
  OnboardingReponse,
  OnboardingTerminerReponse,
  PropositionOnboardingDTO,
} from '#shared/dto'
import { SERVICES_PROPOSES } from '#shared/ia'
import { ONBOARDING_ETAPES_TOTAL, PAYS_DEFAUT } from '#shared/onboarding'
import type { OnboardingEtape } from '#shared/onboarding'
import { DEFAULT_PALETTE } from '#shared/palettes'
import type { Palette } from '#shared/palettes'
import type { OnboardingEtapeInput } from '#shared/schemas/onboarding'
import type { NextStep } from '#shared/vitrine'
import type { EtatUsername } from '~/composables/useUsernameDisponible'
import type { ErreurGeneration } from '~/composables/useGeneration'
import type { ErreurApi } from '~/composables/useApiErreur'

export type ChampErreurOnboarding =
  | 'titre' | 'prenom' | 'nom' | 'metier' | 'ville' | 'pays'
  | 'photo' | 'presentation' | 'username'

export type ErreursOnboarding = Partial<Record<ChampErreurOnboarding, string>>

export type EtatProposition = 'attente' | 'pret' | 'erreur'

export interface EnLigne {
  username: string
  prochaineEtape: NextStep | null
}

const ETAPES: readonly OnboardingEtape[] = [1, 2, 3, 4]

/** Champ de l'API -> champ affiché dans l'interface. */
const CHAMP_API: Readonly<Record<string, ChampErreurOnboarding | undefined>> = {
  titre: 'titre',
  prenom: 'prenom',
  nom: 'nom',
  metier: 'metier',
  ville: 'ville',
  pays: 'pays',
  photoMediaId: 'photo',
  presentation: 'presentation',
  username: 'username',
}

const ETATS_ADRESSE_BLOQUANTS: readonly EtatUsername[] = ['vide', 'verification', 'pris', 'reserve', 'format']

const MESSAGES_USERNAME: Partial<Record<EtatUsername, string>> = {
  pris: 'Cette adresse est déjà prise. Essayez-en une autre.',
  reserve: 'Cette adresse est réservée. Essayez-en une autre.',
  format: 'Utilisez 3 à 30 lettres minuscules, chiffres ou tirets, sans tiret au début ni à la fin.',
  erreur: 'Nous n’avons pas pu vérifier cette adresse. Elle sera contrôlée à la publication.',
}

const MESSAGES_SUIVI: Record<ErreurGeneration, string> = {
  reseau: 'Nous n’arrivons pas à récupérer votre proposition. Vérifiez votre connexion, puis réessayez.',
  delai: 'La proposition prend plus de temps que prévu. Réessayez dans un instant.',
  introuvable: 'Cette proposition est introuvable. Relancez-la pour en obtenir une nouvelle.',
}

const MESSAGE_ECHEC_PROPOSITION = 'Nous n’avons pas pu préparer votre proposition. Réessayez dans un instant.'
const MESSAGE_ECHEC_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Vos informations sont gardées, réessayez dans un instant.'
const MESSAGE_ECHEC_PUBLICATION = 'Nous n’avons pas pu publier votre vitrine. Vos informations sont gardées, réessayez dans un instant.'
const MESSAGE_INCOMPLET_CONTINUER = 'Il manque encore une étape avant de continuer.'
const MESSAGE_INCOMPLET_PUBLIER = 'Il manque encore une étape avant de publier.'
const MESSAGE_PHOTO_REQUISE = 'Ajoutez une photo pour continuer : c’est la première chose que vos visiteurs regardent.'
const MESSAGE_PHOTO_INDISPONIBLE = 'Cette photo n’est plus disponible. Choisissez-en une autre.'
const MESSAGE_PRESENTATION_REQUISE = 'Écrivez quelques mots de présentation.'

function versEtape(valeur: number): OnboardingEtape {
  return ETAPES.find((etape) => etape === valeur) ?? 1
}

/**
 * Parcours d'inscription guidée : état des 4 étapes, enregistrement par étape,
 * génération de la proposition (suivie par `useGeneration`) et publication.
 * L'étape courante vit dans la requête (`?etape=n`), bornée par l'étape de reprise.
 */
export function useOnboarding() {
  const route = useRoute()
  const router = useRouter()

  const onboarding = ref<OnboardingEnCoursDTO | null>(null)
  const chargement = ref(true)
  const erreurChargement = ref(false)
  const enregistrement = ref(false)
  const erreurs = ref<ErreursOnboarding>({})
  const erreurGenerale = ref('')
  const enLigne = ref<EnLigne | null>(null)
  const erreurLancement = ref('')

  const identite = reactive<IdentiteForm>({
    titre: TITRE_AUCUN, prenom: '', nom: '', metier: '', ville: '', pays: PAYS_DEFAUT,
  })
  const photo = ref<MediaDTO | null>(null)
  const generationId = ref<string | null>(null)
  const accrocheIndex = ref(0)
  const presentation = ref('')
  const servicesActifs = ref<boolean[]>(Array.from({ length: SERVICES_PROPOSES }, () => true))
  const username = ref('')
  const palette = ref<Palette>(DEFAULT_PALETTE)

  const { enCours: televersement, erreur: erreurTeleversement, televerser } = useMediaUpload()
  const { etat: etatUsername } = useUsernameDisponible(username)
  const {
    generation, termine: generationTerminee, attenteLongue, erreur: erreurSuivi, relancer, amorcer,
  } = useGeneration(generationId)

  // ---------- Étape courante ----------

  const reprise = computed<OnboardingEtape>(() => onboarding.value?.etapeReprise ?? 1)
  const etape = computed<OnboardingEtape>(() => {
    const demandee = Number.parseInt(String(route.query.etape ?? ''), 10)
    const voulue = Number.isNaN(demandee) ? reprise.value : demandee
    return versEtape(Math.min(Math.max(voulue, 1), reprise.value))
  })

  function reinitialiserMessages(): void {
    erreurs.value = {}
    erreurGenerale.value = ''
  }

  async function allerA(cible: number): Promise<void> {
    reinitialiserMessages()
    erreurLancement.value = ''
    await router.push({ query: { ...route.query, etape: versEtape(cible) } })
  }

  async function retour(): Promise<void> {
    if (etape.value > 1) await allerA(etape.value - 1)
  }

  // ---------- Chargement ----------

  function appliquer(dto: OnboardingEnCoursDTO): void {
    onboarding.value = dto
    generationId.value = dto.generationId
    photo.value = dto.photo ?? photo.value
  }

  function hydraterIdentite(dto: OnboardingEnCoursDTO): void {
    identite.titre = dto.identite.titre ?? TITRE_AUCUN
    identite.prenom = dto.identite.prenom ?? ''
    identite.nom = dto.identite.nom ?? ''
    identite.metier = dto.identite.metier ?? ''
    identite.ville = dto.identite.ville ?? ''
    identite.pays = dto.identite.pays ?? PAYS_DEFAUT
  }

  async function charger(): Promise<void> {
    chargement.value = true
    erreurChargement.value = false
    try {
      const { onboarding: dto } = await $fetch<OnboardingReponse>('/api/studio/onboarding')
      if (dto.statut === 'termine') {
        await navigateTo('/studio', { replace: true })
        return
      }
      appliquer(dto)
      hydraterIdentite(dto)
      if (route.query.etape !== String(etape.value)) {
        await router.replace({ query: { ...route.query, etape: etape.value } })
      }
    } catch {
      erreurChargement.value = true
    } finally {
      chargement.value = false
    }
  }

  /** Le serveur dit qu'il manque une étape : on relit l'état, on y retourne et on l'explique. */
  async function reprendre(message: string): Promise<void> {
    try {
      const { onboarding: dto } = await $fetch<OnboardingReponse>('/api/studio/onboarding')
      if (dto.statut === 'termine') {
        await navigateTo('/studio')
        return
      }
      appliquer(dto)
    } catch {
      // L'étape de reprise connue reste la meilleure estimation.
    }
    await allerA(reprise.value)
    erreurGenerale.value = message
  }

  // ---------- Enregistrement d'une étape ----------

  function erreursDepuisChamps(champs: ErreurApi['champs']): ErreursOnboarding {
    const resultat: ErreursOnboarding = {}
    for (const [champApi, messages] of Object.entries(champs)) {
      const champ = CHAMP_API[champApi]
      const message = messages?.[0]
      if (champ && message) resultat[champ] = message
    }
    return resultat
  }

  async function traiterErreurEtape(erreur: ErreurApi, messageEchec: string): Promise<void> {
    switch (erreur.code) {
      case 'ONBOARDING_TERMINE':
      case 'VITRINE_EXISTE':
        await navigateTo('/studio')
        return
      case 'ONBOARDING_INCOMPLET':
        await reprendre(MESSAGE_INCOMPLET_CONTINUER)
        return
      case 'PROPOSITION_INDISPONIBLE':
        // La proposition n'est pas prête côté serveur : on repart de l'état d'attente.
        generationId.value = null
        return
      case 'MEDIA_INVALIDE':
        photo.value = null
        erreurs.value = { photo: MESSAGE_PHOTO_INDISPONIBLE }
        return
      case 'VALIDATION': {
        const parChamp = erreursDepuisChamps(erreur.champs)
        erreurs.value = parChamp
        if (Object.keys(parChamp).length === 0) erreurGenerale.value = messageEchec
        return
      }
      default:
        erreurGenerale.value = messageEchec
    }
  }

  async function envoyerEtape(corps: OnboardingEtapeInput): Promise<boolean> {
    reinitialiserMessages()
    enregistrement.value = true
    try {
      const { onboarding: dto } = await $fetch<OnboardingReponse>('/api/studio/onboarding', { method: 'PUT', body: corps })
      if (dto.statut === 'termine') {
        await navigateTo('/studio')
        return false
      }
      appliquer(dto)
      return true
    } catch (e) {
      await traiterErreurEtape(lireErreurApi(e), MESSAGE_ECHEC_ENREGISTREMENT)
      return false
    } finally {
      enregistrement.value = false
    }
  }

  async function enregistrerIdentite(): Promise<boolean> {
    const ok = await envoyerEtape({
      etape: 1,
      titre: versTitre(identite.titre),
      prenom: identite.prenom,
      nom: identite.nom,
      metier: identite.metier,
      ville: identite.ville,
      pays: identite.pays,
    })
    if (ok) await allerA(2)
    return ok
  }

  async function televerserPhoto(fichier: File): Promise<void> {
    // Un nouvel essai remplace l'ancien message (« photo requise ») : sinon il masquerait l'erreur d'envoi.
    erreurs.value = { ...erreurs.value, photo: undefined }
    const media = await televerser(fichier)
    if (!media) return
    photo.value = media
  }

  async function enregistrerPhoto(): Promise<boolean> {
    if (!photo.value) {
      reinitialiserMessages()
      erreurs.value = { photo: MESSAGE_PHOTO_REQUISE }
      return false
    }
    const ok = await envoyerEtape({ etape: 2, photoMediaId: photo.value.id })
    if (ok) await allerA(3)
    return ok
  }

  // ---------- Étape 3 : proposition ----------

  let lancementEnCours = false

  const proposition = computed<PropositionOnboardingDTO | null>(() => {
    const courante = generation.value
    return courante?.type === 'onboarding_vitrine' ? courante.resultat : null
  })
  const repli = computed(() => proposition.value !== null && (generation.value?.repli ?? false))

  const etatProposition = computed<EtatProposition>(() => {
    if (proposition.value) return 'pret'
    if (erreurLancement.value || erreurSuivi.value || generationTerminee.value) return 'erreur'
    return 'attente'
  })
  const messageErreurProposition = computed(() => {
    if (erreurLancement.value) return erreurLancement.value
    return erreurSuivi.value ? MESSAGES_SUIVI[erreurSuivi.value] : MESSAGE_ECHEC_PROPOSITION
  })

  async function lancerGeneration(): Promise<void> {
    if (lancementEnCours) return
    lancementEnCours = true
    erreurLancement.value = ''
    try {
      const reponse = await $fetch<GenerationLanceeReponse>('/api/studio/onboarding/generer', { method: 'POST', body: {} })
      amorcer(reponse.generation)
      generationId.value = reponse.generation.id
    } catch (e) {
      const erreur = lireErreurApi(e)
      if (erreur.code === 'ONBOARDING_TERMINE' || erreur.code === 'VITRINE_EXISTE') await navigateTo('/studio')
      else if (erreur.code === 'ONBOARDING_INCOMPLET') await reprendre(MESSAGE_INCOMPLET_CONTINUER)
      else if (erreur.code === 'TROP_DE_REQUETES') erreurLancement.value = messageTropDeDemandes(erreur.retryAfter)
      else erreurLancement.value = MESSAGE_ECHEC_PROPOSITION
    } finally {
      lancementEnCours = false
    }
  }

  /** Bouton « Réessayer » : relance le suivi, ou une nouvelle demande si rien n'est suivi. */
  async function reessayerProposition(): Promise<void> {
    erreurLancement.value = ''
    if (generationId.value === null || erreurSuivi.value === 'introuvable') {
      generationId.value = null
      await lancerGeneration()
      return
    }
    relancer()
  }

  // Arrivée sur l'étape 3 sans génération : on la demande (la même identité ne relance rien côté serveur).
  watch([etape, onboarding, generationId], ([courante, charge, id]) => {
    if (!import.meta.client) return
    if (courante === 3 && charge && id === null && !lancementEnCours && erreurLancement.value === '') {
      void lancerGeneration()
    }
  }, { immediate: true })

  // Valeurs modifiables de l'étape 3 : brouillon déjà validé s'il existe, sinon texte proposé.
  let hydrateePour: string | null = null
  watch(proposition, (propose) => {
    const courante = generation.value
    if (!propose || !courante || hydrateePour === courante.id) return
    hydrateePour = courante.id
    const brouillon = onboarding.value?.proposition ?? null
    if (brouillon) {
      const index = propose.accroches.indexOf(brouillon.accroche)
      accrocheIndex.value = Math.max(index, 0)
      presentation.value = brouillon.presentation
      servicesActifs.value = propose.services.map((_, i) => brouillon.services[i]?.actif ?? true)
    } else {
      accrocheIndex.value = 0
      presentation.value = propose.presentation
      servicesActifs.value = propose.services.map(() => true)
    }
  })

  async function validerProposition(): Promise<boolean> {
    const texte = presentation.value.trim()
    if (!proposition.value) return false
    if (texte === '') {
      reinitialiserMessages()
      erreurs.value = { presentation: MESSAGE_PRESENTATION_REQUISE }
      return false
    }
    const ok = await envoyerEtape({
      etape: 3,
      accrocheIndex: accrocheIndex.value,
      presentation: texte,
      servicesActifs: servicesActifs.value,
    })
    if (ok) await allerA(4)
    return ok
  }

  // ---------- Étape 4 : adresse et publication ----------

  // L'adresse suggérée remplit le champ tant que la personne n'y a pas touché.
  let derniereSuggestion = ''
  watch([etape, onboarding], ([courante, charge]) => {
    if (courante !== 4 || !charge) return
    const suggestion = charge.usernameSuggere
    if (username.value === '' || username.value === derniereSuggestion) username.value = suggestion
    derniereSuggestion = suggestion
  }, { immediate: true })

  watch(username, () => {
    if (erreurs.value.username) erreurs.value = { ...erreurs.value, username: undefined }
  })

  const erreurUsername = computed(() => erreurs.value.username ?? MESSAGES_USERNAME[etatUsername.value])
  const peutPublier = computed(() => !ETATS_ADRESSE_BLOQUANTS.includes(etatUsername.value))

  async function publier(): Promise<boolean> {
    reinitialiserMessages()
    enregistrement.value = true
    try {
      const { vitrine, resume } = await $fetch<OnboardingTerminerReponse>('/api/studio/onboarding/terminer', {
        method: 'POST',
        body: { username: username.value.trim().toLowerCase(), palette: palette.value },
      })
      enLigne.value = { username: vitrine.username, prochaineEtape: resume.prochaineEtape }
      return true
    } catch (e) {
      const erreur = lireErreurApi(e)
      if (erreur.code === 'USERNAME_PRIS') {
        erreurs.value = { username: MESSAGES_USERNAME.pris }
      } else if (erreur.code === 'VALIDATION' && erreur.champs.username?.length) {
        erreurs.value = { username: MESSAGES_USERNAME.format }
      } else if (erreur.code === 'ONBOARDING_INCOMPLET') {
        await reprendre(MESSAGE_INCOMPLET_PUBLIER)
      } else if (erreur.code === 'ONBOARDING_TERMINE' || erreur.code === 'VITRINE_EXISTE') {
        await navigateTo('/studio')
      } else {
        erreurGenerale.value = MESSAGE_ECHEC_PUBLICATION
      }
      return false
    } finally {
      enregistrement.value = false
    }
  }

  /** Action du bouton principal de l'étape courante ; `false` si l'étape n'a pas pu avancer. */
  async function continuer(): Promise<boolean> {
    if (enregistrement.value) return false
    switch (etape.value) {
      case 1: return enregistrerIdentite()
      case 2: return enregistrerPhoto()
      case 3: return validerProposition()
      default: return publier()
    }
  }

  const sousTitre = computed(() =>
    etape.value === 3 && repli.value ? SOUS_TITRE_REPLI : SOUS_TITRES_ECRAN[etape.value],
  )

  return {
    // État général
    etape, etapeTotal: ONBOARDING_ETAPES_TOTAL, sousTitre, chargement, erreurChargement,
    enregistrement, erreurs, erreurGenerale, enLigne,
    // Étape 1
    identite,
    // Étape 2
    photo, televersement, erreurTeleversement, televerserPhoto,
    // Étape 3
    proposition, repli, etatProposition, messageErreurProposition, attenteLongue,
    accrocheIndex, presentation, servicesActifs, reessayerProposition,
    // Étape 4
    username, palette, etatUsername, erreurUsername, peutPublier,
    // Actions
    charger, continuer, retour,
  }
}
