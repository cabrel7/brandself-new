import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { temoignages } from '../../shared/db/schema'
import { LISTE_SLUG_MAX, VEDETTE_MAX } from '../../shared/listes'
import type { TemoignageCreateInput, TemoignageUpdateInput } from '../../shared/schemas/temoignage'
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { computeCompteurs, resolveEnVedette, pickAvailableSlug } from './listes-regles'
import { getLimiteStudio, getPlanPublic, marquerMasque, sqlIdsVisibles, vuePlanStudio } from './plan-visibilite'
import type { CompteursAvecPlan } from './plan-visibilite'
import { assertQuota } from './plans'
import { lockVitrineId, requireVitrineId } from './vitrine-acces'
import type { Executor } from './vitrine-acces'
import { checkTemoignageCoherence, normalizeTemoignageState, slugFromAuteurTemoignage } from './temoignages-regles'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type TemoignageRow = typeof temoignages.$inferSelect
/** Ligne du studio : `masqueParPlan` = actif mais au-delà de la limite du plan (S10 #127). */
export type TemoignageStudioRow = TemoignageRow & { masqueParPlan: boolean }

export interface TemoignageAvecCompteurs {
  item: TemoignageStudioRow
  compteurs: CompteursAvecPlan
}

export interface TemoignagesAvecCompteurs {
  items: TemoignageStudioRow[]
  compteurs: CompteursAvecPlan
}

const SLUG_UNIQUE = 'temoignages_vitrine_id_slug_unique'
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

async function loadItem(executor: Executor, vitrineId: string, id: string): Promise<TemoignageRow | undefined> {
  const [ligne] = await selectTemoignages(executor).where(
    and(eq(temoignages.vitrineId, vitrineId), eq(temoignages.id, id)),
  )
  return ligne
}

async function loadItemBySlug(executor: Executor, vitrineId: string, slug: string): Promise<TemoignageRow | undefined> {
  const [ligne] = await selectTemoignages(executor).where(
    and(eq(temoignages.vitrineId, vitrineId), eq(temoignages.slug, slug)),
  )
  return ligne
}

type TemoignageLocator =
  | { kind: 'id'; value: string }
  | { kind: 'slug'; value: string }

function matchesLocator(row: TemoignageRow, locator: TemoignageLocator): boolean {
  return locator.kind === 'id' ? row.id === locator.value : row.slug === locator.value
}

function scopedLocator(vitrineId: string, locator: TemoignageLocator) {
  return locator.kind === 'id'
    ? and(eq(temoignages.vitrineId, vitrineId), eq(temoignages.id, locator.value))
    : and(eq(temoignages.vitrineId, vitrineId), eq(temoignages.slug, locator.value))
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

function assertCoherent(etat: TemoignageState): void {
  const erreurs = checkTemoignageCoherence(etat)
  if (Object.keys(erreurs).length > 0) throw new ValidationError(erreurs)
}

function vedetteComplete(vedettes: readonly TemoignageRow[]): ConflictError {
  return new ConflictError('VEDETTE_COMPLETE', {
    enVedette: vedettes.map((ligne) => ({ id: ligne.id, auteur: ligne.auteur })),
  })
}

/**
 * Vue du studio sur la liste COMPLÈTE de la vitrine : chaque ligne porte `masqueParPlan`, les compteurs portent
 * `limitePlan` (usage = toutes les lignes, visibles ou non, comme le quota de création).
 */
function versStudio(rows: readonly TemoignageRow[], limite: number | null): TemoignagesAvecCompteurs {
  const vue = vuePlanStudio(rows, limite)
  return {
    items: rows.map((ligne) => marquerMasque(ligne, vue.masques)),
    compteurs: { ...computeCompteurs(rows, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

/** Même vue, centrée sur le témoignage `cible` de `rows` (la liste complète après l'écriture). */
function versStudioItem(rows: readonly TemoignageRow[], cible: TemoignageRow, limite: number | null): TemoignageAvecCompteurs {
  const vue = vuePlanStudio(rows, limite)
  return {
    item: marquerMasque(cible, vue.masques),
    compteurs: { ...computeCompteurs(rows, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

export async function listOwnTemoignages(userId: string, now: Date = new Date()): Promise<TemoignagesAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [entries, limite] = await Promise.all([listRows(db, vitrineId), getLimiteStudio(userId, 'temoignages', now)])
  return versStudio(entries, limite)
}

export async function getOwnTemoignage(userId: string, id: string, now: Date = new Date()): Promise<TemoignageAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [entries, limite] = await Promise.all([listRows(db, vitrineId), getLimiteStudio(userId, 'temoignages', now)])
  const ligne = entries.find((candidate) => candidate.id === id)
  if (!ligne) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
  return versStudioItem(entries, ligne, limite)
}

export async function getOwnTemoignageBySlug(userId: string, slug: string, now: Date = new Date()): Promise<TemoignageAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [entries, ligne, limite] = await Promise.all([
    listRows(db, vitrineId),
    loadItemBySlug(db, vitrineId, slug),
    getLimiteStudio(userId, 'temoignages', now),
  ])
  if (!ligne) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
  return versStudioItem(entries, ligne, limite)
}

async function insertTemoignage(userId: string, input: TemoignageCreateInput, now: Date): Promise<TemoignageAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    // Quota sous le verrou vitrine : deux créations simultanées ne dépassent jamais la limite (CA80).
    const { limite } = await assertQuota(tx, { userId, vitrineId }, 'temoignages', now)
    const rows = await listRows(tx, vitrineId)

    const etat = normalizeTemoignageState(EMPTY_STATE, pickState(input))
    assertCoherent(etat)

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

    const item = await loadItem(tx, vitrineId, cree.id)
    if (!item) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
    return versStudioItem([...rows, item], item, limite)
  })
}

export async function createTemoignage(
  userId: string,
  input: TemoignageCreateInput,
  now: Date = new Date(),
): Promise<TemoignageAvecCompteurs> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertTemoignage(userId, input, now)
    } catch (error) {
      const { code, constraint } = readPgError(error)
      if (code === PG_UNIQUE_VIOLATION && constraint === SLUG_UNIQUE && attempt < 2) continue
      throw error
    }
  }
}

