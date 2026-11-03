import type { ReservationCreatedDTO } from '#shared/dto'
import { RAPPEL_VISITEUR_AVANCE_HEURES } from '#shared/notifications'
import type { ReservationCreateInput } from '#shared/schemas/agenda'
import { schemaReservationCreate } from '#shared/schemas/agenda'

type ChampReservation = 'nom' | 'email' | 'telephone' | 'motif'
type ErreursReservation = Partial<Record<ChampReservation, string>>

export type EtatReservation = 'idle' | 'envoi' | 'envoyee' | 'prise' | 'expiree' | 'erreur'
export type ResultatReservation = 'envoyee' | 'prise' | 'expiree' | 'echec'

interface UseReservationOptions {
  username: string
  serviceId: string
  debut: string
}

export const LIBELLE_RAPPEL_EMAIL = 'Recevoir un rappel par email'
export const DESCRIPTION_RAPPEL_EMAIL = `${RAPPEL_VISITEUR_AVANCE_HEURES} heures avant le rendez-vous.`

const CHAMPS_RESERVATION: readonly ChampReservation[] = ['nom', 'email', 'telephone', 'motif']
const MESSAGE_GENERIQUE = 'Nous n’avons pas pu envoyer votre demande. Vos informations sont gardées, réessayez dans un instant.'
const MESSAGE_TROP_DE_REQUETES = 'Trop de demandes ont été envoyées.'

function messageTropDeRequetes(retryAfterS: number | null): string {
  if (retryAfterS === null || retryAfterS < 120) {
    return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans quelques instants.`
  }
  const minutes = Math.ceil(retryAfterS / 60)
  if (minutes < 60) {
    return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
  }
  const heures = Math.ceil(minutes / 60)
  return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans environ ${heures} heure${heures > 1 ? 's' : ''}.`
}

function normaliserTelephone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '')
}

function estChampReservation(value: string): value is ChampReservation {
  return CHAMPS_RESERVATION.some(champ => champ === value)
}

/** État local du formulaire : aucune donnée personnelle n'est mise en cache globalement. */
export function useReservation(options: UseReservationOptions) {
  const form = reactive({
    nom: '',
    email: '',
    telephone: '',
    motif: '',
    siteWeb: '',
    // Désactivé par défaut : le visiteur choisit (consentement explicite, spec S9 #85).
    rappelEmail: false,
  })
  const erreurs = ref<ErreursReservation>({})
  const erreurGenerale = ref('')
  const etat = ref<EtatReservation>('idle')

  function viderErreur(champ: ChampReservation): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  function construireCorps(): Record<string, unknown> {
    const motif = form.motif.trim()
    return {
      serviceId: options.serviceId,
      debut: options.debut,
      nom: form.nom.trim(),
      email: form.email.trim(),
      telephone: normaliserTelephone(form.telephone),
      siteWeb: form.siteWeb,
      rappelEmail: form.rappelEmail,
      paiementChoisi: 'sur_place',
      ...(motif === '' ? {} : { motif }),
    }
  }

  function valider(corps: Record<string, unknown>): ReservationCreateInput | null {
    const resultat = schemaReservationCreate.safeParse(corps)
    if (resultat.success) return resultat.data

    const erreursChamps: ErreursReservation = {}
    for (const issue of resultat.error.issues) {
      const champ = String(issue.path[0] ?? '')
      if (estChampReservation(champ) && !erreursChamps[champ]) erreursChamps[champ] = issue.message
    }
    erreurs.value = erreursChamps
    if (Object.keys(erreursChamps).length === 0) erreurGenerale.value = 'Vérifiez les informations saisies.'
    return null
  }

  function rangerErreur(error: unknown): ResultatReservation {
    const api = lireErreurApi(error)
    if (api.code === 'CRENEAU_PRIS' || api.statut === 409) {
      etat.value = 'prise'
      erreurGenerale.value = 'Ce créneau vient d’être réservé. Vos informations sont gardées : choisissez-en un autre.'
      return 'prise'
    }
    if (api.code === 'CRENEAU_INDISPONIBLE') {
      etat.value = 'expiree'
      erreurGenerale.value = 'Ce créneau n’est plus disponible. Vos informations sont gardées : choisissez-en un autre.'
      return 'expiree'
    }
    if (api.code === 'VALIDATION') {
      const erreursChamps: ErreursReservation = {}
      for (const [champ, messages] of Object.entries(api.champs)) {
        if (estChampReservation(champ) && messages?.[0]) erreursChamps[champ] = messages[0]
      }
      erreurs.value = erreursChamps
      erreurGenerale.value = Object.keys(erreursChamps).length === 0 ? 'Vérifiez les informations saisies.' : ''
      etat.value = 'idle'
      return 'echec'
    }
    if (api.code === 'TROP_DE_REQUETES') {
      erreurGenerale.value = messageTropDeRequetes(api.retryAfter)
    }
    else if (api.code === 'LIMITEUR_INDISPONIBLE') {
      erreurGenerale.value = 'Le formulaire est momentanément indisponible. Réessayez dans quelques instants.'
    }
    else {
      erreurGenerale.value = MESSAGE_GENERIQUE
    }
    etat.value = 'erreur'
    return 'echec'
  }

  async function soumettre(): Promise<ResultatReservation> {
    if (etat.value === 'envoi') return 'echec'
    erreurs.value = {}
    erreurGenerale.value = ''
    const corps = valider(construireCorps())
    if (!corps) return 'echec'

    etat.value = 'envoi'
    try {
      await $fetch<ReservationCreatedDTO>(
        `/api/public/${encodeURIComponent(options.username)}/reservations`,
        { method: 'POST', body: corps },
      )
      etat.value = 'envoyee'
      return 'envoyee'
    }
    catch (error) {
      return rangerErreur(error)
    }
  }

  return {
    form,
    erreurs,
    erreurGenerale,
    etat: readonly(etat),
    envoi: computed(() => etat.value === 'envoi'),
    viderErreur,
    soumettre,
  }
}
