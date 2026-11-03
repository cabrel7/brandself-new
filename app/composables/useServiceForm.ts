import type { LimiteAtteinte } from '~/composables/useLimitePlan'
import { DEVISES } from '#shared/compte'
import type { Devise } from '#shared/compte'
import type { MediaDTO, ServiceStudioDTO, ServicesCompteursDTO } from '#shared/dto'
import { DEVISE_DECIMALES, formatPrixSaisi, parsePrixSaisi } from '#shared/devises'
import {
  DUREE_REQUISE,
  PAIEMENT_MODES_HORS_LIGNE,
  PAIEMENT_MODE_LIBELLES,
  PAIEMENT_MODES,
  RYTHMES,
  RYTHME_LIBELLES,
  SERVICE_TYPES,
  SERVICE_TYPE_LIBELLES,
  TARIFS,
  TARIF_LIBELLES,
} from '#shared/services'
import type { PaiementMode, Rythme, ServiceType, Tarif } from '#shared/services'

/** Valeur « aucun rythme » : un `USelect` n'accepte pas de valeur vide. */
export const AUCUN_RYTHME = 'aucun'

const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Vos modifications sont gardées, réessayez dans un instant.'
const ERREUR_SUPPRESSION = 'Nous n’avons pas pu supprimer ce service. Réessayez dans un instant.'
const ERREUR_PHOTO = 'Cette photo n’est plus disponible. Choisissez-en une autre.'
const ERREUR_PAIEMENT_EN_LIGNE = 'Le paiement en ligne n’est pas encore disponible. Choisissez le règlement sur place.'
const ERREUR_ENTIER = 'Saisissez un nombre entier.'
const ERREUR_PRIX_VIDE = 'Indiquez le prix.'
const ERREUR_PRIX_ENTIER = 'Saisissez un montant entier, sans décimales.'
const ERREUR_PRIX_DECIMAL = 'Saisissez un montant valide, par exemple 12,50.'
const REGEX_ENTIER = /^\d+$/

export type ChampService =
  | 'titre' | 'description' | 'imageMediaId' | 'type' | 'nbSeances' | 'rythme' | 'dureeMin' | 'tarif'
  | 'prix' | 'devise' | 'paiementMode' | 'paiementInstructions' | 'inclus' | 'reservable' | 'enVedette' | 'actif'

/** Champs de l'API -> champ du formulaire qui porte le message. */
const CHAMP_DEPUIS_API: Record<string, ChampService> = {
  titre: 'titre',
  description: 'description',
  imageMediaId: 'imageMediaId',
  type: 'type',
  nbSeances: 'nbSeances',
  rythme: 'rythme',
  dureeMin: 'dureeMin',
  tarif: 'tarif',
  prixMontant: 'prix',
  prixDevise: 'devise',
  paiementMode: 'paiementMode',
  paiementInstructions: 'paiementInstructions',
  inclus: 'inclus',
  reservable: 'reservable',
  enVedette: 'enVedette',
  actif: 'actif',
}

type Erreurs = Partial<Record<ChampService, string>>

/** Saisie du formulaire : les nombres restent du texte jusqu'à l'envoi. */
export interface ServiceForm {
  titre: string
  description: string
  type: ServiceType
  nbSeances: string
  dureeMin: string
  rythme: Rythme | typeof AUCUN_RYTHME
  tarif: Tarif
  prix: string
  devise: Devise
  paiementMode: PaiementMode
  paiementInstructions: string
  inclus: string
  reservable: boolean
  enVedette: boolean
  actif: boolean
}

/** Corps envoyé à l'API (POST : complet ; PUT : seuls les champs modifiés). */
export interface CorpsService {
  titre: string
  description: string | null
  imageMediaId: string | null
  type: ServiceType
  nbSeances: number | null
  rythme: Rythme | null
  dureeMin: number | null
  tarif: Tarif
  prixMontant: number | null
  prixDevise: Devise | null
  paiementMode: PaiementMode | null
  paiementInstructions: string | null
  inclus: string[]
  reservable: boolean
  enVedette: boolean
  actif: boolean
}

export interface OptionsServiceForm {
  service: ServiceStudioDTO | null
  compteurs: ServicesCompteursDTO
  deviseParDefaut: Devise
}

