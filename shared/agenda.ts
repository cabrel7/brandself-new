import type { ServiceType } from './services'

export const PAS_CRENEAU_MINUTES = [15, 30, 60] as const
export type PasCreneauMinutes = (typeof PAS_CRENEAU_MINUTES)[number]

export const RESERVATION_STATUTS = ['en_attente', 'confirmee', 'annulee', 'terminee', 'refusee'] as const
export type ReservationStatut = (typeof RESERVATION_STATUTS)[number]

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
