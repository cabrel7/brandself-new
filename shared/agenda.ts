import type { ServiceType } from './services'

export const PAS_CRENEAU_MINUTES = [15, 30, 60] as const
export type PasCreneauMinutes = (typeof PAS_CRENEAU_MINUTES)[number]

export const RESERVATION_STATUTS = ['en_attente', 'confirmee', 'annulee', 'terminee', 'refusee'] as const
export type ReservationStatut = (typeof RESERVATION_STATUTS)[number]

/** Période d'une liste de réservations pour l'assistant : `a_venir` = fin après maintenant, `passees` = fin avant ou à maintenant. */
export const RESERVATION_PERIODES = ['a_venir', 'passees', 'toutes'] as const
export type ReservationPeriode = (typeof RESERVATION_PERIODES)[number]

export const DEMANDE_STATUTS = ['nouvelle', 'en_cours', 'traitee', 'refusee'] as const
export type DemandeStatut = (typeof DEMANDE_STATUTS)[number]

export const PAIEMENTS_RESERVATION = ['sur_place'] as const
export type PaiementReservation = (typeof PAIEMENTS_RESERVATION)[number]

export const PAIEMENT_STATUTS = ['non_requis'] as const
export type PaiementStatut = (typeof PAIEMENT_STATUTS)[number]

export const SERVICE_RESERVATION_TYPES: readonly ServiceType[] = ['rdv', 'accompagnement']
export const SERVICE_DEMANDE_TYPES: readonly ServiceType[] = ['atelier', 'devis']

export const CONTACT_NOM_MAX = 120
export const CONTACT_EMAIL_MAX = 254
export const MOTIF_MAX = 1000
export const RAISON_INDISPONIBILITE_MAX = 200
export const DISPONIBILITES_MAX = 100
export const PREAVIS_HEURES_MAX = 24 * 30
export const HORIZON_JOURS_MAX = 365
export const CONFIRMATION_DUREE_MINUTES = 30

/** Indisponibilités : une plage « du… au… » ferme au plus ce nombre de jours (une ligne par jour en base). */
export const INDISPONIBILITE_PLAGE_MAX_JOURS = 60
/** Une indisponibilité dont la date est plus ancienne que ce nombre de jours est purgée (jamais une date future ou récente). */
export const INDISPONIBILITE_RETENTION_JOURS = 90
/** Lignes supprimées au plus par lot de purge. */
export const INDISPONIBILITE_PURGE_LOT = 500
/** Lots au plus par passage (un arriéré est repris au passage suivant). */
export const INDISPONIBILITE_PURGE_LOTS_MAX = 20
export const INDISPONIBILITE_PURGE_SCHEDULER_ID = 'indisponibilites-purger'
/** 04:30 UTC chaque jour (après la purge OAuth de 04:00). */
export const INDISPONIBILITE_PURGE_CRON = '30 4 * * *'

/** Libellés des jours de la semaine, numérotés comme `disponibilites.jour_semaine` (1 = lundi … 7 = dimanche). */
export const JOURS_SEMAINE_LIBELLES = {
  1: 'lundi',
  2: 'mardi',
  3: 'mercredi',
  4: 'jeudi',
  5: 'vendredi',
  6: 'samedi',
  7: 'dimanche',
} as const satisfies Record<number, string>
