import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { temoignages } from '../../shared/db/schema'
import { LISTE_SLUG_MAX, VEDETTE_MAX } from '../../shared/listes'
import type { TemoignageCreateInput, TemoignageUpdateInput } from '../../shared/schemas/temoignage'
import { ConflictError, NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { computeCompteurs, resolveEnVedette, pickAvailableSlug } from './listes-regles'
import type { Compteurs } from './listes-regles'
import { lockVitrineId, requireVitrineId } from './vitrine-acces'
import type { Executor } from './vitrine-acces'
import { normalizeTemoignageState, slugFromAuteurTemoignage } from './temoignages-regles'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type TemoignageRow = typeof temoignages.$inferSelect

const SLUG_UNIQUE = 'temoignages_slug_idx'
const ORDER = [asc(temoignages.ordre), asc(temoignages.createdAt), asc(temoignages.id)] as const
const EMPTY_STATE: TemoignageState = { actif: true, enVedette: false }

interface TemoignageState {
  actif: boolean
  enVedette: boolean
}

function selectTemoignages(executor: Executor) {
  return executor.select().from(temoignages)
}

async function listRows(executor: Executor, vitrineId: string): Promise<TemoignageRow[]> {
  return executor.select().from(temoignages).where(eq(temoignages.vitrineId, vitrineId)).orderBy(...ORDER)
}

async function loadItem(executor: Executor, id: string): Promise<TemoignageRow | undefined> {
  const [ligne] = await selectTemoignages(executor).where(eq(temoignages.id, id))
  return ligne
}

function pickState(patch: TemoignageUpdateInput | TemoignageCreateInput): Partial<TemoignageState> {
  return {
    actif: patch.actif,
    enVedette: patch.enVedette,
  }
}

function orKeep<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value
}

function vedetteComplete(vedettes: readonly TemoignageRow[]): ConflictError {
  return new ConflictError('VEDETTE_COMPLETE', {
    enVedette: vedettes.map((ligne) => ({ id: ligne.id, auteur: ligne.auteur })),
  })
}

export async function listOwnTemoignages(userId: string): Promise<{ items: TemoignageRow[]; compteurs: Compteurs }> {
  const entries = await listRows(db, await requireVitrineId(userId))
  return {
    items: entries,
    compteurs: computeCompteurs(entries.map((ligne) => ({ actif: ligne.actif, enVedette: ligne.enVedette })), VEDETTE_MAX),
  }
}

export async function getOwnTemoignage(userId: string, id: string): Promise<{ item: TemoignageRow; compteurs: Compteurs }> {
  const entries = await listRows(db, await requireVitrineId(userId))
  const ligne = entries.find((candidate) => candidate.id === id)
  if (!ligne) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
  return {
    item: ligne,
    compteurs: computeCompteurs(
      entries.map((candidate) => ({ actif: candidate.actif, enVedette: candidate.enVedette })),
      VEDETTE_MAX,
    ),
  }
}

async function insertTemoignage(userId: string, input: TemoignageCreateInput): Promise<{ item: TemoignageRow; compteurs: Compteurs }> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)

    const etat = normalizeTemoignageState(EMPTY_STATE, pickState(input))

    const vedettes = rows.filter((ligne) => ligne.enVedette)
    const enVedette = resolveEnVedette({
      demande: input.enVedette,
      actif: etat.actif,
      autresEnVedette: vedettes.length,
      max: VEDETTE_MAX,
    })
    if (enVedette === 'COMPLET') throw vedetteComplete(vedettes)

    const base = input.slug.trim() ?? slugFromAuteurTemoignage(input.auteur)
    const slug = pickAvailableSlug(base, new Set(rows.map((ligne) => ligne.slug)), LISTE_SLUG_MAX)
    const [cree] = await tx
      .insert(temoignages)
      .values({
        id: randomUUID(),
        vitrineId,
        slug,
        auteur: input.auteur,
        fonction: input.fonction ?? null,
        texte: input.texte,
        enVedette,
        ordre: rows.reduce((max, ligne) => Math.max(max, ligne.ordre + 1), 0),
        actif: etat.actif,
      })
      .returning({ id: temoignages.id })
    if (!cree) throw new Error('Insertion du témoignage sans résultat.')

    const item = await loadItem(tx, cree.id)
    if (!item) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
    return { item, compteurs: computeCompteurs([...rows, item].map((ligne) => ({ actif: ligne.actif, enVedette: ligne.enVedette })), VEDETTE_MAX) }
  })
}

