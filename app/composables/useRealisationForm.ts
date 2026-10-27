import type { MediaDTO, RealisationStudioDTO, RealisationsCompteursDTO } from '#shared/dto'
import { anneeCourante, libelleVedetteRealisations } from '#shared/realisations'

const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Vos modifications sont gardées, réessayez dans un instant.'
const ERREUR_SUPPRESSION = 'Nous n’avons pas pu supprimer cette réalisation. Réessayez dans un instant.'
const ERREUR_IMAGE_REQUISE = 'Ajoutez une image principale.'
const ERREUR_IMAGE_INDISPONIBLE = 'Une de vos images n’est plus disponible. Remplacez-la, puis réessayez.'
const ERREUR_ANNEE = 'Saisissez l’année en chiffres, par exemple 2025.'
const REGEX_ENTIER = /^\d+$/

export type ChampRealisation =
  | 'titre' | 'description' | 'imageMediaId' | 'galerie' | 'annee' | 'lieu' | 'role' | 'lien' | 'enVedette' | 'actif'

const CHAMPS: readonly ChampRealisation[] = [
  'titre', 'description', 'imageMediaId', 'galerie', 'annee', 'lieu', 'role', 'lien', 'enVedette', 'actif',
]

type Erreurs = Partial<Record<ChampRealisation, string>>

/** Saisie du formulaire : l'année reste du texte jusqu'à l'envoi. */
export interface RealisationForm {
  titre: string
  description: string
  annee: string
  lieu: string
  role: string
  lien: string
  enVedette: boolean
  actif: boolean
}

/** Corps envoyé à l'API (POST : complet ; PUT : seuls les champs modifiés). */
export interface CorpsRealisation {
  titre: string
  description: string | null
  imageMediaId: string | null
  galerie: string[]
  annee: number | null
  lieu: string | null
  role: string | null
  lien: string | null
  enVedette: boolean
  actif: boolean
}

export interface OptionsRealisationForm {
  /** `null` : création. */
  realisation: RealisationStudioDTO | null
  compteurs: RealisationsCompteursDTO
}

function texteOuNull(texte: string): string | null {
  const propre = texte.trim()
  return propre === '' ? null : propre
}

/** Saisie -> entier ; `null` si vide, `undefined` si ce n'est pas un entier. */
function lireEntier(texte: string): number | null | undefined {
  const propre = texte.trim()
  if (propre === '') return null
  return REGEX_ENTIER.test(propre) ? Number(propre) : undefined
}

function lireFormulaire(
  f: RealisationForm,
  image: MediaDTO | null,
  galerie: readonly MediaDTO[],
): { corps: CorpsRealisation, erreurs: Erreurs } {
  const erreurs: Erreurs = {}
  const annee = lireEntier(f.annee)
  if (annee === undefined) erreurs.annee = ERREUR_ANNEE
  return {
    erreurs,
    corps: {
      titre: f.titre.trim(),
      description: texteOuNull(f.description),
      imageMediaId: image?.id ?? null,
      galerie: galerie.map((media) => media.id),
      annee: annee ?? null,
      lieu: texteOuNull(f.lieu),
      role: texteOuNull(f.role),
      lien: texteOuNull(f.lien),
      enVedette: f.enVedette,
      actif: f.actif,
    },
  }
}

/** Corps tel que le serveur le connaît : référence de comparaison pour n'envoyer que les modifications. */
function corpsDeLaRealisation(r: RealisationStudioDTO): CorpsRealisation {
  return {
    titre: r.titre,
    description: r.description,
    imageMediaId: r.image?.id ?? null,
    galerie: r.galerie.map((media) => media.id),
    annee: r.annee,
    lieu: r.lieu,
    role: r.role,
    lien: r.lien,
    enVedette: r.enVedette,
    actif: r.actif,
  }
}

