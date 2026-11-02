import type { DemandeStatut, PaiementReservation, ReservationStatut } from '../agenda'
import type { Devise } from '../compte'
import type { Tarif } from '../services'

export interface CreneauDTO {
  debut: string
  fin: string
}

export interface CreneauxPublicsReponse {
  service: { id: string, slug: string, titre: string, dureeMin: number }
  fuseau: string
  creneaux: CreneauDTO[]
}

export interface DisponibiliteDTO {
  id: string
  jourSemaine: number
  debut: string
  fin: string
}

export interface IndisponibiliteDTO {
  id: string
  date: string
  raison: string | null
}

export interface AgendaStudioReponse {
  disponibilites: DisponibiliteDTO[]
  indisponibilites: IndisponibiliteDTO[]
  reglages: {
    fuseau: string
    pasCreneauMin: number
    preavisHeures: number
    horizonJours: number
  }
}

export interface ReservationCreatedDTO {
  reservation: {
    id: string
    statut: ReservationStatut
    debut: string
    fin: string
  }
  confirmation: { expireLe: string }
}

export interface ReservationConfirmationDTO {
  reservation: {
    id: string
    statut: ReservationStatut
    debut: string
    fin: string
    paiementChoisi: PaiementReservation
  }
  service: {
    titre: string
    dureeMin: number | null
    tarif: Tarif | null
    prixMontant: number | null
    prixDevise: Devise | null
  }
  vitrine: {
    username: string
    professionnel: string
    metier: string
    ville: string | null
    lieu: string | null
  }
}

export interface ReservationStudioDTO {
  id: string
  service: { id: string, titre: string }
  visiteur: { nom: string, email: string, telephone: string }
  note: string | null
  motifAnnulation: string | null
  debut: string
  fin: string
  statut: ReservationStatut
  paiementChoisi: PaiementReservation
  rappelEmail: boolean
  createdAt: string
}

export interface ReservationsStudioReponse {
  items: ReservationStudioDTO[]
}

export interface DemandeStudioDTO {
  id: string
  service: { id: string, titre: string }
  visiteur: { nom: string, email: string, telephone: string }
  message: string | null
  statut: DemandeStatut
  createdAt: string
}

export interface DemandeCreatedDTO {
  demande: { id: string, statut: 'nouvelle' }
}

export interface DemandesStudioReponse {
  items: DemandeStudioDTO[]
}
