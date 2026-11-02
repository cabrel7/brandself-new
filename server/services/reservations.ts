import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import { and, asc, eq, lte } from 'drizzle-orm'
import { CONFIRMATION_DUREE_MINUTES } from '../../shared/agenda'
import type { PaiementReservation, ReservationStatut } from '../../shared/agenda'
import { reservations, services, vitrines } from '../../shared/db/schema'
import { ConflictError, GoneError, NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_EXCLUSION_VIOLATION, readPgError } from '../utils/pg-error'
import {
  computeServiceCreneaux,
  requirePublicAgendaService,
} from './creneaux'
import type { PublicAgendaService, ServiceLookup } from './creneaux'
import { insertTransactionalEmailEvents } from './email-outbox'
import { canTransitionReservation, getServiceFlow, isServiceType } from './reservations-regles'
import { requireVitrineId } from './vitrine-acces'

export type ReservationRow = typeof reservations.$inferSelect

export interface ReservationContactInput {
  debut: string
  nom: string
  email: string
  telephone: string
  note?: string
  paiementChoisi: PaiementReservation
  rappelEmail: boolean
}

export type ReservationServiceInput = ReservationContactInput & ServiceLookup

export interface CreatedReservation {
  reservation: ReservationRow
  service: PublicAgendaService['service']
  vitrine: PublicAgendaService['vitrine']
  confirmation: { token: string, expireLe: Date }
}

export interface ReservationConfirmation {
  reservation: {
    id: string
    statut: string
    debut: Date
    fin: Date
    paiementChoisi: string
    confirmationExpireLe: Date
  }
  service: {
    titre: string
    dureeMin: number | null
    tarif: string
    prixMontant: number | null
    prixDevise: string | null
  }
  vitrine: {
    username: string
    titre: string | null
    prenom: string
    nom: string
    metier: string
    ville: string | null
    pays: string | null
  }
}

const EXCLUSION_CONSTRAINT = 'reservations_vitrine_creneau_actif_excl'

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function requestedLocalDate(date: Date, fuseau: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(fuseau).toPlainDate().toString()
}

function assertReservationService(context: PublicAgendaService): void {
  if (!isServiceType(context.service.type) || getServiceFlow(context.service.type) !== 'reservation') {
    throw new UnprocessableError('CRENEAU_INDISPONIBLE')
  }
}

export async function createReservation(
  username: string,
  input: ReservationServiceInput,
  maintenant: Date = new Date(),
): Promise<CreatedReservation> {
  const debutDemande = new Date(input.debut)
  if (Number.isNaN(debutDemande.getTime())) throw new UnprocessableError('CRENEAU_INDISPONIBLE')

  try {
    return await db.transaction(async (tx) => {
      const lookup: ServiceLookup = 'serviceSlug' in input
        ? { serviceSlug: input.serviceSlug }
        : { serviceId: input.serviceId }
      const context = await requirePublicAgendaService(tx, username, lookup)
      assertReservationService(context)
      const localDate = requestedLocalDate(debutDemande, context.vitrine.fuseau)
      const disponibles = await computeServiceCreneaux(tx, context, localDate, localDate, maintenant)
      const creneau = disponibles.find(({ debut }) => debut.getTime() === debutDemande.getTime())
      if (!creneau) {
        const sansReservations = await computeServiceCreneaux(tx, context, localDate, localDate, maintenant, false)
        const existeSansConflit = sansReservations.some(({ debut }) => debut.getTime() === debutDemande.getTime())
        if (existeSansConflit) throw new ConflictError('CRENEAU_PRIS')
        throw new UnprocessableError('CRENEAU_INDISPONIBLE')
      }

      const token = randomBytes(32).toString('base64url')
      const expireLe = new Date(maintenant.getTime() + CONFIRMATION_DUREE_MINUTES * 60_000)
      const [reservation] = await tx
        .insert(reservations)
        .values({
          id: randomUUID(),
          vitrineId: context.vitrine.id,
          serviceId: context.service.id,
          nom: input.nom,
          email: input.email,
          telephone: input.telephone,
          note: input.note,
          debut: creneau.debut,
          fin: creneau.fin,
          statut: 'en_attente',
          paiementChoisi: input.paiementChoisi,
          paiementStatut: 'non_requis',
          rappelEmail: input.rappelEmail,
          confirmationTokenHash: tokenHash(token),
          confirmationExpireLe: expireLe,
        })
        .returning()
      if (!reservation) throw new Error('Insertion de la réservation sans résultat.')
      await insertTransactionalEmailEvents(tx, 'reservation', reservation.id, [
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
      ])
      return { reservation, service: context.service, vitrine: context.vitrine, confirmation: { token, expireLe } }
    })
  } catch (error) {
    const pg = readPgError(error)
    if (pg.code === PG_EXCLUSION_VIOLATION && pg.constraint === EXCLUSION_CONSTRAINT) {
      throw new ConflictError('CRENEAU_PRIS')
    }
    throw error
  }
}