function formulaireInitial(o: OptionsRealisationForm): RealisationForm {
  const r = o.realisation
  const placeEnVedette = o.compteurs.enVedette < o.compteurs.vedetteMax
  return {
    titre: r?.titre ?? '',
    description: r?.description ?? '',
    // Création : l'année en cours est proposée (décision #54).
    annee: r ? (r.annee === null ? '' : String(r.annee)) : String(anneeCourante()),
    lieu: r?.lieu ?? '',
    role: r?.role ?? '',
    lien: r?.lien ?? '',
    enVedette: r ? r.enVedette : placeEnVedette,
    actif: r?.actif ?? true,
  }
}

/** `data.enVedette` de VEDETTE_COMPLETE (non exposé par `lireErreurApi`). */
function lireEnVedette(erreur: unknown): string[] {
  if (typeof erreur !== 'object' || erreur === null) return []
  const corps = (erreur as { data?: { data?: { enVedette?: unknown } } }).data
  const liste = corps?.data?.enVedette
  if (!Array.isArray(liste)) return []
  return liste.flatMap((entree: unknown) => {
    const titre = (entree as { titre?: unknown } | null)?.titre
    return typeof titre === 'string' ? [titre] : []
  })
}

function messageVedetteComplete(max: number, titres: string[]): string {
  const detail = titres.length > 0 ? ` : ${titres.join(', ')}` : ''
  return `Vous avez déjà ${max} réalisations en vedette${detail}. Retirez-en une pour mettre celle-ci en avant.`
}

/** `galerie.2` -> `galerie` : l'API peut désigner un élément de la liste. */
function champRacine(nom: string): ChampRealisation | undefined {
  const racine = nom.split('.')[0]
  return CHAMPS.find((champ) => champ === racine)
}

/**
 * Formulaire d'une réalisation (création si `realisation` est null, sinon modification) :
 * galerie locale (ajout, retrait, ordre), envoi des seuls champs modifiés,
 * erreurs de l'API rangées par champ.
 */
