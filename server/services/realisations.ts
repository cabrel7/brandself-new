import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { medias, realisationImages, realisations } from '../../shared/db/schema'
import { LISTE_SLUG_MAX, LISTE_SLUG_REGEX, VEDETTE_MAX } from '../../shared/listes'
import { AUTRES_REALISATIONS_MAX } from '../../shared/realisations'
import type { RealisationCreateInput, RealisationUpdateInput } from '../../shared/schemas/realisation'
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { computeALaUne, computeCompteurs, pickAvailableSlug, resolveEnVedette } from './listes-regles'
import type { MediaRow } from './medias'
import { getLimiteStudio, getPlanPublic, marquerMasque, sqlIdsVisibles, vuePlanStudio } from './plan-visibilite'
import type { CompteursAvecPlan } from './plan-visibilite'
import { assertQuota } from './plans'
import { checkRealisationCoherence, mediasARetirer, normalizeRealisationState, slugFromTitreRealisation } from './realisations-regles'
import type { RealisationState } from './realisations-regles'
import { cleanupMedias, lockVitrineId, requireOwnedMedias, requireVitrineId } from './vitrine-acces'
import type { Executor, Transaction } from './vitrine-acces'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type RealisationRow = typeof realisations.$inferSelect
export type RealisationImageRow = typeof realisationImages.$inferSelect
export type { Compteurs } from './listes-regles'

/** Une réalisation et son image principale (jointure gauche sur `medias`). */
export interface RealisationAvecImage {
  realisation: RealisationRow
  image: MediaRow | null
}

/** Idem, avec la galerie dans l'ordre d'affichage. */
export interface RealisationAvecMedias extends RealisationAvecImage {
  galerie: MediaRow[]
}

/** Ligne du studio : `masqueParPlan` = active mais au-delà de la limite du plan (S10 #127). */
export type RealisationStudioRow = RealisationRow & { masqueParPlan: boolean }

export interface RealisationStudioAvecMedias {
  realisation: RealisationStudioRow
  image: MediaRow | null
  galerie: MediaRow[]
}

export interface RealisationAvecCompteurs {
  item: RealisationStudioAvecMedias
  compteurs: CompteursAvecPlan
}

export interface RealisationsAvecCompteurs {
  items: RealisationStudioAvecMedias[]
  compteurs: CompteursAvecPlan
}

export interface RealisationsPubliques {
  vitrine: VitrineRow
  total: number
  aLaUne: RealisationAvecImage[]
  realisations: RealisationAvecImage[]
}

export interface RealisationPublique {
  vitrine: VitrineRow
  item: RealisationAvecMedias
  autres: RealisationAvecImage[]
  total: number
}

const SLUG_UNIQUE = 'realisations_vitrine_id_slug_unique'
const IMAGE_FKS: readonly string[] = [
  'realisations_image_media_id_medias_id_fk',
  'realisation_images_media_id_medias_id_fk',
]
const SLUG_ATTEMPTS = 2
const LOG_CONTEXTE = 'realisations'

const ORDER = [asc(realisations.ordre), asc(realisations.createdAt), asc(realisations.id)] as const

/** Point de départ d'une création : le corps validé (défauts appliqués) est fusionné par-dessus. */
const EMPTY_STATE: RealisationState = { imageMediaId: null, galerie: [], actif: true, enVedette: false }

function selectWithImage(executor: Executor) {
  return executor
    .select({ realisation: realisations, image: medias })
    .from(realisations)
    .leftJoin(medias, eq(realisations.imageMediaId, medias.id))
}

async function listRows(executor: Executor, vitrineId: string): Promise<RealisationRow[]> {
  return executor.select().from(realisations).where(eq(realisations.vitrineId, vitrineId)).orderBy(...ORDER)
}

async function listWithImages(executor: Executor, vitrineId: string): Promise<RealisationAvecImage[]> {
  return selectWithImage(executor).where(eq(realisations.vitrineId, vitrineId)).orderBy(...ORDER)
}

/** Les galeries de plusieurs réalisations en UNE requête (jamais de N+1), chacune dans l'ordre d'affichage. */
async function loadGaleries(executor: Executor, ids: readonly string[]): Promise<Map<string, MediaRow[]>> {
  const galeries = new Map<string, MediaRow[]>()
  if (ids.length === 0) return galeries
  const lignes = await executor
    .select({ realisationId: realisationImages.realisationId, media: medias })
    .from(realisationImages)
    .innerJoin(medias, eq(realisationImages.mediaId, medias.id))
    .where(inArray(realisationImages.realisationId, [...ids]))
    .orderBy(asc(realisationImages.realisationId), asc(realisationImages.ordre))
  for (const { realisationId, media } of lignes) {
    galeries.set(realisationId, [...(galeries.get(realisationId) ?? []), media])
  }
  return galeries
}

