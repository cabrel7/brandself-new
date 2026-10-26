import type { VitrineStudioDTO } from '#shared/dto'
import type { Palette } from '#shared/palettes'
import { displayName } from '#shared/vitrine'
import type { Titre } from '#shared/vitrine'

/** Valeur « aucun titre » : un `USelect` n'accepte pas de valeur vide. */
export const AUCUN_TITRE = 'aucun'
const DUREE_CONFIRMATION_MS = 2000
const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Vos modifications sont gardées, réessayez dans un instant.'
const ERREUR_PHOTO = 'Cette photo n’est plus disponible. Choisissez-en une autre.'
const ERREUR_CHAMP_REQUIS = 'Cette information est nécessaire tant que votre vitrine est en ligne.'
const ERREUR_PUBLICATION_INCOMPLETE = 'Votre vitrine est en ligne : complétez les informations signalées, ou dépubliez-la d’abord.'

export interface ProfilForm {
  titre: Titre | typeof AUCUN_TITRE
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string | undefined
  accroche: string
  bio: string
  emailContact: string
  telephone: string
  whatsapp: string
  palette: Palette
  photoMediaId: string | null
}

export type ChampProfil = keyof ProfilForm

/** « +237 6 00-00.00.00 » -> « +237600000000 » (format E.164 attendu par l'API). */
export function normaliserTelephone(valeur: string): string {
  return valeur.replace(/[\s().-]/g, '')
}

function depuisVitrine(vitrine: VitrineStudioDTO): ProfilForm {
  return {
    titre: vitrine.titre ?? AUCUN_TITRE,
    prenom: vitrine.prenom,
    nom: vitrine.nom,
    metier: vitrine.metier,
    ville: vitrine.ville ?? '',
    pays: vitrine.pays ?? undefined,
    accroche: vitrine.accroche ?? '',
    bio: vitrine.bio ?? '',
    emailContact: vitrine.emailContact ?? '',
    telephone: vitrine.telephone ?? '',
    whatsapp: vitrine.whatsapp ?? '',
    palette: vitrine.palette,
    photoMediaId: vitrine.photo?.id ?? null,
  }
}

function valeurEnvoyee(form: ProfilForm, champ: ChampProfil): string | null {
  switch (champ) {
    case 'titre': return form.titre === AUCUN_TITRE ? null : form.titre
    case 'pays': return form.pays ?? null
    case 'photoMediaId': return form.photoMediaId
    case 'telephone':
    case 'whatsapp': {
      const normalise = normaliserTelephone(form[champ])
      return normalise === '' ? null : normalise
    }
    default: return form[champ]
  }
}

/** Champs de l'API affichés sous le champ correspondant (la photo a son propre message). */
function cibleErreur(champ: string): ChampProfil | null {
  const champs: readonly string[] = [
    'titre', 'prenom', 'nom', 'metier', 'ville', 'pays', 'accroche', 'bio',
    'emailContact', 'telephone', 'whatsapp', 'palette', 'photoMediaId',
  ]
  return champs.includes(champ) ? (champ as ChampProfil) : null
}

/**
 * Formulaire du profil : enregistrement explicite, envoi des seuls champs
 * modifiés, erreurs 400 `data.champs` rangées par champ.
 */
export function useProfilForm(vitrine: Ref<VitrineStudioDTO | null>, rafraichir: () => Promise<void>) {
  const form = reactive<ProfilForm>({
    titre: AUCUN_TITRE, prenom: '', nom: '', metier: '', ville: '', pays: undefined,
    accroche: '', bio: '', emailContact: '', telephone: '', whatsapp: '',
    palette: 'terracotta', photoMediaId: null,
  })
  const base = ref<ProfilForm | null>(null)
  const erreurs = ref<Partial<Record<ChampProfil, string>>>({})
  const erreurGenerale = ref('')
  const enregistrement = ref(false)
  const enregistre = ref(false)
  const { start: masquerConfirmation, stop: annulerMasquage } = useTimeoutFn(() => {
    enregistre.value = false
  }, DUREE_CONFIRMATION_MS, { immediate: false })

  function reinitialiser(source: VitrineStudioDTO): void {
    const valeurs = depuisVitrine(source)
    Object.assign(form, valeurs)
    base.value = valeurs
  }

  // Charge les valeurs serveur une fois, puis à chaque enregistrement réussi.
  watch(vitrine, (courante, precedente) => {
    if (courante && !precedente) reinitialiser(courante)
  }, { immediate: true })

  const modifies = computed<ChampProfil[]>(() => {
    const reference = base.value
    if (!reference) return []
    const champs = Object.keys(form) as ChampProfil[]
    return champs.filter((champ) => valeurEnvoyee(form, champ) !== valeurEnvoyee(reference, champ))
  })
  const aDesModifications = computed(() => modifies.value.length > 0)
  const nomAffiche = computed(() =>
    displayName(form.titre === AUCUN_TITRE ? null : form.titre, form.prenom, form.nom),
  )

  function viderErreur(champ: ChampProfil): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  async function enregistrer(): Promise<void> {
    if (!aDesModifications.value || enregistrement.value) return
    erreurs.value = {}
    erreurGenerale.value = ''
    annulerMasquage()
    enregistre.value = false
    enregistrement.value = true

    const corps: Record<string, string | null> = {}
    for (const champ of modifies.value) corps[champ] = valeurEnvoyee(form, champ)

    try {
      await $fetch('/api/studio/vitrine', { method: 'PUT', body: corps })
      await rafraichir()
      if (vitrine.value) reinitialiser(vitrine.value)
      enregistre.value = true
      masquerConfirmation()
    } catch (e) {
      const erreur = lireErreurApi(e)
      if (erreur.code === 'VALIDATION') {
        const parChamp: Partial<Record<ChampProfil, string>> = {}
        for (const [nom, messages] of Object.entries(erreur.champs)) {
          const cible = cibleErreur(nom)
          const message = messages?.[0]
          if (cible && message) parChamp[cible] = message
        }
        erreurs.value = parChamp
        if (Object.keys(parChamp).length === 0) erreurGenerale.value = ERREUR_ENREGISTREMENT
      } else if (erreur.code === 'MEDIA_INVALIDE') {
        erreurs.value = { photoMediaId: ERREUR_PHOTO }
      } else if (erreur.code === 'PUBLICATION_INCOMPLETE') {
        // Vitrine en ligne : ces informations ne peuvent pas être retirées (422 + data.manquants).
        const parChamp: Partial<Record<ChampProfil, string>> = {}
        for (const nom of erreur.manquants) {
          const cible = cibleErreur(nom)
          if (cible) parChamp[cible] = ERREUR_CHAMP_REQUIS
        }
        erreurs.value = parChamp
        erreurGenerale.value = ERREUR_PUBLICATION_INCOMPLETE
      } else {
        erreurGenerale.value = ERREUR_ENREGISTREMENT
      }
    } finally {
      enregistrement.value = false
    }
  }

  return {
    form, erreurs, erreurGenerale, enregistrement, enregistre,
    aDesModifications, nomAffiche, viderErreur, enregistrer,
  }
}