export function useRealisationForm(options: OptionsRealisationForm) {
  const { realisation, compteurs } = options

  const form = reactive<RealisationForm>(formulaireInitial(options))
  const image = ref<MediaDTO | null>(realisation?.image ?? null)
  const galerie = ref<MediaDTO[]>(realisation ? [...realisation.galerie] : [])
  const erreurs = ref<Erreurs>({})
  const erreurGenerale = ref('')
  const enregistrement = ref(false)
  const introuvable = ref(false)

  const suppressionOuverte = ref(false)
  const suppressionEnCours = ref(false)
  const erreurSuppression = ref('')

  const referenceCorps = realisation ? corpsDeLaRealisation(realisation) : null

  const corpsCourant = computed(() => lireFormulaire(form, image.value, galerie.value).corps)
  const champsModifies = computed<(keyof CorpsRealisation)[]>(() => {
    if (!referenceCorps) return []
    const courant = corpsCourant.value
    return (Object.keys(courant) as (keyof CorpsRealisation)[])
      .filter((cle) => JSON.stringify(courant[cle]) !== JSON.stringify(referenceCorps[cle]))
  })
  const aDesModifications = computed(() => (realisation ? champsModifies.value.length > 0 : true))

  function viderErreur(champ: ChampRealisation): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  // Cohérence immédiate (le serveur la revérifie) : masqué => pas en vedette.
  watch(() => form.actif, (actif) => {
    if (!actif) form.enVedette = false
  })

  // Vedette : la réalisation elle-même ne compte pas dans le plafond.
  const vedetteComplete = computed(() => compteurs.enVedette - (realisation?.enVedette ? 1 : 0) >= compteurs.vedetteMax)
  const vedetteBloquee = computed(() => !form.actif || vedetteComplete.value)
  const aideVedette = computed(() => {
    if (!form.actif) return 'Une réalisation masquée ne peut pas être en vedette.'
    const etat = libelleVedetteRealisations(compteurs.enVedette, compteurs.vedetteMax)
    return vedetteComplete.value ? `${etat} Retirez-en une pour en ajouter une autre.` : etat
  })

  // Image principale
  function choisirImage(media: MediaDTO): void {
    image.value = media
    viderErreur('imageMediaId')
  }

  // Galerie
  /** La liste (ajout, retrait, ordre) est tenue par StudioRealisationGalerie ; elle arrive ici complète. */
  function majGalerie(images: MediaDTO[]): void {
    galerie.value = images
    viderErreur('galerie')
  }

  function rangerErreur(e: unknown): void {
    const erreur = lireErreurApi(e)
    if (erreur.code === 'VALIDATION') {
      const parChamp: Erreurs = {}
      for (const [nom, messages] of Object.entries(erreur.champs)) {
        const cible = champRacine(nom)
        const message = messages?.[0]
        if (cible && message && !parChamp[cible]) parChamp[cible] = message
      }
      erreurs.value = parChamp
      if (Object.keys(parChamp).length === 0) erreurGenerale.value = ERREUR_ENREGISTREMENT
    }
    else if (erreur.code === 'VEDETTE_COMPLETE') {
      erreurs.value = { enVedette: messageVedetteComplete(compteurs.vedetteMax, lireEnVedette(e)) }
    }
    else if (erreur.code === 'MEDIA_INVALIDE') {
      erreurs.value = { imageMediaId: ERREUR_IMAGE_INDISPONIBLE }
    }
    else if (erreur.code === 'REALISATION_INTROUVABLE') {
      introuvable.value = true
    }
    else {
      erreurGenerale.value = ERREUR_ENREGISTREMENT
    }
  }

  async function terminer(): Promise<void> {
    await Promise.all([refreshNuxtData(CLE_REALISATIONS), refreshNuxtData('studio-vitrine')])
    await navigateTo('/studio/realisations')
  }

  async function enregistrer(): Promise<void> {
    if (enregistrement.value || !aDesModifications.value) return
    erreurs.value = {}
    erreurGenerale.value = ''
    const { corps, erreurs: locales } = lireFormulaire(form, image.value, galerie.value)
    // Seul contrôle client de présence : le serveur fait foi pour le reste.
    if (!image.value) locales.imageMediaId = ERREUR_IMAGE_REQUISE
    if (Object.keys(locales).length > 0) {
      erreurs.value = locales
      return
    }

    enregistrement.value = true
    try {
      if (realisation) {
        const modification: Partial<CorpsRealisation> = {}
        for (const cle of champsModifies.value) Object.assign(modification, { [cle]: corps[cle] })
        await $fetch(`/api/studio/realisations/${realisation.id}`, { method: 'PUT', body: modification })
      }
      else {
        await $fetch('/api/studio/realisations', { method: 'POST', body: corps })
      }
      await terminer()
    }
    catch (e) {
      rangerErreur(e)
    }
    finally {
      enregistrement.value = false
    }
  }

  async function supprimer(): Promise<void> {
    if (!realisation || suppressionEnCours.value) return
    erreurSuppression.value = ''
    suppressionEnCours.value = true
    try {
      await $fetch(`/api/studio/realisations/${realisation.id}`, { method: 'DELETE' })
      suppressionOuverte.value = false
      await terminer()
    }
    catch (e) {
      // Déjà supprimée ailleurs : le résultat voulu est atteint.
      if (lireErreurApi(e).code === 'REALISATION_INTROUVABLE') {
        suppressionOuverte.value = false
        await terminer()
      }
      else {
        erreurSuppression.value = ERREUR_SUPPRESSION
      }
    }
    finally {
      suppressionEnCours.value = false
    }
  }

  return {
    form, image, galerie, erreurs, erreurGenerale, enregistrement, introuvable, aDesModifications, viderErreur,
    vedetteBloquee, aideVedette,
    choisirImage, majGalerie, enregistrer,
    suppressionOuverte, suppressionEnCours, erreurSuppression, supprimer,
  }
}
