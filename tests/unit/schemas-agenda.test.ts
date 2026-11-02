import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { RESERVATION_STATUTS } from '../../shared/agenda'
import {
  schemaDemandeCreate,
  schemaDisponibilite,
  schemaReservationCreate,
} from '../../shared/schemas/agenda'

// Contrat S7 : les trois schemas sont stricts. Le type du service d'une demande
// est verifie depuis la base par le service, jamais accepte depuis le visiteur.
// S7-bis : RESERVATION_STATUTS gagne le statut terminal `refusee` (§5).

describe('RESERVATION_STATUTS', () => {
  it('accepte exactement cinq statuts, dont le nouveau `refusee`', () => {
    expect([...RESERVATION_STATUTS]).toContain('refusee')
    expect([...RESERVATION_STATUTS]).toEqual(expect.arrayContaining([
      'en_attente',
      'confirmee',
      'annulee',
      'terminee',
      'refusee',
    ]))
    expect(new Set(RESERVATION_STATUTS)).toHaveLength(5)
  })
})

const SERVICE_ID = randomUUID()

const contactValide = {
  nom: 'Ariane Mballa',
  email: 'ariane.mballa@example.com',
  telephone: '+237699000001',
  siteWeb: '',
}

const reservationValide = {
  serviceId: SERVICE_ID,
  debut: '2026-11-02T08:00:00.000Z',
  ...contactValide,
  motif: 'Premiere consultation',
  rappelEmail: true,
  paiementChoisi: 'sur_place',
}

const demandeValide = {
  service: 'atelier-equipe',
  ...contactValide,
  message: 'Je souhaite organiser un atelier pour mon equipe.',
}

describe('schemaDisponibilite', () => {
  it.each([
    { jourSemaine: 1, debut: '00:00', fin: '00:15' },
    { jourSemaine: 3, debut: '09:00', fin: '17:30' },
    { jourSemaine: 7, debut: '23:00', fin: '23:59' },
  ])('should accept a same-day availability: %j', (disponibilite) => {
    expect(schemaDisponibilite.parse(disponibilite)).toEqual(disponibilite)
  })

  it.each([0, 8, 1.5, '1', null])('should reject the weekday %j outside integer range 1..7', (jourSemaine) => {
    expect(schemaDisponibilite.safeParse({ jourSemaine, debut: '09:00', fin: '10:00' }).success).toBe(false)
  })

  it.each([
    ['09:00', '09:00'],
    ['10:00', '09:00'],
    ['22:00', '02:00'],
  ])('should reject a zero, negative or overnight range %s-%s', (debut, fin) => {
    expect(schemaDisponibilite.safeParse({ jourSemaine: 1, debut, fin }).success).toBe(false)
  })

  it.each([
    ['9:00', '10:00'],
    ['09:00:00', '10:00'],
    ['09:60', '10:00'],
    ['09:00', '24:00'],
    ['09:00Z', '10:00Z'],
  ])('should reject a time that is not strict HH:mm: %s-%s', (debut, fin) => {
    expect(schemaDisponibilite.safeParse({ jourSemaine: 1, debut, fin }).success).toBe(false)
  })

  it.each(['id', 'vitrineId', 'createdAt', 'actif'])('should reject the unknown or server-owned key %s', (key) => {
    expect(schemaDisponibilite.safeParse({ jourSemaine: 1, debut: '09:00', fin: '10:00', [key]: 'x' }).success).toBe(false)
  })
})

describe('schemaReservationCreate', () => {
  it('should accept a reservation with a valid email, E.164 phone and empty honeypot', () => {
    expect(schemaReservationCreate.parse(reservationValide)).toEqual(reservationValide)
  })

  it.each(['adresse', 'a@', '@example.com', 'a b@example.com', 'a@example'])('should reject the invalid email %j', (email) => {
    expect(schemaReservationCreate.safeParse({ ...reservationValide, email }).success).toBe(false)
  })

  it.each([
    '699000001',
    '00237699000001',
    '+01234567',
    '+237 699 000 001',
    '+23760',
    '+2376990000010x',
    '+2376990000010000',
  ])('should reject the non-E.164 phone %j', (telephone) => {
    expect(schemaReservationCreate.safeParse({ ...reservationValide, telephone }).success).toBe(false)
  })

  it.each(['https://robot.example', ' ', '0', null, undefined])('should require siteWeb to be exactly empty, got %j', (siteWeb) => {
    const payload = siteWeb === undefined
      ? Object.fromEntries(Object.entries(reservationValide).filter(([key]) => key !== 'siteWeb'))
      : { ...reservationValide, siteWeb }

    expect(schemaReservationCreate.safeParse(payload).success).toBe(false)
  })

  it.each([
    ['serviceId', 'not-a-uuid'],
    ['debut', '2026-11-02 08:00'],
    ['debut', '2026-11-02T08:00:00'],
    ['paiementChoisi', 'en_ligne'],
    ['rappelEmail', 'true'],
  ])('should reject the invalid field %s=%j', (field, value) => {
    expect(schemaReservationCreate.safeParse({ ...reservationValide, [field]: value }).success).toBe(false)
  })

  it.each(['vitrineId', 'fin', 'statut', 'paiementStatut', 'createdAt', 'userId'])('should reject mass assignment through %s', (key) => {
    expect(schemaReservationCreate.safeParse({ ...reservationValide, [key]: 'x' }).success).toBe(false)
  })
})

describe('schemaDemandeCreate', () => {
  it('should accept the public service slug used for an atelier or devis', () => {
    expect(schemaDemandeCreate.parse(demandeValide)).toEqual(demandeValide)
  })

  it.each([
    'a',
    'atelier-equipe',
    'a'.repeat(80),
  ])('should accept the same slug format and limits as a public service: %j', (service) => {
    expect(schemaDemandeCreate.safeParse({ ...demandeValide, service }).success).toBe(true)
  })

  it.each([
    '',
    'Atelier-equipe',
    '-atelier',
    'atelier--equipe',
    'atelier_equipe',
    'a'.repeat(81),
  ])('should reject an invalid public service slug: %j', (service) => {
    expect(schemaDemandeCreate.safeParse({ ...demandeValide, service }).success).toBe(false)
  })

  it.each(['atelier', 'devis', 'rdv'])('should reject a client-provided service type %j', (type) => {
    expect(schemaDemandeCreate.safeParse({ ...demandeValide, type }).success).toBe(false)
  })

  it.each([
    ['email', 'pas-un-email'],
    ['telephone', '699000001'],
    ['telephone', '+237 699 000 001'],
    ['siteWeb', 'robot'],
    ['service', 'not a slug'],
  ])('should reject the invalid field %s=%j', (field, value) => {
    expect(schemaDemandeCreate.safeParse({ ...demandeValide, [field]: value }).success).toBe(false)
  })

  it.each(['serviceId', 'debut', 'fin', 'statut', 'vitrineId', 'createdAt', 'paiementChoisi'])('should reject booking or server-owned key %s', (key) => {
    expect(schemaDemandeCreate.safeParse({ ...demandeValide, [key]: 'x' }).success).toBe(false)
  })
})