async function withGaleries(executor: Executor, items: readonly RealisationAvecImage[]): Promise<RealisationAvecMedias[]> {
  const galeries = await loadGaleries(executor, items.map((entry) => entry.realisation.id))
  return items.map((entry) => ({ ...entry, galerie: galeries.get(entry.realisation.id) ?? [] }))
}

async function loadItem(executor: Executor, id: string): Promise<RealisationAvecMedias | undefined> {
  const [entry] = await selectWithImage(executor).where(eq(realisations.id, id))
  if (!entry) return undefined
  const [item] = await withGaleries(executor, [entry])
  return item
}

/** Identifiants de médias de la galerie d'une réalisation, dans l'ordre d'affichage. */
async function galerieIds(executor: Executor, realisationId: string): Promise<string[]> {
  const lignes = await executor
    .select({ mediaId: realisationImages.mediaId })
    .from(realisationImages)
    .where(eq(realisationImages.realisationId, realisationId))
    .orderBy(asc(realisationImages.ordre))
  return lignes.map((ligne) => ligne.mediaId)
}

/** Remplace toute la galerie : l'ordre du tableau devient `ordre` 0..n-1 (DELETE puis INSERT, sous le verrou vitrine). */
async function replaceGalerie(tx: Transaction, realisationId: string, ids: readonly string[]): Promise<void> {
  await tx.delete(realisationImages).where(eq(realisationImages.realisationId, realisationId))
  if (ids.length === 0) return
  await tx.insert(realisationImages).values(
    ids.map((mediaId, ordre) => ({ id: randomUUID(), realisationId, mediaId, ordre })),
  )
}

function pickState(patch: RealisationUpdateInput | RealisationCreateInput): Partial<RealisationState> {
  return {
    imageMediaId: patch.imageMediaId,
    galerie: patch.galerie,
    actif: patch.actif,
    enVedette: patch.enVedette,
  }
}

function orKeep<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value
}

function assertCoherent(etat: RealisationState): void {
  const erreurs = checkRealisationCoherence(etat)
  if (Object.keys(erreurs).length > 0) throw new ValidationError(erreurs)
}

function vedetteComplete(vedettes: readonly RealisationRow[]): ConflictError {
  return new ConflictError('VEDETTE_COMPLETE', {
    enVedette: vedettes.map((ligne) => ({ id: ligne.id, titre: ligne.titre })),
  })
}

function isMediaForeignKey(error: unknown): boolean {
  const { code, constraint } = readPgError(error)
  return code === PG_FOREIGN_KEY_VIOLATION && constraint !== undefined && IMAGE_FKS.includes(constraint)
}

/**
 * Vue du studio sur la liste COMPLÈTE de la vitrine : chaque ligne porte `masqueParPlan`, les compteurs portent
 * `limitePlan` (usage = toutes les lignes, visibles ou non, comme le quota de création).
 */