export async function listOwnReservations(userId: string): Promise<{
  items: Array<{ reservation: ReservationRow, service: typeof services.$inferSelect }>
}> {
  const vitrineId = await requireVitrineId(userId)
  await db
    .update(reservations)
    .set({ statut: 'terminee', updatedAt: new Date() })
    .where(and(
      eq(reservations.vitrineId, vitrineId),
      eq(reservations.statut, 'confirmee'),
      lte(reservations.fin, new Date()),
    ))
  const items = await db
    .select({ reservation: reservations, service: services })
    .from(reservations)
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .where(eq(reservations.vitrineId, vitrineId))
    .orderBy(asc(reservations.debut), asc(reservations.id))
  return { items }
}

async function transitionOwnReservation(
  userId: string,
  id: string,
  statut: ReservationStatut,
  motifAnnulation?: string,
): Promise<{ item: ReservationRow }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ reservation: reservations })
      .from(reservations)
      .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
      .where(and(eq(reservations.id, id), eq(vitrines.userId, userId)))
      .for('update')
    if (!current) throw new NotFoundError('RESERVATION_INTROUVABLE')
    const from = current.reservation.statut as ReservationStatut
    if (!canTransitionReservation(from, statut)) {
      throw new UnprocessableError('TRANSITION_RESERVATION_INVALIDE')
    }
    const [item] = await tx
      .update(reservations)
      .set({
        statut,
        motifAnnulation: statut === 'annulee' ? motifAnnulation : current.reservation.motifAnnulation,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, id))
      .returning()
    if (!item) throw new NotFoundError('RESERVATION_INTROUVABLE')
    // Le refus et l'annulation produisent des emails distincts (décision client 2026-10-31) ;
    // un refus ne porte jamais de motif.
    await insertTransactionalEmailEvents(tx, 'reservation', item.id, [
      statut === 'confirmee'
        ? 'reservation_visiteur_confirmee'
        : statut === 'refusee'
          ? 'reservation_visiteur_refusee'
          : 'reservation_visiteur_annulee',
    ])
    return { item }
  })
}

export function confirmReservation(userId: string, id: string): Promise<{ item: ReservationRow }> {
  return transitionOwnReservation(userId, id, 'confirmee')
}

export function cancelReservation(
  userId: string,
  id: string,
  input: { motif?: string },
): Promise<{ item: ReservationRow }> {
  return transitionOwnReservation(userId, id, 'annulee', input.motif)
}

export function refuseReservation(userId: string, id: string): Promise<{ item: ReservationRow }> {
  return transitionOwnReservation(userId, id, 'refusee')
}

export async function completePastReservations(maintenant: Date = new Date()): Promise<number> {
  const updated = await db
    .update(reservations)
    .set({ statut: 'terminee', updatedAt: maintenant })
    .where(and(eq(reservations.statut, 'confirmee'), lte(reservations.fin, maintenant)))
    .returning({ id: reservations.id })
  return updated.length
}

export async function getReservationConfirmation(
  token: string,
  maintenant: Date = new Date(),
  username?: string,
): Promise<ReservationConfirmation> {
  const [result] = await db
    .select({
      reservation: {
        id: reservations.id,
        statut: reservations.statut,
        debut: reservations.debut,
        fin: reservations.fin,
        paiementChoisi: reservations.paiementChoisi,
        confirmationExpireLe: reservations.confirmationExpireLe,
      },
      service: {
        titre: services.titre,
        dureeMin: services.dureeMin,
        tarif: services.tarif,
        prixMontant: services.prixMontant,
        prixDevise: services.prixDevise,
      },
      vitrine: {
        username: vitrines.username,
        titre: vitrines.titre,
        prenom: vitrines.prenom,
        nom: vitrines.nom,
        metier: vitrines.metier,
        ville: vitrines.ville,
        pays: vitrines.pays,
      },
    })
    .from(reservations)
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .where(and(
      eq(reservations.confirmationTokenHash, tokenHash(token)),
      ...(username === undefined ? [] : [eq(vitrines.username, normalizeUsernameForConfirmation(username))]),
    ))
    .limit(1)
  if (!result) throw new NotFoundError('CONFIRMATION_RESERVATION_INVALIDE')
  if (result.reservation.confirmationExpireLe.getTime() <= maintenant.getTime()) {
    throw new GoneError('CONFIRMATION_EXPIREE')
  }
  return result
}

function normalizeUsernameForConfirmation(username: string): string {
  return username.trim().toLowerCase()
}
