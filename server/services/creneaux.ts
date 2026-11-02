import { Temporal } from '@js-temporal/polyfill'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { ReservationStatut } from '../../shared/agenda'
import { disponibilites, indisponibilites, reservations, services, vitrines } from '../../shared/db/schema'
import { NotFoundError } from '../exceptions/http'
import { db } from '../utils/db'
import { hasValidUsernameFormat, normalizeUsername } from '../utils/username'
import { getServiceFlow, isServiceType } from './reservations-regles'

export interface DisponibiliteCreneaux {
  jourSemaine: number
  debut: string
  fin: string
}

export interface IndisponibiliteCreneaux {
  date: string
}

export interface ReservationCreneaux {
  debut: Date
  fin: Date
  statut: ReservationStatut
}

export interface ComputeCreneauxInput {
  du: string
  au: string
  fuseau: string
  pasCreneauMin: number
  dureeMin: number
  preavisHeures: number
  horizonJours: number
  disponibilites: readonly DisponibiliteCreneaux[]
  indisponibilites: readonly IndisponibiliteCreneaux[]
  reservations: readonly ReservationCreneaux[]
  clock: () => Date
}

export interface Creneau {
  debut: Date
  fin: Date
}

type Executor = Pick<typeof db, 'select'>
export type AgendaServiceRow = typeof services.$inferSelect

export interface PublicAgendaService {
  vitrine: {
    id: string
    username: string
    fuseau: string
    pasCreneauMin: number
    preavisHeures: number
    horizonJours: number
  }
  service: AgendaServiceRow
}

export type ServiceLookup = { serviceSlug: string } | { serviceId: string }

export interface ListCreneauxInput {
  username: string
  serviceSlug: string
  du: string
  au: string
  maintenant: Date
}

const STATUTS_BLOQUANTS: ReadonlySet<ReservationStatut> = new Set(['en_attente', 'confirmee'])
const MINUTE_MS = 60_000

function minutes(heure: string): number {
  const [hour = 0, minute = 0] = heure.split(':').map(Number)
  return hour * 60 + minute
}

function plainTime(totalMinutes: number): Temporal.PlainTime {
  return Temporal.PlainTime.from({
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  })
}

function instantFor(date: Temporal.PlainDate, time: Temporal.PlainTime, fuseau: string): Temporal.Instant | null {
  const zoned = Temporal.ZonedDateTime.from({
    timeZone: fuseau,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
  }, { disambiguation: 'earlier' })

  if (!zoned.toPlainDate().equals(date) || !zoned.toPlainTime().equals(time)) return null
  return zoned.toInstant()
}

function overlapsReservation(debut: number, fin: number, reservations: readonly ReservationCreneaux[]): boolean {
  return reservations.some((reservation) =>
    STATUTS_BLOQUANTS.has(reservation.statut)
    && debut < reservation.fin.getTime()
    && reservation.debut.getTime() < fin,
  )
}

export function computeCreneaux(input: ComputeCreneauxInput): Creneau[] {
  const now = input.clock()
  const nowInstant = Temporal.Instant.fromEpochMilliseconds(now.getTime())
  const today = nowInstant.toZonedDateTimeISO(input.fuseau).toPlainDate()
  const requestedStart = Temporal.PlainDate.from(input.du)
  const requestedEnd = Temporal.PlainDate.from(input.au)
  const start = Temporal.PlainDate.compare(requestedStart, today) < 0 ? today : requestedStart
  const horizon = today.add({ days: input.horizonJours })
  const end = Temporal.PlainDate.compare(requestedEnd, horizon) > 0 ? horizon : requestedEnd
  if (Temporal.PlainDate.compare(start, end) > 0) return []

  const indisponibles = new Set(input.indisponibilites.map(({ date }) => date))
  const noticeLimit = now.getTime() + input.preavisHeures * 60 * MINUTE_MS
  const result = new Map<number, Creneau>()

  for (let date = start; Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 })) {
    if (indisponibles.has(date.toString())) continue
    for (const disponibilite of input.disponibilites) {
      if (disponibilite.jourSemaine !== date.dayOfWeek) continue
      const debutPlage = minutes(disponibilite.debut)
      const finPlage = minutes(disponibilite.fin)

      for (let minute = debutPlage; minute + input.dureeMin <= finPlage; minute += input.pasCreneauMin) {
        const instant = instantFor(date, plainTime(minute), input.fuseau)
        if (instant === null) continue
        const debut = Number(instant.epochMilliseconds)
        const fin = debut + input.dureeMin * MINUTE_MS
        if (debut < noticeLimit || overlapsReservation(debut, fin, input.reservations)) continue
        result.set(debut, { debut: new Date(debut), fin: new Date(fin) })
      }
    }
  }

  return [...result.values()].sort((a, b) => a.debut.getTime() - b.debut.getTime())
}