function versStudio(items: readonly RealisationAvecMedias[], limite: number | null): RealisationsAvecCompteurs {
  const lignes = items.map((entry) => entry.realisation)
  const vue = vuePlanStudio(lignes, limite)
  return {
    items: items.map((entry) => ({ ...entry, realisation: marquerMasque(entry.realisation, vue.masques) })),
    compteurs: { ...computeCompteurs(lignes, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

/** Même vue, centrée sur une réalisation `cible` de `lignes` (la liste complète après l'écriture). */
function versStudioItem(
  lignes: readonly RealisationRow[],
  cible: RealisationAvecMedias,
  limite: number | null,
): RealisationAvecCompteurs {
  const vue = vuePlanStudio(lignes, limite)
  return {
    item: { ...cible, realisation: marquerMasque(cible.realisation, vue.masques) },
    compteurs: { ...computeCompteurs(lignes, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

export async function listOwnRealisations(userId: string, now: Date = new Date()): Promise<RealisationsAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [entries, limite] = await Promise.all([
    listWithImages(db, vitrineId),
    getLimiteStudio(userId, 'realisations', now),
  ])
  return versStudio(await withGaleries(db, entries), limite)
}

export async function getOwnRealisation(userId: string, id: string, now: Date = new Date()): Promise<RealisationAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [entries, limite] = await Promise.all([
    listWithImages(db, vitrineId),
    getLimiteStudio(userId, 'realisations', now),
  ])
  const entry = entries.find((candidate) => candidate.realisation.id === id)
  if (!entry) throw new NotFoundError('REALISATION_INTROUVABLE')
  const [item] = await withGaleries(db, [entry])
  if (!item) throw new NotFoundError('REALISATION_INTROUVABLE')
  return versStudioItem(entries.map((candidate) => candidate.realisation), item, limite)
}

async function insertRealisation(
  userId: string,
  input: RealisationCreateInput,
  now: Date,
): Promise<RealisationAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    // Quota sous le verrou vitrine : deux créations simultanées ne dépassent jamais la limite (CA80).
    const { limite } = await assertQuota(tx, { userId, vitrineId }, 'realisations', now)
    const rows = await listRows(tx, vitrineId)

    const etat = normalizeRealisationState(EMPTY_STATE, pickState(input))
    assertCoherent(etat)
    await requireOwnedMedias(tx, userId, [input.imageMediaId, ...input.galerie])

    const vedettes = rows.filter((ligne) => ligne.enVedette)
    const enVedette = resolveEnVedette({
      demande: input.enVedette,
      actif: etat.actif,
      autresEnVedette: vedettes.length,
      max: VEDETTE_MAX,
    })
    if (enVedette === 'COMPLET') throw vedetteComplete(vedettes)

    const slug = pickAvailableSlug(slugFromTitreRealisation(input.titre), new Set(rows.map((ligne) => ligne.slug)), LISTE_SLUG_MAX)
    const [created] = await tx
      .insert(realisations)
      .values({
        id: randomUUID(),
        vitrineId,
        slug,
        titre: input.titre,
        description: input.description,
        imageMediaId: input.imageMediaId,
        annee: input.annee,
        lieu: input.lieu,
        role: input.role,
        lien: input.lien,
        enVedette,
        ordre: rows.reduce((max, ligne) => Math.max(max, ligne.ordre + 1), 0),
        actif: etat.actif,
      })
      .returning({ id: realisations.id })
    if (!created) throw new Error('Insertion de la réalisation sans résultat.')
    await replaceGalerie(tx, created.id, input.galerie)

    const item = await loadItem(tx, created.id)
    if (!item) throw new Error('Réalisation créée introuvable.')
    return versStudioItem([...rows, item.realisation], item, limite)
  })
}

export async function createRealisation(
  userId: string,
  input: RealisationCreateInput,
  now: Date = new Date(),
): Promise<RealisationAvecCompteurs> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertRealisation(userId, input, now)
    } catch (error) {
      const { code, constraint } = readPgError(error)
      // Collision de slug (insertion hors verrou) : une nouvelle tentative relit les slugs existants.
      if (code === PG_UNIQUE_VIOLATION && constraint === SLUG_UNIQUE && attempt < SLUG_ATTEMPTS) continue
      if (isMediaForeignKey(error)) throw new UnprocessableError('MEDIA_INVALIDE')
      throw error
    }
  }
}

export async function updateRealisation(
  userId: string,
  id: string,
  patch: RealisationUpdateInput,
  now: Date = new Date(),
): Promise<RealisationAvecCompteurs> {
  let result: RealisationAvecCompteurs
  let retires: string[]
  try {
    ;({ result, retires } = await db.transaction(async (tx) => {
      const vitrineId = await lockVitrineId(tx, userId)
      const rows = await listRows(tx, vitrineId)
      const limite = await getLimiteStudio(userId, 'realisations', now, tx)
      const current = rows.find((ligne) => ligne.id === id)
      if (!current) throw new NotFoundError('REALISATION_INTROUVABLE')

      const avant: RealisationState = {
        imageMediaId: current.imageMediaId,
        galerie: await galerieIds(tx, id),
        actif: current.actif,
        enVedette: current.enVedette,
      }
      // Cohérence évaluée sur l'état fusionné (base + modification), pas sur le seul corps.
      const etat = normalizeRealisationState(avant, pickState(patch))
      assertCoherent(etat)

      // Propriété vérifiée sur les seuls identifiants NOUVEAUX (les autres appartiennent déjà à l'utilisateur).
      const connus = new Set<string>(avant.galerie)
      if (avant.imageMediaId !== null) connus.add(avant.imageMediaId)
      const nouveaux = [etat.imageMediaId, ...etat.galerie].filter((media): media is string => media !== null && !connus.has(media))
      await requireOwnedMedias(tx, userId, nouveaux)

      if (etat.enVedette && !current.enVedette) {
        const autres = rows.filter((ligne) => ligne.id !== id && ligne.enVedette)
        const decision = resolveEnVedette({ demande: true, actif: etat.actif, autresEnVedette: autres.length, max: VEDETTE_MAX })
        if (decision === 'COMPLET') throw vedetteComplete(autres)
      }

      await tx
        .update(realisations)
        .set({
          titre: orKeep(patch.titre, current.titre),
          description: orKeep(patch.description, current.description),
          imageMediaId: etat.imageMediaId,
          annee: orKeep(patch.annee, current.annee),
          lieu: orKeep(patch.lieu, current.lieu),
          role: orKeep(patch.role, current.role),
          lien: orKeep(patch.lien, current.lien),
          enVedette: etat.enVedette,
          actif: etat.actif,
          updatedAt: new Date(),
        })
        .where(and(eq(realisations.id, id), eq(realisations.vitrineId, vitrineId)))
      if (patch.galerie !== undefined) await replaceGalerie(tx, id, etat.galerie)

      const item = await loadItem(tx, id)
      if (!item) throw new NotFoundError('REALISATION_INTROUVABLE')
      const lignes = rows.map((ligne) => (ligne.id === id ? item.realisation : ligne))
      return { result: versStudioItem(lignes, item, limite), retires: mediasARetirer(avant, etat) }
    }))
  } catch (error) {
    if (isMediaForeignKey(error)) throw new UnprocessableError('MEDIA_INVALIDE')
    throw error
  }

  // Après le commit : les médias retirés disparaissent si plus rien ne les référence.
  await cleanupMedias(userId, retires, LOG_CONTEXTE)
  return result
}

