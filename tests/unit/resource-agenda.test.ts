import { describe, expect, it } from 'vitest'
import { toReservationConfirmationResource } from '../../server/resources/agenda'
import type { ReservationConfirmation } from '../../server/services/reservations'

function sourceConfirmation(
  overrides: {
    service?: Partial<ReservationConfirmation['service']>
    vitrine?: Partial<ReservationConfirmation['vitrine']>
  } = {},
): ReservationConfirmation {
  return {
    reservation: {
      id: 'reservation-1',
      statut: 'en_attente',
      debut: new Date('2026-11-02T08:00:00.000Z'),
      fin: new Date('2026-11-02T08:30:00.000Z'),
      paiementChoisi: 'sur_place',
      confirmationExpireLe: new Date('2026-11-02T08:30:00.000Z'),
    },
    service: {
      titre: 'Consultation',
      dureeMin: 30,
      tarif: 'payant',
      prixMontant: 15_000,
      prixDevise: 'XAF',
      ...overrides.service,
    },
    vitrine: {
      username: 'dr-cabrel',
      titre: 'dr',
      prenom: 'Cabrel',
      nom: 'Nguesso',
      metier: 'Cardiologue',
      ville: 'Douala',
      pays: 'CM',
      ...overrides.vitrine,
    },
  }
}

describe('ressource de confirmation de réservation', () => {
  it('should expose the service price and the composed place without visitor PII', () => {
    const dto = toReservationConfirmationResource(sourceConfirmation())

    expect(dto.service).toEqual({
      titre: 'Consultation',
      dureeMin: 30,
      tarif: 'payant',
      prixMontant: 15_000,
      prixDevise: 'XAF',
    })
    expect(dto.vitrine).toEqual({
      username: 'dr-cabrel',
      professionnel: 'Dr Cabrel Nguesso',
      metier: 'Cardiologue',
      ville: 'Douala',
      lieu: 'Douala, Cameroun',
    })
    expect(JSON.stringify(dto)).not.toContain('confirmationExpireLe')
  })

  it('should show a free service without price and fall back on the country when the city is missing', () => {
    const dto = toReservationConfirmationResource(sourceConfirmation({
      service: { tarif: 'gratuit', prixMontant: null, prixDevise: null },
      vitrine: { titre: null, ville: null },
    }))

    expect(dto.service).toMatchObject({ tarif: 'gratuit', prixMontant: null, prixDevise: null })
    expect(dto.vitrine.professionnel).toBe('Cabrel Nguesso')
    expect(dto.vitrine.lieu).toBe('Cameroun')
  })
})