interface Item<T extends string> { label: string, value: T, disabled?: boolean }

export const ITEMS_TYPES: Item<ServiceType>[] = SERVICE_TYPES.map((value) => ({ label: SERVICE_TYPE_LIBELLES[value], value }))
export const ITEMS_RYTHMES: Item<Rythme | typeof AUCUN_RYTHME>[] = [
  { label: 'Non précisé', value: AUCUN_RYTHME },
  ...RYTHMES.map((value) => ({ label: RYTHME_LIBELLES[value], value })),
]
export const ITEMS_DEVISES_SERVICE: Item<Devise>[] = DEVISES.map((value) => ({ label: value, value }))

/** Saisie -> entier ; `null` si vide, `undefined` si ce n'est pas un entier. */
function lireEntier(texte: string): number | null | undefined {
  const propre = texte.trim()
  if (propre === '') return null
  return REGEX_ENTIER.test(propre) ? Number(propre) : undefined
}

function lignes(texte: string): string[] {
  return texte.split('\n').map((ligne) => ligne.trim()).filter((ligne) => ligne !== '')
}

function messagePrix(devise: Devise): string {
  return DEVISE_DECIMALES[devise] === 0 ? ERREUR_PRIX_ENTIER : ERREUR_PRIX_DECIMAL
}

function lireFormulaire(f: ServiceForm, imageMediaId: string | null): { corps: CorpsService, erreurs: Erreurs } {
  const erreurs: Erreurs = {}
  const accompagnement = f.type === 'accompagnement'
  const tarif: Tarif = f.type === 'devis' ? 'devis' : f.tarif
  const payant = tarif === 'payant'

  const seances = accompagnement ? lireEntier(f.nbSeances) : null
  if (seances === undefined) erreurs.nbSeances = ERREUR_ENTIER
  const duree = lireEntier(f.dureeMin)
  if (duree === undefined) erreurs.dureeMin = ERREUR_ENTIER

  let prix: number | null = null
  if (payant) {
    if (f.prix.trim() === '') {
      erreurs.prix = ERREUR_PRIX_VIDE
    }
    else {
      prix = parsePrixSaisi(f.prix, f.devise)
      if (prix === null) erreurs.prix = messagePrix(f.devise)
    }
  }

  const instructions = f.paiementInstructions.trim()
  const description = f.description.trim()
  return {
    erreurs,
    corps: {
      titre: f.titre.trim(),
      description: description === '' ? null : description,
      imageMediaId,
      type: f.type,
      nbSeances: seances ?? null,
      rythme: accompagnement && f.rythme !== AUCUN_RYTHME ? f.rythme : null,
      dureeMin: duree ?? null,
      tarif,
      prixMontant: prix,
      prixDevise: payant ? f.devise : null,
      paiementMode: payant ? f.paiementMode : null,
      paiementInstructions: payant && instructions !== '' ? instructions : null,
      inclus: lignes(f.inclus),
      reservable: f.reservable,
      enVedette: f.enVedette,
      actif: f.actif,
    },
  }
}

/** Corps tel que le serveur le connaît : référence de comparaison pour n'envoyer que les modifications. */
function corpsDuService(s: ServiceStudioDTO): CorpsService {
  return {
    titre: s.titre,
    description: s.description,
    imageMediaId: s.image?.id ?? null,
    type: s.type,
    nbSeances: s.nbSeances,
    rythme: s.rythme,
    dureeMin: s.dureeMin,
    tarif: s.tarif,
    prixMontant: s.prixMontant,
    prixDevise: s.prixDevise,
    paiementMode: s.paiementMode,
    paiementInstructions: s.paiementInstructions,
    inclus: s.inclus,
    reservable: s.reservable,
    enVedette: s.enVedette,
    actif: s.actif,
  }
}