export async function requirePublicAgendaService(
  executor: Executor,
  rawUsername: string,
  lookup: ServiceLookup,
): Promise<PublicAgendaService> {
  const username = normalizeUsername(rawUsername)
  if (!hasValidUsernameFormat(username)) throw new NotFoundError('SERVICE_INTROUVABLE')
  const selector = 'serviceSlug' in lookup
    ? eq(services.slug, lookup.serviceSlug.trim().toLowerCase())
    : eq(services.id, lookup.serviceId)
  const [row] = await executor
    .select({
      vitrine: {
        id: vitrines.id,
        username: vitrines.username,
        fuseau: vitrines.fuseau,
        pasCreneauMin: vitrines.pasCreneauMin,
        preavisHeures: vitrines.preavisHeures,
        horizonJours: vitrines.horizonJours,
      },
      service: services,
    })
    .from(vitrines)
    .innerJoin(services, eq(services.vitrineId, vitrines.id))
    .where(and(
      eq(vitrines.username, username),
      isNotNull(vitrines.publieeLe),
      selector,
      eq(services.actif, true),
      eq(services.reservable, true),
    ))
    .limit(1)
  if (!row) throw new NotFoundError('SERVICE_INTROUVABLE')
  return row
}

export async function computeServiceCreneaux(
  executor: Executor,
  context: PublicAgendaService,
  du: string,
  au: string,
  maintenant: Date,
  includeReservations = true,
): Promise<Creneau[]> {
  if (context.service.dureeMin === null) throw new NotFoundError('SERVICE_INTROUVABLE')
  const plages = await executor
    .select({
      jourSemaine: disponibilites.jourSemaine,
      debut: disponibilites.debut,
      fin: disponibilites.fin,
    })
    .from(disponibilites)
    .where(eq(disponibilites.vitrineId, context.vitrine.id))
    .orderBy(asc(disponibilites.jourSemaine), asc(disponibilites.debut))
  const exceptions = await executor
    .select({ date: indisponibilites.date })
    .from(indisponibilites)
    .where(eq(indisponibilites.vitrineId, context.vitrine.id))
  const activeReservations = includeReservations
    ? await executor
        .select({ debut: reservations.debut, fin: reservations.fin, statut: reservations.statut })
        .from(reservations)
        .where(and(
          eq(reservations.vitrineId, context.vitrine.id),
          inArray(reservations.statut, ['en_attente', 'confirmee']),
        ))
    : []
  const blockingReservations: ReservationCreneaux[] = activeReservations.map((reservation) => ({
    debut: reservation.debut,
    fin: reservation.fin,
    statut: reservation.statut === 'confirmee' ? 'confirmee' : 'en_attente',
  }))

  return computeCreneaux({
    du,
    au,
    fuseau: context.vitrine.fuseau,
    pasCreneauMin: context.vitrine.pasCreneauMin,
    dureeMin: context.service.dureeMin,
    preavisHeures: context.vitrine.preavisHeures,
    horizonJours: context.vitrine.horizonJours,
    disponibilites: plages,
    indisponibilites: exceptions,
    reservations: blockingReservations,
    clock: () => maintenant,
  })
}

export async function listCreneaux(input: ListCreneauxInput): Promise<PublicAgendaService & { creneaux: Creneau[] }> {
  const context = await requirePublicAgendaService(db, input.username, { serviceSlug: input.serviceSlug })
  if (!isServiceType(context.service.type) || getServiceFlow(context.service.type) !== 'reservation') {
    throw new NotFoundError('SERVICE_INTROUVABLE')
  }
  const creneaux = await computeServiceCreneaux(db, context, input.du, input.au, input.maintenant)
  return { ...context, creneaux }
}
