import type {
  AgendaStudioReponse,
  CreneauxPublicsReponse,
  DemandeStudioDTO,
  DemandeCreatedDTO,
  IndisponibiliteDTO,
  ReservationConfirmationDTO,
  ReservationCreatedDTO,
  ReservationStudioDTO,
} from '../../shared/dto/agenda'
import type { DemandeStatut, PaiementReservation, ReservationStatut } from '../../shared/agenda'
import type { Devise } from '../../shared/compte'
import type { Tarif } from '../../shared/services'
import type { OwnAgenda, IndisponibiliteRow } from '../services/agenda'
import type { DemandeRow } from '../services/demandes'
import type { AgendaServiceRow, PublicAgendaService } from '../services/creneaux'
import type { CreatedReservation, ReservationConfirmation, ReservationRow } from '../services/reservations'
import { PAYS, displayName } from '../../shared/vitrine'
import { asTitre } from './vitrine'

function reservationStatut(value: string): ReservationStatut {
  if (value === 'en_attente' || value === 'confirmee' || value === 'annulee' || value === 'terminee' || value === 'refusee') {
    return value
  }
  throw new Error('Statut de réservation invalide en base.')
}

function demandeStatut(value: string): DemandeStatut {
  if (value === 'nouvelle' || value === 'en_cours' || value === 'traitee' || value === 'refusee') return value
  throw new Error('Statut de demande invalide en base.')
}

function paiementReservation(value: string): PaiementReservation {
  if (value === 'sur_place') return value
  throw new Error('Mode de règlement invalide en base.')
}

function tarifService(value: string): Tarif {
  if (value === 'gratuit' || value === 'payant' || value === 'devis') return value
  throw new Error('Tarif de service invalide en base.')
}

function deviseService(value: string | null): Devise | null {
  if (value === null) return null
  if (value === 'XAF' || value === 'EUR' || value === 'USD') return value
  throw new Error('Devise de service invalide en base.')
}

function paysLibelle(code: string | null): string | null {
  if (code === null || code.trim() === '') return null
  return PAYS.find((entree) => entree.code === code)?.label ?? code
}

export function toCreneauxPublicResource(
  value: PublicAgendaService & { creneaux: Array<{ debut: Date, fin: Date }> },
): CreneauxPublicsReponse {
  if (value.service.dureeMin === null) throw new Error('Durée du service absente.')
  return {
    service: {
      id: value.service.id,
      slug: value.service.slug,
      titre: value.service.titre,
      dureeMin: value.service.dureeMin,
    },
    fuseau: value.vitrine.fuseau,
    creneaux: value.creneaux.map(({ debut, fin }) => ({ debut: debut.toISOString(), fin: fin.toISOString() })),
  }
}

export function toAgendaStudioResource(value: OwnAgenda): AgendaStudioReponse {
  return {
    disponibilites: value.disponibilites.map((item) => ({
      id: item.id,
      jourSemaine: item.jourSemaine,
      debut: item.debut.slice(0, 5),
      fin: item.fin.slice(0, 5),
    })),
    indisponibilites: value.indisponibilites.map(toIndisponibiliteResource),
    reglages: value.reglages,
  }
}

export function toIndisponibiliteResource(item: IndisponibiliteRow): IndisponibiliteDTO {
  return { id: item.id, date: item.date, raison: item.raison }
}

export function toReservationCreatedResource(value: CreatedReservation): ReservationCreatedDTO {
  return {
    reservation: {
      id: value.reservation.id,
      statut: reservationStatut(value.reservation.statut),
      debut: value.reservation.debut.toISOString(),
      fin: value.reservation.fin.toISOString(),
    },
    confirmation: { expireLe: value.confirmation.expireLe.toISOString() },
  }
}

export function toReservationConfirmationResource(value: ReservationConfirmation): ReservationConfirmationDTO {
  const tarif = tarifService(value.service.tarif)
  const ville = value.vitrine.ville
  const libellePays = paysLibelle(value.vitrine.pays)
  const lieu = ville === null
    ? (libellePays === null ? null : libellePays)
    : (libellePays === null ? ville : `${ville}, ${libellePays}`)
  return {
    reservation: {
      id: value.reservation.id,
      statut: reservationStatut(value.reservation.statut),
      debut: value.reservation.debut.toISOString(),
      fin: value.reservation.fin.toISOString(),
      paiementChoisi: paiementReservation(value.reservation.paiementChoisi),
    },
    service: {
      titre: value.service.titre,
      dureeMin: value.service.dureeMin,
      tarif,
      prixMontant: tarif === 'payant' ? value.service.prixMontant : null,
      prixDevise: tarif === 'payant' ? deviseService(value.service.prixDevise) : null,
    },
    vitrine: {
      username: value.vitrine.username,
      professionnel: displayName(asTitre(value.vitrine.titre), value.vitrine.prenom, value.vitrine.nom),
      metier: value.vitrine.metier,
      ville: value.vitrine.ville,
      lieu,
    },
  }
}

export function toReservationStudioResource(
  value: { reservation: ReservationRow, service: AgendaServiceRow },
): ReservationStudioDTO {
  return {
    id: value.reservation.id,
    service: { id: value.service.id, titre: value.service.titre },
    visiteur: {
      nom: value.reservation.nom,
      email: value.reservation.email,
      telephone: value.reservation.telephone,
    },
    note: value.reservation.note,
    motifAnnulation: value.reservation.motifAnnulation,
    debut: value.reservation.debut.toISOString(),
    fin: value.reservation.fin.toISOString(),
    statut: reservationStatut(value.reservation.statut),
    paiementChoisi: paiementReservation(value.reservation.paiementChoisi),
    rappelEmail: value.reservation.rappelEmail,
    createdAt: value.reservation.createdAt.toISOString(),
  }
}

export function toDemandeStudioResource(
  value: { demande: DemandeRow, service: AgendaServiceRow },
): DemandeStudioDTO {
  return {
    id: value.demande.id,
    service: { id: value.service.id, titre: value.service.titre },
    visiteur: { nom: value.demande.nom, email: value.demande.email, telephone: value.demande.telephone },
    message: value.demande.message,
    statut: demandeStatut(value.demande.statut),
    createdAt: value.demande.createdAt.toISOString(),
  }
}

export function toDemandeCreatedResource(item: DemandeRow): DemandeCreatedDTO {
  if (item.statut !== 'nouvelle') throw new Error('Une demande créée doit être nouvelle.')
  return { demande: { id: item.id, statut: 'nouvelle' } }
}

export function toReservationActionResource(item: ReservationRow): { item: { id: string, statut: ReservationStatut } } {
  return { item: { id: item.id, statut: reservationStatut(item.statut) } }
}

export function toDemandeActionResource(item: DemandeRow): { item: { id: string, statut: DemandeStatut } } {
  return { item: { id: item.id, statut: demandeStatut(item.statut) } }
}
