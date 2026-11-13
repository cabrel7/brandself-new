import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, gte, inArray, lt, or } from 'drizzle-orm'
import type { ReservationStatut } from '../../shared/agenda'
import { INDISPONIBILITE_PLAGE_MAX_JOURS } from '../../shared/agenda'
import { disponibilites, indisponibilites, reservations, vitrines } from '../../shared/db/schema'
import { ABONNEMENT_FUSEAU_REPLI } from '../../shared/plans'
import type { DisponibiliteInput, IndisponibiliteCreateInput } from '../../shared/schemas/agenda'
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { bornesJourLocal, dateEstPassee, etendrePlage } from './agenda-regles'
import { lockVitrineId, requireVitrineId } from './vitrine-acces'

export type DisponibiliteRow = typeof disponibilites.$inferSelect
export type IndisponibiliteRow = typeof indisponibilites.$inferSelect

/** Réservations qui occupent encore un créneau : seules celles-ci comptent comme « concernées » par une fermeture. */
const STATUTS_RESERVATION_ACTIFS = ['en_attente', 'confirmee'] as const satisfies readonly ReservationStatut[]
const FUSEAU_REPLI = ABONNEMENT_FUSEAU_REPLI

export interface AgendaSettingsPatch {
  pasCreneauMin?: 15 | 30 | 60
  preavisHeures?: number
  horizonJours?: number
}

export interface OwnAgenda {
  disponibilites: DisponibiliteRow[]
  indisponibilites: IndisponibiliteRow[]
  reglages: {
    fuseau: string
    pasCreneauMin: number
    preavisHeures: number
    horizonJours: number
  }
}

function toMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function assertNoOverlap(items: readonly DisponibiliteInput[]): void {
  const byDay = new Map<number, Array<{ debut: number, fin: number }>>()
  for (const item of items) {
    const debut = toMinutes(item.debut)
    const fin = toMinutes(item.fin)
    if (debut >= fin) throw new UnprocessableError('DISPONIBILITES_INVALIDES')
    const day = byDay.get(item.jourSemaine) ?? []
    day.push({ debut, fin })
    byDay.set(item.jourSemaine, day)
  }

  for (const ranges of byDay.values()) {
    ranges.sort((a, b) => a.debut - b.debut || a.fin - b.fin)
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index]!.debut < ranges[index - 1]!.fin) {
        throw new UnprocessableError('DISPONIBILITES_INVALIDES')
      }
    }
  }
}

export async function getOwnAgenda(userId: string): Promise<OwnAgenda> {
  const [vitrine] = await db
    .select({
      id: vitrines.id,
      fuseau: vitrines.fuseau,
      pasCreneauMin: vitrines.pasCreneauMin,
      preavisHeures: vitrines.preavisHeures,
      horizonJours: vitrines.horizonJours,
    })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')

  const plages = await db
    .select()
    .from(disponibilites)
    .where(eq(disponibilites.vitrineId, vitrine.id))
    .orderBy(asc(disponibilites.jourSemaine), asc(disponibilites.debut), asc(disponibilites.fin))
  const exceptions = await db
    .select()
    .from(indisponibilites)
    .where(eq(indisponibilites.vitrineId, vitrine.id))
    .orderBy(asc(indisponibilites.date), asc(indisponibilites.id))

  return {
    disponibilites: plages,
    indisponibilites: exceptions,
    reglages: {
      fuseau: vitrine.fuseau,
      pasCreneauMin: vitrine.pasCreneauMin,
      preavisHeures: vitrine.preavisHeures,
      horizonJours: vitrine.horizonJours,
    },
  }
}

export async function replaceDisponibilites(
  userId: string,
  items: readonly DisponibiliteInput[],
  settings: AgendaSettingsPatch = {},
): Promise<OwnAgenda> {
  assertNoOverlap(items)
  await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    await tx.delete(disponibilites).where(eq(disponibilites.vitrineId, vitrineId))
    if (items.length > 0) {
      await tx.insert(disponibilites).values(items.map((item) => ({
        id: randomUUID(),
        vitrineId,
        jourSemaine: item.jourSemaine,
        debut: item.debut,
        fin: item.fin,
      })))
    }
    if (Object.keys(settings).length > 0) {
      await tx.update(vitrines).set({ ...settings, updatedAt: new Date() }).where(eq(vitrines.id, vitrineId))
    }
  })
  return getOwnAgenda(userId)
}

export async function listOwnIndisponibilites(userId: string): Promise<{ items: IndisponibiliteRow[] }> {
  const vitrineId = await requireVitrineId(userId)
  const items = await db
    .select()
    .from(indisponibilites)
    .where(eq(indisponibilites.vitrineId, vitrineId))
    .orderBy(asc(indisponibilites.date), asc(indisponibilites.id))
  return { items }
}

