import { z } from 'zod'
import {
  CONTACT_EMAIL_MAX,
  CONTACT_NOM_MAX,
  DEMANDE_STATUTS,
  DISPONIBILITES_MAX,
  HORIZON_JOURS_MAX,
  MOTIF_MAX,
  PAS_CRENEAU_MINUTES,
  PREAVIS_HEURES_MAX,
  RAISON_INDISPONIBILITE_MAX,
} from '../agenda'
import { SERVICE_SLUG_MAX, SERVICE_SLUG_REGEX } from '../services'
import { E164_REGEX } from '../telephone'

const DATE_LOCALE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const HEURE_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DATE_HEURE_AVEC_FUSEAU_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export const schemaDateLocale = z.iso.date().regex(DATE_LOCALE_REGEX, 'Date invalide.')

const schemaContact = {
  nom: z.string().trim().min(1, 'Votre nom est requis.').max(CONTACT_NOM_MAX),
  email: z.email('Adresse email invalide.').max(CONTACT_EMAIL_MAX),
  telephone: z.string().regex(E164_REGEX, 'Numéro de téléphone invalide.'),
  siteWeb: z.literal(''),
}

export const schemaDisponibilite = z
  .object({
    jourSemaine: z.int().min(1).max(7),
    debut: z.string().regex(HEURE_REGEX, 'Heure de début invalide.'),
    fin: z.string().regex(HEURE_REGEX, 'Heure de fin invalide.'),
  })
  .strict()
  .refine((value) => value.debut < value.fin, {
    path: ['fin'],
    message: 'La fin doit être après le début, le même jour.',
  })

export const schemaReservationCreate = z
  .object({
    serviceId: z.uuid('Service invalide.'),
    debut: z.iso.datetime({ offset: true }).regex(DATE_HEURE_AVEC_FUSEAU_REGEX, 'Créneau invalide.'),
    ...schemaContact,
    motif: z.string().trim().max(MOTIF_MAX).optional(),
    rappelEmail: z.boolean(),
    paiementChoisi: z.literal('sur_place'),
  })
  .strict()

export const schemaDemandeCreate = z
  .object({
    service: z.string().trim().min(1).max(SERVICE_SLUG_MAX).regex(SERVICE_SLUG_REGEX, 'Service invalide.'),
    ...schemaContact,
    message: z.string().trim().max(MOTIF_MAX).optional(),
  })
  .strict()

export const schemaCreneauxQuery = z
  .object({
    service: z.string().trim().min(1).max(SERVICE_SLUG_MAX).regex(SERVICE_SLUG_REGEX),
    du: schemaDateLocale,
    au: schemaDateLocale,
  })
  .strict()
  .refine((value) => value.du <= value.au, { path: ['au'], message: 'La date de fin précède la date de début.' })

export const schemaDisponibilitesUpdate = z
  .object({
    items: z.array(schemaDisponibilite).max(DISPONIBILITES_MAX),
    pasCreneauMin: z.union([
      z.literal(PAS_CRENEAU_MINUTES[0]),
      z.literal(PAS_CRENEAU_MINUTES[1]),
      z.literal(PAS_CRENEAU_MINUTES[2]),
    ]).optional(),
    preavisHeures: z.int().min(0).max(PREAVIS_HEURES_MAX).optional(),
    horizonJours: z.int().min(1).max(HORIZON_JOURS_MAX).optional(),
  })
  .strict()

export const schemaIndisponibiliteCreate = z
  .object({
    date: schemaDateLocale,
    raison: z.string().trim().min(1).max(RAISON_INDISPONIBILITE_MAX).nullable().default(null),
  })
  .strict()

export const schemaReservationCancel = z
  .object({ motif: z.string().trim().min(1).max(MOTIF_MAX).optional() })
  .strict()

export const schemaDemandeUpdate = z
  .object({ statut: z.enum(DEMANDE_STATUTS) })
  .strict()

export const schemaAgendaIdParams = z.object({ id: z.uuid('Identifiant invalide.') }).strict()
export const schemaPublicUsernameParams = z.object({ username: z.string().trim().min(1).max(30) }).strict()
export const schemaConfirmationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Jeton de confirmation invalide.')

export type DisponibiliteInput = z.infer<typeof schemaDisponibilite>
export type ReservationCreateInput = z.infer<typeof schemaReservationCreate>
export type DemandeCreateInput = z.infer<typeof schemaDemandeCreate>
export type CreneauxQuery = z.infer<typeof schemaCreneauxQuery>
export type DisponibilitesUpdateInput = z.infer<typeof schemaDisponibilitesUpdate>
export type IndisponibiliteCreateInput = z.infer<typeof schemaIndisponibiliteCreate>
export type ReservationCancelInput = z.infer<typeof schemaReservationCancel>
export type DemandeUpdateInput = z.infer<typeof schemaDemandeUpdate>