async function updateOwnTemoignage(
  userId: string,
  locator: TemoignageLocator,
  patch: TemoignageUpdateInput,
  now: Date,
): Promise<TemoignageAvecCompteurs> {
  const result = await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const limite = await getLimiteStudio(userId, 'temoignages', now, tx)
    const current = rows.find((ligne) => matchesLocator(ligne, locator))
    if (!current) throw new NotFoundError('TEMOINAGE_INTROUVABLE')

    const avant: TemoignageState = { actif: current.actif, enVedette: current.enVedette }
    const etat = normalizeTemoignageState(avant, pickState(patch))
    assertCoherent(etat)

    if (etat.enVedette && !current.enVedette) {
      const autres = rows.filter((ligne) => ligne.id !== current.id && ligne.enVedette)
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
      .where(scopedLocator(vitrineId, locator))

    const item = await loadItem(tx, vitrineId, current.id)
    if (!item) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
    return versStudioItem(rows.map((ligne) => (ligne.id === current.id ? item : ligne)), item, limite)
  })
  return result
}

export function updateTemoignage(
  userId: string,
  id: string,
  patch: TemoignageUpdateInput,
  now: Date = new Date(),
): Promise<TemoignageAvecCompteurs> {
  return updateOwnTemoignage(userId, { kind: 'id', value: id }, patch, now)
}

export function updateTemoignageBySlug(
  userId: string,
  slug: string,
  patch: TemoignageUpdateInput,
  now: Date = new Date(),
): Promise<TemoignageAvecCompteurs> {
  return updateOwnTemoignage(userId, { kind: 'slug', value: slug }, patch, now)
}

async function deleteOwnTemoignage(userId: string, locator: TemoignageLocator): Promise<void> {
  await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const [deleted] = await tx
      .delete(temoignages)
      .where(scopedLocator(vitrineId, locator))
      .returning({ id: temoignages.id })
    if (!deleted) throw new NotFoundError('TEMOINAGE_INTROUVABLE')
  })
}

export function deleteTemoignage(userId: string, id: string): Promise<void> {
  return deleteOwnTemoignage(userId, { kind: 'id', value: id })
}

export function deleteTemoignageBySlug(userId: string, slug: string): Promise<void> {
  return deleteOwnTemoignage(userId, { kind: 'slug', value: slug })
}

/** `ids` doit être une permutation exacte de TOUS les témoignages de la vitrine. */
export async function reorderTemoignages(
  userId: string,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<TemoignagesAvecCompteurs> {
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
    return versStudio(entries, await getLimiteStudio(userId, 'temoignages', now, tx))
  })
}

/** Témoignages actifs ET visibles au regard du plan (les `limite` plus anciens), dans l'ordre d'affichage. */
async function listVisible(vitrineId: string, limite: number | null): Promise<TemoignageRow[]> {
  return selectTemoignages(db)
    .where(and(
      eq(temoignages.vitrineId, vitrineId),
      eq(temoignages.actif, true),
      sqlIdsVisibles(temoignages, vitrineId, limite),
    ))
    .orderBy(...ORDER)
}

/** Témoignages visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : 404. */
export async function getPublicTemoignages(
  rawUsername: string,
  now: Date = new Date(),
): Promise<{ vitrine: VitrineRow; total: number; temoignages: TemoignageRow[] }> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const { limites } = await getPlanPublic(vitrine, now)
  const visibles = await listVisible(vitrine.id, limites.temoignages)
  return {
    vitrine,
    total: visibles.length,
    temoignages: visibles,
  }
}