export async function deleteRealisation(userId: string, id: string): Promise<void> {
  const retires = await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const [existante] = await tx
      .select({ id: realisations.id })
      .from(realisations)
      .where(and(eq(realisations.id, id), eq(realisations.vitrineId, vitrineId)))
    if (!existante) throw new NotFoundError('REALISATION_INTROUVABLE')
    // Lue AVANT la suppression : les lignes de galerie disparaissent en cascade avec la réalisation.
    const galerie = await galerieIds(tx, id)
    const [deleted] = await tx
      .delete(realisations)
      .where(and(eq(realisations.id, id), eq(realisations.vitrineId, vitrineId)))
      .returning({ imageMediaId: realisations.imageMediaId })
    if (!deleted) throw new NotFoundError('REALISATION_INTROUVABLE')
    return mediasARetirer({ imageMediaId: deleted.imageMediaId, galerie }, { imageMediaId: null, galerie: [] })
  })
  await cleanupMedias(userId, retires, LOG_CONTEXTE)
}

/** `ids` doit être une permutation exacte de TOUTES les réalisations de la vitrine. */
export async function reorderRealisations(
  userId: string,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<RealisationsAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const known = new Set(rows.map((ligne) => ligne.id))
    const complete = ids.length === known.size && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
    if (!complete) throw new UnprocessableError('ORDRE_INVALIDE')

    if (ids.length > 0) {
      const liste = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await tx.execute(sql`
        UPDATE realisations AS r SET ordre = v.rang - 1
        FROM unnest(ARRAY[${liste}]::text[]) WITH ORDINALITY AS v(id, rang)
        WHERE r.id = v.id AND r.vitrine_id = ${vitrineId}
      `)
    }
    const entries = await listWithImages(tx, vitrineId)
    return versStudio(await withGaleries(tx, entries), await getLimiteStudio(userId, 'realisations', now, tx))
  })
}

/** Réalisations actives ET visibles au regard du plan (les `limite` plus anciennes), dans l'ordre d'affichage. */
async function listVisible(vitrineId: string, limite: number | null): Promise<RealisationAvecImage[]> {
  return selectWithImage(db)
    .where(and(
      eq(realisations.vitrineId, vitrineId),
      eq(realisations.actif, true),
      sqlIdsVisibles(realisations, vitrineId, limite),
    ))
    .orderBy(...ORDER)
}

/** Réalisations visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : VITRINE_INTROUVABLE. */
export async function getPublicRealisations(rawUsername: string, now: Date = new Date()): Promise<RealisationsPubliques> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const { limites } = await getPlanPublic(vitrine, now)
  const visibles = await listVisible(vitrine.id, limites.realisations)
  const retenues = new Set(computeALaUne(visibles.map((entry) => entry.realisation), VEDETTE_MAX))
  return {
    vitrine,
    total: visibles.length,
    aLaUne: visibles.filter((entry) => retenues.has(entry.realisation)),
    realisations: visibles,
  }
}

/** Détail d'une réalisation visible. Slug mal formé, masqué ou d'une autre vitrine : REALISATION_INTROUVABLE. */
export async function getPublicRealisation(
  rawUsername: string,
  rawSlug: string,
  now: Date = new Date(),
): Promise<RealisationPublique> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const slug = rawSlug.trim().toLowerCase()
  if (slug.length > LISTE_SLUG_MAX || !LISTE_SLUG_REGEX.test(slug)) throw new NotFoundError('REALISATION_INTROUVABLE')
  const { limites } = await getPlanPublic(vitrine, now)
  const visibles = await listVisible(vitrine.id, limites.realisations)
  const entry = visibles.find((candidate) => candidate.realisation.slug === slug)
  if (!entry) throw new NotFoundError('REALISATION_INTROUVABLE')
  const [item] = await withGaleries(db, [entry])
  if (!item) throw new NotFoundError('REALISATION_INTROUVABLE')
  return {
    vitrine,
    item,
    autres: visibles.filter((candidate) => candidate !== entry).slice(0, AUTRES_REALISATIONS_MAX),
    total: visibles.length,
  }
}
