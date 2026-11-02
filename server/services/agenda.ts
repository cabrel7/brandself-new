import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { disponibilites, indisponibilites, vitrines } from '../../shared/db/schema'
import type { DisponibiliteInput, IndisponibiliteCreateInput } from '../../shared/schemas/agenda'
import { ConflictError, NotFoundError, UnprocessableError } from '../exceptions/http'
import { PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { db } from '../utils/db'
import { lockVitrineId, requireVitrineId } from './vitrine-acces'

export type DisponibiliteRow = typeof disponibilites.$inferSelect
export type IndisponibiliteRow = typeof indisponibilites.$inferSelect

const INDISPONIBILITE_DATE_UNIQUE = 'indisponibilites_vitrine_id_date_unique'

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

export async function createIndisponibilite(
  userId: string,
  input: IndisponibiliteCreateInput,
): Promise<{ item: IndisponibiliteRow }> {
  const vitrineId = await requireVitrineId(userId)
  try {
    const [item] = await db
      .insert(indisponibilites)
      .values({ id: randomUUID(), vitrineId, date: input.date, raison: input.raison })
      .returning()
    if (!item) throw new Error('Insertion de l’indisponibilité sans résultat.')
    return { item }
  }
  catch (error) {
    const { code, constraint } = readPgError(error)
    if (code === PG_UNIQUE_VIOLATION && constraint === INDISPONIBILITE_DATE_UNIQUE) {
      throw new ConflictError('INDISPONIBILITE_EXISTANTE')
    }
    throw error
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