export interface IndisponibiliteDateResult { type: 'date', item: IndisponibiliteRow, reservationsConcernees: number }
export interface IndisponibilitePlageResult {
  type: 'plage'
  items: IndisponibiliteRow[]
  creees: number
  ignorees: number
  reservationsConcernees: number
}
export type IndisponibiliteCreateResult = IndisponibiliteDateResult | IndisponibilitePlageResult
type IndisponibiliteDateInput = Extract<IndisponibiliteCreateInput, { date: string }>
type IndisponibilitePlageInput = Extract<IndisponibiliteCreateInput, { debut: string }>

/**
 * Réservations de LA vitrine encore actives (en attente ou confirmées) dont le début tombe dans l'un des jours
 * locaux donnés (bornes [00:00, 24:00) du fuseau de la vitrine). Simple comptage : rien n'est annulé ni bloqué.
 */
async function compterReservationsConcernees(vitrineId: string, dates: readonly string[], fuseau: string): Promise<number> {
  if (dates.length === 0) return 0
  const jours = dates.map((date) => {
    const { debut, fin } = bornesJourLocal(date, fuseau)
    return and(gte(reservations.debut, debut), lt(reservations.debut, fin))
  })
  const [ligne] = await db
    .select({ total: count() })
    .from(reservations)
    .where(and(
      eq(reservations.vitrineId, vitrineId),
      inArray(reservations.statut, [...STATUTS_RESERVATION_ACTIFS]),
      or(...jours),
    ))
  return ligne?.total ?? 0
}

/**
 * Ferme une date ou une plage. Règles serveur (l'interface n'est qu'un confort) : aucune date passée dans le fuseau
 * de la vitrine, plage de 60 jours au plus. Une ligne par jour, toutes insérées dans une seule transaction ; pour une
 * plage les dates déjà fermées sont ignorées (comptées), pour une date unique elle lève INDISPONIBILITE_EXISTANTE.
 */
export async function createIndisponibilite(userId: string, input: IndisponibiliteDateInput, now?: Date): Promise<IndisponibiliteDateResult>
export async function createIndisponibilite(userId: string, input: IndisponibilitePlageInput, now?: Date): Promise<IndisponibilitePlageResult>
export async function createIndisponibilite(userId: string, input: IndisponibiliteCreateInput, now?: Date): Promise<IndisponibiliteCreateResult>
export async function createIndisponibilite(
  userId: string,
  input: IndisponibiliteCreateInput,
  now: Date = new Date(),
): Promise<IndisponibiliteCreateResult> {
  const plage = 'debut' in input
  const debut = plage ? input.debut : input.date
  const dates = plage ? datesDeLaPlage(input.debut, input.fin) : [input.date]

  const { vitrine, creees } = await db.transaction(async (tx) => {
    const [verrouillee] = await tx
      .select({ id: vitrines.id, fuseau: vitrines.fuseau })
      .from(vitrines)
      .where(eq(vitrines.userId, userId))
      .for('update')
    if (!verrouillee) throw new NotFoundError('VITRINE_INTROUVABLE')
    if (dateEstPassee(debut, now, verrouillee.fuseau || FUSEAU_REPLI)) throw new UnprocessableError('INDISPONIBILITE_DATE_PASSEE')

    const inserees = await tx
      .insert(indisponibilites)
      .values(dates.map((date) => ({ id: randomUUID(), vitrineId: verrouillee.id, date, raison: input.raison })))
      .onConflictDoNothing({ target: [indisponibilites.vitrineId, indisponibilites.date] })
      .returning()
    return { vitrine: verrouillee, creees: inserees.sort((a, b) => a.date.localeCompare(b.date)) }
  })

  const reservationsConcernees = await compterReservationsConcernees(
    vitrine.id,
    creees.map((item) => item.date),
    vitrine.fuseau || FUSEAU_REPLI,
  )
  if (!plage) {
    const [item] = creees
    if (!item) throw new ConflictError('INDISPONIBILITE_EXISTANTE')
    return { type: 'date', item, reservationsConcernees }
  }
  return { type: 'plage', items: creees, creees: creees.length, ignorees: dates.length - creees.length, reservationsConcernees }
}

function datesDeLaPlage(debut: string, fin: string): string[] {
  try {
    return etendrePlage(debut, fin, INDISPONIBILITE_PLAGE_MAX_JOURS)
  }
  catch {
    // Les routes valident déjà le schéma ; ce garde protège les autres appelants (outils, scripts).
    throw new ValidationError({ fin: ['La plage est invalide ou dépasse la durée maximale.'] })
  }
}

export async function deleteIndisponibilite(userId: string, id: string): Promise<void> {
  const vitrineId = await requireVitrineId(userId)
  const [deleted] = await db
    .delete(indisponibilites)
    .where(and(eq(indisponibilites.id, id), eq(indisponibilites.vitrineId, vitrineId)))
    .returning({ id: indisponibilites.id })
  if (!deleted) throw new NotFoundError('INDISPONIBILITE_INTROUVABLE')
}