function formulaireInitial(o: OptionsServiceForm, modesAutorises: readonly PaiementMode[]): ServiceForm {
  const s = o.service
  const mode = s?.paiementMode
  const placeEnVedette = o.compteurs.enVedette < o.compteurs.vedetteMax
  return {
    titre: s?.titre ?? '',
    description: s?.description ?? '',
    type: s?.type ?? 'rdv',
    nbSeances: s?.nbSeances === null || s?.nbSeances === undefined ? '' : String(s.nbSeances),
    dureeMin: s?.dureeMin === null || s?.dureeMin === undefined ? '' : String(s.dureeMin),
    rythme: s?.rythme ?? AUCUN_RYTHME,
    tarif: s?.tarif ?? 'payant',
    prix: s?.prixMontant != null && s.prixDevise ? formatPrixSaisi(s.prixMontant, s.prixDevise) : '',
    devise: s?.prixDevise ?? o.deviseParDefaut,
    // Un mode que l'API refuserait (paiement en ligne désactivé) est ramené au règlement sur place.
    paiementMode: mode && modesAutorises.includes(mode) ? mode : 'sur_place',
    paiementInstructions: s?.paiementInstructions ?? '',
    inclus: s?.inclus.join('\n') ?? '',
    reservable: s?.reservable ?? true,
    enVedette: s ? s.enVedette : placeEnVedette,
    actif: s?.actif ?? true,
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
  return `Vous avez déjà ${max} services en vedette${detail}. Retirez-en un pour mettre celui-ci en avant.`
}

function libelleService(n: number): string {
  return `${n} service${n > 1 ? 's' : ''}`
}

/**
 * Formulaire d'un service (création si `service` est null, sinon modification) :
 * règles d'affichage conditionnel, conversion du prix, envoi des seuls champs
 * modifiés, erreurs de l'API rangées par champ.
 */
export function useServiceForm(options: OptionsServiceForm) {
  const { service, compteurs } = options
  const paiementEnLigne = useRuntimeConfig().public.paiementEnLigne
  const modesAutorises: readonly PaiementMode[] = paiementEnLigne ? PAIEMENT_MODES : PAIEMENT_MODES_HORS_LIGNE

  const form = reactive<ServiceForm>(formulaireInitial(options, modesAutorises))
  const image = ref<MediaDTO | null>(service?.image ?? null)
  const erreurs = ref<Erreurs>({})
  const erreurGenerale = ref('')
  /** Création refusée : limite du plan atteinte (un seul message, à la place de l'erreur générale). */
  const limiteAtteinte = ref<LimiteAtteinte | null>(null)
  const enregistrement = ref(false)
  const introuvable = ref(false)

  const suppressionOuverte = ref(false)
  const suppressionEnCours = ref(false)
  const erreurSuppression = ref('')

  const referenceCorps = service ? corpsDuService(service) : null

  const corpsCourant = computed(() => lireFormulaire(form, image.value?.id ?? null).corps)
  const champsModifies = computed<(keyof CorpsService)[]>(() => {
    if (!referenceCorps) return []
    const courant = corpsCourant.value
    return (Object.keys(courant) as (keyof CorpsService)[])
      .filter((cle) => JSON.stringify(courant[cle]) !== JSON.stringify(referenceCorps[cle]))
  })
  const aDesModifications = computed(() => (service ? champsModifies.value.length > 0 : true))

  function viderErreur(champ: ChampService): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  // Cohérence immédiate (le serveur la revérifie) : devis => tarif « sur devis » ; masqué => pas en vedette.
  watch(() => form.type, (type) => {
    if (type === 'devis') form.tarif = 'devis'
  })
  watch(() => form.actif, (actif) => {
    if (!actif) form.enVedette = false
  })

  // Affichage conditionnel
  const accompagnement = computed(() => form.type === 'accompagnement')
  const dureeRequise = computed(() => DUREE_REQUISE[form.type])
  const tarifVerrouille = computed(() => form.type === 'devis')
  const payant = computed(() => form.tarif === 'payant')
  const libellePrix = computed(() => (accompagnement.value ? 'Prix du forfait' : 'Prix'))
  const prixDecimal = computed(() => DEVISE_DECIMALES[form.devise] > 0)
  const itemsTarifs = computed<Item<Tarif>[]>(() =>
    TARIFS.map((value) => ({ label: TARIF_LIBELLES[value], value, disabled: tarifVerrouille.value && value !== 'devis' })),
  )
  const itemsPaiement = modesAutorises.map((value) => ({
    value,
    label: PAIEMENT_MODE_LIBELLES[value].titre,
    description: PAIEMENT_MODE_LIBELLES[value].description,
  }))

  // Vedette : le service lui-même ne compte pas dans le plafond.
  const vedetteComplete = computed(() => compteurs.enVedette - (service?.enVedette ? 1 : 0) >= compteurs.vedetteMax)
  const vedetteBloquee = computed(() => !form.actif || vedetteComplete.value)
  const aideVedette = computed(() => {
    if (!form.actif) return 'Un service masqué ne peut pas être en vedette.'
    const etat = `${libelleService(compteurs.enVedette)} sur ${compteurs.vedetteMax} en vedette.`
    return vedetteComplete.value ? `${etat} Retirez-en un pour en ajouter un autre.` : etat
  })

  function choisirImage(media: MediaDTO): void {
    image.value = media
    viderErreur('imageMediaId')
  }

  function retirerImage(): void {
    image.value = null
    viderErreur('imageMediaId')
  }

  function rangerErreur(e: unknown): void {
    const erreur = lireErreurApi(e)
    const limite = lireLimitePlan(e, 'services')
    if (limite) {
      limiteAtteinte.value = limite
    }
    else if (erreur.code === 'VALIDATION') {
      const parChamp: Erreurs = {}
      for (const [nom, messages] of Object.entries(erreur.champs)) {
        const cible = CHAMP_DEPUIS_API[nom]
        const message = messages?.[0]
        if (cible && message) parChamp[cible] = message
      }
      erreurs.value = parChamp
      if (Object.keys(parChamp).length === 0) erreurGenerale.value = ERREUR_ENREGISTREMENT
    }
    else if (erreur.code === 'VEDETTE_COMPLETE') {
      erreurs.value = { enVedette: messageVedetteComplete(compteurs.vedetteMax, lireEnVedette(e)) }
    }
    else if (erreur.code === 'MEDIA_INVALIDE') {
      erreurs.value = { imageMediaId: ERREUR_PHOTO }
    }
    else if (erreur.code === 'PAIEMENT_EN_LIGNE_INDISPONIBLE') {
      erreurs.value = { paiementMode: ERREUR_PAIEMENT_EN_LIGNE }
    }
    else if (erreur.code === 'SERVICE_INTROUVABLE') {
      introuvable.value = true
    }
    else {
      erreurGenerale.value = ERREUR_ENREGISTREMENT
    }
  }

  async function terminer(): Promise<void> {
    await Promise.all([refreshNuxtData(CLE_SERVICES), refreshNuxtData('studio-vitrine')])
    await navigateTo('/studio/services')
  }

  async function enregistrer(): Promise<void> {
    if (enregistrement.value || !aDesModifications.value) return
    erreurs.value = {}
    erreurGenerale.value = ''
    limiteAtteinte.value = null
    const { corps, erreurs: locales } = lireFormulaire(form, image.value?.id ?? null)
    if (Object.keys(locales).length > 0) {
      erreurs.value = locales
      return
    }

    enregistrement.value = true
    try {
      if (service) {
        const modification: Partial<CorpsService> = {}
        for (const cle of champsModifies.value) Object.assign(modification, { [cle]: corps[cle] })
        await $fetch(`/api/studio/services/${service.id}`, { method: 'PUT', body: modification })
      }
      else {
        await $fetch('/api/studio/services', { method: 'POST', body: corps })
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
    if (!service || suppressionEnCours.value) return
    erreurSuppression.value = ''
    suppressionEnCours.value = true
    try {
      await $fetch(`/api/studio/services/${service.id}`, { method: 'DELETE' })
      suppressionOuverte.value = false
      await terminer()
    }
    catch (e) {
      // Déjà supprimé ailleurs : le résultat voulu est atteint.
      if (lireErreurApi(e).code === 'SERVICE_INTROUVABLE') {
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
    form, image, erreurs, erreurGenerale, limiteAtteinte, enregistrement, introuvable, aDesModifications, viderErreur,
    accompagnement, dureeRequise, tarifVerrouille, payant, libellePrix, prixDecimal,
    itemsTarifs, itemsPaiement, vedetteBloquee, aideVedette,
    choisirImage, retirerImage, enregistrer,
    suppressionOuverte, suppressionEnCours, erreurSuppression, supprimer,
  }
}
