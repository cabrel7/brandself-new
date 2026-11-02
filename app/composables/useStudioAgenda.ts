import type {
  DemandeStudioDTO,
  DemandesStudioReponse,
  ReservationStudioDTO,
  ReservationsStudioReponse,
} from '#shared/dto'
import type { DemandeStatut, ReservationStatut } from '#shared/agenda'
import type { MessageStudioAgenda } from '~/composables/useStudioDisponibilites'
import { TOUJOURS_FRAIS as OPTIONS_FRAIS } from '~/composables/useStudioDisponibilites'
import { useStudioVitrine } from '~/composables/useStudioVitrine'

interface ActionReponse<T extends string> {
  item: { id: string, statut: T }
}

export type OngletAgenda = 'a_venir' | 'demandes' | 'passees'
export type ActionActiviteAgenda = 'confirmer' | 'annuler' | 'en_cours' | 'traiter' | 'refuser'

type CouleurBadgeAgenda = 'primary' | 'neutral' | 'error'
type VarianteBoutonAgenda = 'solid' | 'outline' | 'ghost'

export interface ActionActiviteAgendaVue {
  action: ActionActiviteAgenda
  libelle: string
  couleur: 'primary' | 'neutral' | 'error'
  variante: VarianteBoutonAgenda
}

export interface ActiviteAgendaVue {
  cle: string
  id: string
  type: 'reservation' | 'demande'
  typeLibelle: string
  icone: string
  service: string
  visiteur: { nom: string, email: string, telephone: string }
  detail: string | null
  /** En-tête de groupe au format « vendredi 23 octobre » (fuseau de la vitrine). */
  jourGroupe: string
  /** Tuile de date de la maquette : numéro du jour + mois abrégé. */
  tuile: { jour: string, mois: string }
  dateLibelle: string
  heureLibelle: string | null
  statutLibelle: string
  statutCouleur: CouleurBadgeAgenda
  /** « À régler sur place » pour une réservation, rien pour une demande. */
  reglement: string | null
  actions: ActionActiviteAgendaVue[]
  passee: boolean
  referenceTemps: number
}

export interface ActionActiviteEnCours {
  cle: string
  action: ActionActiviteAgenda
}

export interface ConfirmationActiviteAgenda extends ActionActiviteEnCours {
  texte: string
  libelleConfirmation: string
}

const ACTUALISATION_ACTIVITES_MS = 60_000
const MOIS_TUILE = 'fr-FR'

const ACTIONS_RESERVATION: Record<'en_attente' | 'confirmee', ActionActiviteAgendaVue[]> = {
  en_attente: [
    { action: 'confirmer', libelle: 'Confirmer', couleur: 'primary', variante: 'solid' },
    // La maquette est neutre : le refus ne se colore pas en rouge, la confirmation le fait.
    { action: 'refuser', libelle: 'Refuser', couleur: 'neutral', variante: 'outline' },
  ],
  confirmee: [
    { action: 'annuler', libelle: 'Annuler ce rendez-vous', couleur: 'neutral', variante: 'ghost' },
  ],
}

const ACTIONS_DEMANDE: Record<'nouvelle' | 'en_cours', ActionActiviteAgendaVue[]> = {
  nouvelle: [
    { action: 'en_cours', libelle: 'En cours', couleur: 'neutral', variante: 'outline' },
    { action: 'traiter', libelle: 'Traiter', couleur: 'primary', variante: 'solid' },
    { action: 'refuser', libelle: 'Refuser', couleur: 'error', variante: 'ghost' },
  ],
  en_cours: [
    { action: 'traiter', libelle: 'Traiter', couleur: 'primary', variante: 'solid' },
    { action: 'refuser', libelle: 'Refuser', couleur: 'error', variante: 'ghost' },
  ],
}

const STATUTS_RESERVATION: Record<ReservationStatut, { libelle: string, couleur: CouleurBadgeAgenda }> = {
  en_attente: { libelle: 'En attente', couleur: 'primary' },
  confirmee: { libelle: 'Confirmée', couleur: 'neutral' },
  annulee: { libelle: 'Annulée', couleur: 'error' },
  terminee: { libelle: 'Terminée', couleur: 'neutral' },
  refusee: { libelle: 'Refusée', couleur: 'error' },
}