export async function createTemoignage(userId: string, input: TemoignageCreateInput): Promise<{ item: TemoignageRow; compteurs: Compteurs }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertTemoignage(userId, input)
    } catch (error) {
      const { code, constraint } = readPgError(error)
      if (code === PG_UNIQUE_VIOLATION && constraint === SLUG_UNIQUE && attempt < 2) continue
      throw error
    }
  }
}

export async function updateTemoignage(
  userId: string,
  id: string,
  patch: TemoignageUpdateInput,
): Promise<{ item: TemoignageRow; compteurs: Compteurs }> {
  const result = await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const current = rows.find((ligne) => ligne.id === id)
    if (!current) throw new NotFoundError('TEMOINAGE_INTROUVABLE')

    const avant: TemoignageState = { actif: current.actif, enVedette: current.enVedette }
    const etat = normalizeTemoignageState(avant, pickState(patch))

    if (etat.enVedette && !current.enVedette) {
      const autres = rows.filter((ligne) => ligne.id !== id && ligne.enVedette)
      const decision = resolveEnVedette({ demande: true, actif: etat.actif, autresEnVedette: autres.length, max: VEDETTE_MAX })
      if (decision === 'COMPLET') throw vedetteComplete(autres)
    }

    await tx
      .update(temoignages)
      .set({
        auteur: orKeep(patch.auteur, current.auteur),
        fonction: patch.fonction !== undefined ? patch.fonction : current.fonction,
        texte: orKeep(patch.texte, current.texte),
        enVedette: etat.enVedette,
        actif: etat.actif,
        updatedAt: new Date(),
      })
      .where(and(eq(temoignages.id, id), eq(temoignages.vitrineId, vitrineId)))

    const item = await loadItem(tx, id)
    if (!item) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
    const compteurs = computeCompteurs(
      rows.map((ligne) => (ligne.id === id ? item : ligne)).map((ligne) => ({ actif: ligne.actif, enVedette: ligne.enVedette })),
      VEDETTE_MAX,
    )
    return { item, compteurs }
  })
  return result
}
export async function deleteTemoignage(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const [existante] = await tx
      .select({ id: temoignages.id })
      .from(temoignages)
      .where(and(eq(temoignages.id, id), eq(temoignages.vitrineId, vitrineId)))
    if (!existante) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
    const [deleted] = await tx
      .delete(temoignages)
      .where(and(eq(temoignages.id, id), eq(temoignages.vitrineId, vitrineId)))
      .returning({ id: temoignages.id })
    if (!deleted) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
  })
}

/** `ids` doit être une permutation exacte de TOUS les témoignages de la vitrine. */
export async function reorderTemoignages(userId: string, ids: readonly string[]): Promise<{ items: TemoignageRow[]; compteurs: Compteurs }> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const known = new Set(rows.map((ligne) => ligne.id))
    const complete = ids.length === known.size && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
    if (!complete) throw new UnprocessableError('ORDRE_INVALIDE')

    if (ids.length > 0) {
      const liste = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await tx.execute(sql`
        UPDATE temoignages AS t SET ordre = v.rang - 1
        FROM unnest(ARRAY[${liste}]::text[]) WITH ORDINALITY AS v(id, rang)
        WHERE t.id = v.id AND t.vitrine_id = ${vitrineId}
      `)
    }
    const entries = await listRows(tx, vitrineId)
    return {
      items: entries,
      compteurs: computeCompteurs(entries.map((ligne) => ({ actif: ligne.actif, enVedette: ligne.enVedette })), VEDETTE_MAX),
    }
  })
}

async function listVisible(vitrineId: string): Promise<TemoignageRow[]> {
  return selectTemoignages(db)
    .where(and(eq(temoignages.vitrineId, vitrineId), eq(temoignages.actif, true)))
    .orderBy(...ORDER)
}

/** Témoignages visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : 404. */
export async function getPublicTemoignages(rawUsername: string): Promise<{ vitrine: VitrineRow; total: number; temoignages: TemoignageRow[] }> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const visibles = await listVisible(vitrine.id)
  return {
    vitrine,
    total: visibles.length,
    temoignages: visibles,
  }
}