const STATUTS_DEMANDE: Record<DemandeStatut, { libelle: string, couleur: CouleurBadgeAgenda }> = {
  nouvelle: { libelle: 'Nouvelle', couleur: 'primary' },
  en_cours: { libelle: 'En cours', couleur: 'primary' },
  traitee: { libelle: 'Traitée', couleur: 'neutral' },
  refusee: { libelle: 'Refusée', couleur: 'error' },
}

function formaterDateHeureAgenda(iso: string, fuseau: string): { date: string, heure: string, temps: number } {
  const valeur = new Date(iso)
  const temps = valeur.getTime()
  if (Number.isNaN(temps)) return { date: iso, heure: '', temps: 0 }
  try {
    return {
      date: new Intl.DateTimeFormat('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: fuseau,
      }).format(valeur),
      heure: new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuseau,
      }).format(valeur),
      temps,
    }
  }
  catch {
    return { date: iso, heure: '', temps }
  }
}

function formaterJourGroupeAgenda(iso: string, fuseau: string): { jourGroupe: string, tuile: { jour: string, mois: string } } {
  const valeur = new Date(iso)
  if (Number.isNaN(valeur.getTime())) return { jourGroupe: '', tuile: { jour: '', mois: '' } }
  try {
    const jourGroupe = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau,
    }).format(valeur)
    const tuile = {
      jour: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: fuseau }).format(valeur),
      mois: new Intl.DateTimeFormat(MOIS_TUILE, { month: 'short', timeZone: fuseau })
        .format(valeur).replace('.', '').toLocaleUpperCase(MOIS_TUILE),
    }
    return { jourGroupe, tuile }
  }
  catch {
    return { jourGroupe: '', tuile: { jour: '', mois: '' } }
  }
}

/** Agenda Studio (split S7-bis) : réservations et demandes, trois onglets, refus. */
export function useStudioAgenda() {
  const {
    data: reservationsData,
    status: reservationsStatus,
    error: reservationsError,
    refresh: refreshReservations,
  } = useFetch<ReservationsStudioReponse>('/api/studio/reservations', {
    key: 'studio-agenda-reservations',
    ...OPTIONS_FRAIS,
  })
  const {
    data: demandesData,
    status: demandesStatus,
    error: demandesError,
    refresh: refreshDemandes,
  } = useFetch<DemandesStudioReponse>('/api/studio/demandes', {
    key: 'studio-agenda-demandes',
    ...OPTIONS_FRAIS,
  })

  // Fuseau de la vitrine : déjà chargé par la barre du haut (clé partagée).
  const { vitrine } = useStudioVitrine()
  const fuseau = computed(() => vitrine.value?.fuseau ?? 'Africa/Douala')

  const message = ref<MessageStudioAgenda | null>(null)

  function effacerMessage(): void {
    message.value = null
  }

  function afficherMessage(type: MessageStudioAgenda['type'], texte: string): void {
    message.value = { type, texte }
  }

  const reservations = ref<ReservationStudioDTO[]>([])
  const demandes = ref<DemandeStudioDTO[]>([])
  const onglet = ref<OngletAgenda>('a_venir')
  const actionActiviteEnCours = ref<ActionActiviteEnCours | null>(null)
  const maintenant = useNow({ interval: ACTUALISATION_ACTIVITES_MS })

  watch(reservationsData, (reponse) => {
    if (reponse) reservations.value = reponse.items.map((item) => ({ ...item }))
  }, { immediate: true })
  watch(demandesData, (reponse) => {
    if (reponse) demandes.value = reponse.items.map((item) => ({ ...item }))
  }, { immediate: true })

  function activiteReservation(item: ReservationStudioDTO): ActiviteAgendaVue {
    const debut = formaterDateHeureAgenda(item.debut, fuseau.value)
    const jour = formaterJourGroupeAgenda(item.debut, fuseau.value)
    const statut = STATUTS_RESERVATION[item.statut]
    const passee = item.statut === 'annulee' || item.statut === 'terminee' || item.statut === 'refusee'
      || debut.temps <= maintenant.value.getTime()
    return {
      cle: `reservation:${item.id}`,
      id: item.id,
      type: 'reservation',
      typeLibelle: 'Réservation',
      icone: 'i-ph-calendar-check',
      service: item.service.titre,
      visiteur: item.visiteur,
      detail: item.note,
      jourGroupe: jour.jourGroupe,
      tuile: jour.tuile,
      dateLibelle: debut.date,
      heureLibelle: debut.heure || null,
      statutLibelle: statut.libelle,
      statutCouleur: statut.couleur,
      reglement: item.paiementChoisi === 'sur_place' ? 'À régler sur place' : null,
      actions: item.statut === 'en_attente' || item.statut === 'confirmee' ? ACTIONS_RESERVATION[item.statut] : [],
      passee,
      referenceTemps: debut.temps,
    }
  }

  function activiteDemande(item: DemandeStudioDTO): ActiviteAgendaVue {
    const creation = formaterDateHeureAgenda(item.createdAt, fuseau.value)
    const jour = formaterJourGroupeAgenda(item.createdAt, fuseau.value)
    const statut = STATUTS_DEMANDE[item.statut]
    const passee = item.statut === 'traitee' || item.statut === 'refusee'
    return {
      cle: `demande:${item.id}`,
      id: item.id,
      type: 'demande',
      typeLibelle: 'Demande',
      icone: 'i-ph-chat-circle-text',
      service: item.service.titre,
      visiteur: item.visiteur,
      detail: item.message,
      jourGroupe: jour.jourGroupe,
      tuile: jour.tuile,
      dateLibelle: creation.date,
      heureLibelle: creation.heure || null,
      statutLibelle: statut.libelle,
      statutCouleur: statut.couleur,
      reglement: null,
      actions: item.statut === 'nouvelle' || item.statut === 'en_cours' ? ACTIONS_DEMANDE[item.statut] : [],
      passee,
      referenceTemps: creation.temps,
    }
  }

  const activitesReservations = computed(() => reservations.value.map(activiteReservation))
  const activitesDemandes = computed(() => demandes.value.map(activiteDemande))
  const compteursOnglets = computed(() => ({
    aVenir: activitesReservations.value.filter((item) => !item.passee).length,
    demandes: activitesDemandes.value.filter((item) => !item.passee).length,
    passees: [
      ...activitesReservations.value.filter((item) => item.passee),
      ...activitesDemandes.value.filter((item) => item.passee),
    ].length,
  }))

  const activites = computed<ActiviteAgendaVue[]>(() => {
    if (onglet.value === 'a_venir') {
      return activitesReservations.value
        .filter((item) => !item.passee)
        .sort((a, b) => a.referenceTemps - b.referenceTemps || a.cle.localeCompare(b.cle))
    }
    if (onglet.value === 'demandes') {
      return activitesDemandes.value
        .filter((item) => !item.passee)
        .sort((a, b) => b.referenceTemps - a.referenceTemps || a.cle.localeCompare(b.cle))
    }
    return [
      ...activitesReservations.value.filter((item) => item.passee),
      ...activitesDemandes.value.filter((item) => item.passee),
    ].sort((a, b) => b.referenceTemps - a.referenceTemps || a.cle.localeCompare(b.cle))
  })

  function changerOnglet(valeur: OngletAgenda): void {
    onglet.value = valeur
    confirmationActivite.value = null
  }

  const confirmationActivite = ref<ConfirmationActiviteAgenda | null>(null)

  function demanderActionActivite(cle: string, action: ActionActiviteAgenda): void {
    effacerMessage()
    if (action === 'annuler') {
      confirmationActivite.value = {
        cle,
        action,
        texte: 'Annuler cette réservation ? Le créneau redeviendra disponible.',
        libelleConfirmation: 'Annuler la réservation',
      }
      return
    }
    if (action === 'refuser') {
      confirmationActivite.value = cle.startsWith('reservation:')
        ? {
            cle,
            action,
            texte: 'Refuser cette réservation ? Le créneau redeviendra disponible.',
            libelleConfirmation: 'Refuser la réservation',
          }
        : {
            cle,
            action,
            texte: 'Refuser cette demande ? Cette décision ne pourra pas être annulée.',
            libelleConfirmation: 'Refuser la demande',
          }
      return
    }
    void executerActionActivite(cle, action)
  }

  function annulerConfirmationActivite(): void {
    confirmationActivite.value = null
  }

  async function executerActionActivite(cle: string, action: ActionActiviteAgenda): Promise<void> {
    if (actionActiviteEnCours.value) return
    confirmationActivite.value = null
    actionActiviteEnCours.value = { cle, action }
    const [type, id] = cle.split(':')

    if (type === 'reservation' && id) {
      const reservation = reservations.value.find((item) => item.id === id)
      const statutsCibles: Partial<Record<ActionActiviteAgenda, ReservationStatut>> = {
        confirmer: 'confirmee',
        annuler: 'annulee',
        refuser: 'refusee',
      }
      const statutCible = statutsCibles[action]
      if (!reservation || !statutCible) {
        actionActiviteEnCours.value = null
        return
      }
      const statutAvant = reservation.statut
      reservation.statut = statutCible
      try {
        const reponse = await $fetch<ActionReponse<ReservationStatut>>(`/api/studio/reservations/${id}/${action}`, {
          method: 'PATCH',
          ...(action === 'confirmer' ? {} : { body: {} }),
        })
        reservation.statut = reponse.item.statut
        afficherMessage('succes', action === 'confirmer'
          ? 'La réservation est confirmée.'
          : action === 'annuler'
            ? 'La réservation est annulée.'
            : 'La réservation est refusée.')
      }
      catch {
        reservation.statut = statutAvant
        await refreshReservations()
        afficherMessage('erreur', 'Nous n’avons pas pu modifier cette réservation. Son état a été rétabli.')
      }
      finally {
        actionActiviteEnCours.value = null
      }
      return
    }

    if (type === 'demande' && id) {
      const demande = demandes.value.find((item) => item.id === id)
      const statutsCibles: Partial<Record<ActionActiviteAgenda, DemandeStatut>> = {
        en_cours: 'en_cours',
        traiter: 'traitee',
        refuser: 'refusee',
      }
      const statutCible = statutsCibles[action]
      if (!demande || !statutCible) {
        actionActiviteEnCours.value = null
        return
      }
      const statutAvant = demande.statut
      demande.statut = statutCible
      try {
        const reponse = await $fetch<ActionReponse<DemandeStatut>>(`/api/studio/demandes/${id}`, {
          method: 'PATCH',
          body: { statut: statutCible },
        })
        demande.statut = reponse.item.statut
        afficherMessage('succes', statutCible === 'en_cours' ? 'La demande est en cours.' : statutCible === 'traitee' ? 'La demande est traitée.' : 'La demande est refusée.')
      }
      catch {
        demande.statut = statutAvant
        await refreshDemandes()
        afficherMessage('erreur', 'Nous n’avons pas pu modifier cette demande. Son état a été rétabli.')
      }
      finally {
        actionActiviteEnCours.value = null
      }
      return
    }

    actionActiviteEnCours.value = null
  }

  async function confirmerActionActivite(): Promise<void> {
    const confirmation = confirmationActivite.value
    if (confirmation) await executerActionActivite(confirmation.cle, confirmation.action)
  }

  const donneesPretes = computed(() => Boolean(reservationsData.value && demandesData.value))
  const erreursChargement = computed(() => [reservationsError.value, demandesError.value].filter(Boolean))
  const absente = computed(() => erreursChargement.value.some((erreur) => {
    const api = lireErreurApi(erreur)
    return api.code === 'VITRINE_INTROUVABLE' || api.statut === 404
  }))
  const enErreur = computed(() => !donneesPretes.value && !absente.value && erreursChargement.value.length > 0)
  const enChargement = computed(() => !donneesPretes.value && !enErreur.value && !absente.value && [
    reservationsStatus.value,
    demandesStatus.value,
  ].some((statut) => statut === 'idle' || statut === 'pending'))

  async function rafraichir(): Promise<void> {
    effacerMessage()
    await Promise.all([refreshReservations(), refreshDemandes()])
  }

  return {
    enChargement, enErreur, absente, rafraichir, message,
    activites,
    onglet,
    compteursOnglets,
    actionActiviteEnCours,
    confirmationActivite,
    changerOnglet,
    demanderActionActivite,
    annulerConfirmationActivite,
    confirmerActionActivite,
  }
}

/** État léger utilisé par l’accueil Studio, sans charger les contacts des activités. */
export function useStudioAgendaApercu() {
  interface DisponibilitesApercu {
    items: unknown[]
  }
  const { data, error } = useFetch<DisponibilitesApercu>('/api/studio/agenda/disponibilites', {
    key: 'studio-agenda-apercu',
    ...OPTIONS_FRAIS,
  })
  const etat = computed(() => {
    if (data.value) return data.value.items.length > 0 ? 'Ouvert' : 'Fermé'
    return error.value ? '—' : ''
  })
  return { etat }
}
