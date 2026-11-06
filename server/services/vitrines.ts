import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { disponibilites, liens, medias, realisations, services, temoignages, users, vitrines } from '../../shared/db/schema'
import { USERNAME_CHECK_LIMIT } from '../../shared/limites'
import { isReserved } from '../../shared/reserved'
import type { UsernameChangeInput, VitrineCreateInput, VitrineUpdateInput } from '../../shared/schemas/vitrine'
import { NEXT_STEPS } from '../../shared/vitrine'
import type { NextStep, PublicationField } from '../../shared/vitrine'
import { ConflictError, NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { hasValidUsernameFormat, normalizeUsername } from '../utils/username'
import { enforceLimit } from './limiteur'
import { deleteMediaIfUnreferenced } from './medias'
import type { MediaRow } from './medias'
import { getPlanPublic, sqlIdsVisibles } from './plan-visibilite'
import { getTotaux7J } from './statistiques'
import { computeMissingForPublication, computeNextStep } from './vitrines-regles'

export { computeMissingForPublication, computeNextStep } from './vitrines-regles'

export type VitrineRow = typeof vitrines.$inferSelect

/** Une vitrine et sa photo (jointure gauche sur `medias`). */
export interface VitrineAvecPhoto {
  vitrine: VitrineRow
  photo: MediaRow | null
}

export interface StudioSummary {
  compteurs: { services: number, realisations: number, temoignages: number, liens: number }
  prochaineEtape: NextStep | null
  manquants: PublicationField[]
  /** S11 #185 : visites/clics/réservations des 7 derniers jours (accueil du studio). */
  statistiques7j: { visites: number, clics: number, reservations: number }
}

export interface StudioView {
  vitrine: VitrineAvecPhoto
  resume: StudioSummary
}

export type UsernameReason = 'libre' | 'actuel' | 'pris' | 'reserve' | 'format'

export interface UsernameAvailability {
  username: string
  disponible: boolean
  raison: UsernameReason
}

const USERNAME_UNIQUE = 'vitrines_username_unique'
const USER_ID_UNIQUE = 'vitrines_user_id_unique'
const PHOTO_FK = 'vitrines_photo_media_id_medias_id_fk'

function selectWithPhoto() {
  return db
    .select({ vitrine: vitrines, photo: medias })
    .from(vitrines)
    .leftJoin(medias, eq(vitrines.photoMediaId, medias.id))
}

async function requireOwn(userId: string): Promise<VitrineAvecPhoto> {
  const [row] = await selectWithPhoto().where(eq(vitrines.userId, userId)).limit(1)
  if (!row) throw new NotFoundError('VITRINE_INTROUVABLE')
  return row
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

/** Traduit les violations d'unicité en erreurs métier ; toute autre erreur est relancée telle quelle. */
function rethrowUniqueViolation(error: unknown): never {
  const { code, constraint } = readPgError(error)
  if (code === PG_UNIQUE_VIOLATION) {
    if (constraint === USER_ID_UNIQUE) throw new ConflictError('VITRINE_EXISTE')
    if (constraint === USERNAME_UNIQUE) throw new ConflictError('USERNAME_PRIS')
  }
  throw error
}

export async function createVitrine(userId: string, input: VitrineCreateInput): Promise<VitrineAvecPhoto> {
  try {
    const [vitrine] = await db
      .insert(vitrines)
      .values({
        id: randomUUID(),
        userId,
        username: input.username,
        titre: input.titre,
        prenom: input.prenom,
        nom: input.nom,
        metier: input.metier,
        // Le fuseau du compte devient celui de la vitrine (modifiable ensuite via /moi).
        fuseau: sql<string>`(select ${users.fuseau} from ${users} where ${users.id} = ${userId})`,
      })
      .returning()
    if (!vitrine) throw new Error('Insertion de la vitrine sans résultat.')
    return { vitrine, photo: null }
  } catch (error) {
    return rethrowUniqueViolation(error)
  }
}

export async function getOwnVitrine(userId: string): Promise<VitrineAvecPhoto> {
  return requireOwn(userId)
}

export async function updateVitrine(userId: string, patch: VitrineUpdateInput): Promise<VitrineAvecPhoto> {
  const changes = stripUndefined(patch)
  let previousPhotoId: string | null
  try {
    previousPhotoId = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(vitrines).where(eq(vitrines.userId, userId)).for('update')
      if (!current) throw new NotFoundError('VITRINE_INTROUVABLE')

      if (changes.photoMediaId) {
        const [owned] = await tx
          .select({ id: medias.id })
          .from(medias)
          .where(and(eq(medias.id, changes.photoMediaId), eq(medias.userId, userId)))
          .limit(1)
        if (!owned) throw new UnprocessableError('MEDIA_INVALIDE')
      }

      // Une vitrine publiée doit rester publiable : sinon la page publique afficherait des trous.
      if (current.publieeLe) {
        const manquants = computeMissingForPublication({ ...current, ...changes })
        if (manquants.length > 0) throw new UnprocessableError('PUBLICATION_INCOMPLETE', { manquants })
      }

      await tx.update(vitrines).set({ ...changes, updatedAt: new Date() }).where(eq(vitrines.id, current.id))
      return current.photoMediaId
    })
  } catch (error) {
    const { code, constraint } = readPgError(error)
    if (code === PG_FOREIGN_KEY_VIOLATION && constraint === PHOTO_FK) throw new UnprocessableError('MEDIA_INVALIDE')
    throw error
  }

  // Après le commit : l'ancienne photo disparaît si plus rien ne la référence. Un échec ici
  // laisse un orphelin (nettoyé plus tard), il ne doit pas faire échouer la modification.
  if (changes.photoMediaId !== undefined && previousPhotoId && previousPhotoId !== changes.photoMediaId) {
    await deleteMediaIfUnreferenced(userId, previousPhotoId).catch((error: unknown) => {
      console.error({ vitrines: 'ancienne photo non supprimée', nom: error instanceof Error ? error.name : typeof error })
    })
  }
  return requireOwn(userId)
}

export async function changeUsername(userId: string, username: UsernameChangeInput['username']): Promise<VitrineAvecPhoto> {
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: vitrines.id, username: vitrines.username })
        .from(vitrines)
        .where(eq(vitrines.userId, userId))
        .for('update')
      if (!current) throw new NotFoundError('VITRINE_INTROUVABLE')
      await tx.update(vitrines).set({ username, updatedAt: new Date() }).where(eq(vitrines.id, current.id))
      // S6 : les liens internes (type vitrine) pointent `/<username>` ; réécrits dans la même
      // transaction, sinon ils mènent à l'ancienne adresse.
      if (current.username !== username) {
        await tx.execute(sql`
          UPDATE liens SET url = ${'/' + username} || substring(url from ${current.username.length + 2}), updated_at = now()
          WHERE vitrine_id = ${current.id} AND type = 'vitrine'
            AND (url = ${'/' + current.username} OR url LIKE ${'/' + current.username + '/%'})
        `)
      }
    })
  } catch (error) {
    rethrowUniqueViolation(error)
  }
  return requireOwn(userId)
}

/** Publie (idempotent : `publiee_le` ne bouge pas si la vitrine l'est déjà). */
export async function publishVitrine(userId: string): Promise<VitrineAvecPhoto> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(vitrines).where(eq(vitrines.userId, userId)).for('update')
    if (!current) throw new NotFoundError('VITRINE_INTROUVABLE')
    const manquants = computeMissingForPublication(current)
    if (manquants.length > 0) throw new UnprocessableError('PUBLICATION_INCOMPLETE', { manquants })
    await tx
      .update(vitrines)
      .set({ publieeLe: sql`COALESCE(${vitrines.publieeLe}, now())`, updatedAt: new Date() })
      .where(eq(vitrines.id, current.id))
  })
  return requireOwn(userId)
}

export async function unpublishVitrine(userId: string): Promise<VitrineAvecPhoto> {
  const updated = await db
    .update(vitrines)
    .set({ publieeLe: null, updatedAt: new Date() })
    .where(eq(vitrines.userId, userId))
    .returning({ id: vitrines.id })
  if (updated.length === 0) throw new NotFoundError('VITRINE_INTROUVABLE')
  return requireOwn(userId)
}

/** Étapes mémorisées en base, rétrécies au type `NextStep` (la CHECK de la base garantit les valeurs). */
function asIgnoredSteps(values: readonly string[]): NextStep[] {
  return NEXT_STEPS.filter((etape) => values.includes(etape))
}

interface StepCounts {
  services: number
  realisations: number
  disponibilites: number
}

function stepOf({ vitrine, photo }: VitrineAvecPhoto, counts: StepCounts): NextStep | null {
  return computeNextStep({
    hasPhoto: photo !== null,
    servicesActifs: counts.services,
    disponibilites: counts.disponibilites,
    realisationsActives: counts.realisations,
    publiee: vitrine.publieeLe !== null,
    partagee: vitrine.partageeLe !== null,
    ignorees: asIgnoredSteps(vitrine.etapesIgnorees),
  })
}

async function summarize(row: VitrineAvecPhoto): Promise<StudioSummary> {
  const { vitrine } = row
  const actifs = (table: typeof services | typeof realisations | typeof temoignages | typeof liens) =>
    db.$count(table, and(eq(table.vitrineId, vitrine.id), eq(table.actif, true)))
  const [nbServices, nbRealisations, nbTemoignages, nbLiens, nbDisponibilites, statistiques7j] = await Promise.all([
    actifs(services),
    actifs(realisations),
    actifs(temoignages),
    actifs(liens),
    db.$count(disponibilites, eq(disponibilites.vitrineId, vitrine.id)),
    getTotaux7J(vitrine.userId),
  ])
  return {
    compteurs: { services: nbServices, realisations: nbRealisations, temoignages: nbTemoignages, liens: nbLiens },
    prochaineEtape: stepOf(row, { services: nbServices, realisations: nbRealisations, disponibilites: nbDisponibilites }),
    manquants: computeMissingForPublication(vitrine),
    statistiques7j,
  }
}

/** Prochaine étape de l'utilisateur (trois comptes seulement, pas le résumé complet). */
export async function getNextStepForUser(userId: string): Promise<NextStep | null> {
  const row = await requireOwn(userId)
  const vitrineId = row.vitrine.id
  const [nbServices, nbRealisations, nbDisponibilites] = await Promise.all([
    db.$count(services, and(eq(services.vitrineId, vitrineId), eq(services.actif, true))),
    db.$count(realisations, and(eq(realisations.vitrineId, vitrineId), eq(realisations.actif, true))),
    db.$count(disponibilites, eq(disponibilites.vitrineId, vitrineId)),
  ])
  return stepOf(row, { services: nbServices, realisations: nbRealisations, disponibilites: nbDisponibilites })
}

export async function getNextStep(userId: string): Promise<NextStep | null> {
  return getNextStepForUser(userId)
}

/** Mémorise « ignorer » pour toujours (ajout idempotent) et renvoie l'étape suivante. */
export async function ignoreNextStep(userId: string, etape: NextStep): Promise<NextStep | null> {
  const updated = await db
    .update(vitrines)
    .set({
      etapesIgnorees: sql`CASE WHEN ${etape}::text = ANY(${vitrines.etapesIgnorees}) THEN ${vitrines.etapesIgnorees} ELSE array_append(${vitrines.etapesIgnorees}, ${etape}::text) END`,
    })
    .where(eq(vitrines.userId, userId))
    .returning({ id: vitrines.id })
  if (updated.length === 0) throw new NotFoundError('VITRINE_INTROUVABLE')
  return getNextStepForUser(userId)
}

/** Marque la vitrine comme partagée (idempotent : la première date est conservée). */
export async function markShared(userId: string, now: Date = new Date()): Promise<Date> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(vitrines).where(eq(vitrines.userId, userId)).for('update')
    if (!current) throw new NotFoundError('VITRINE_INTROUVABLE')
    if (current.publieeLe === null) throw new UnprocessableError('VITRINE_NON_PUBLIEE')
    const [updated] = await tx
      .update(vitrines)
      .set({ partageeLe: sql`COALESCE(${vitrines.partageeLe}, ${now.toISOString()}::timestamptz)` })
      .where(eq(vitrines.id, current.id))
      .returning({ partageeLe: vitrines.partageeLe })
    if (!updated?.partageeLe) throw new Error('Partage de la vitrine sans résultat.')
    return updated.partageeLe
  })
}

export async function getStudioSummary(userId: string): Promise<StudioSummary> {
  return summarize(await requireOwn(userId))
}

/** Vitrine du studio et son résumé, en une seule lecture de la vitrine. */
export async function getStudioView(userId: string): Promise<StudioView> {
  const vitrine = await requireOwn(userId)
  return { vitrine, resume: await summarize(vitrine) }
}

/** Vitrine publiée d'un username. Format invalide : introuvable, sans requête. */
export async function getPublicVitrine(rawUsername: string): Promise<VitrineAvecPhoto> {
  const username = normalizeUsername(rawUsername)
  if (!hasValidUsernameFormat(username)) throw new NotFoundError('VITRINE_INTROUVABLE')
  const [row] = await selectWithPhoto()
    .where(and(eq(vitrines.username, username), isNotNull(vitrines.publieeLe)))
    .limit(1)
  if (!row) throw new NotFoundError('VITRINE_INTROUVABLE')
  return row
}

/** Éléments visibles (`actif`) par liste et présence d'un agenda public : navigation (R10). */
export type ContenusPublics = { services: number, realisations: number, agenda: boolean }

export interface VitrinePage {
  vitrine: VitrineAvecPhoto
  contenus: ContenusPublics
  /** S10 : badge « Créé avec Brandself » (plan gratuit). Jamais le statut d'abonnement lui-même. */
  badgeBrandself: boolean
}

/**
 * Vitrine publiée plus les compteurs de contenus visibles. Deux requêtes de plus que `getPublicVitrine` : le plan
 * du propriétaire, puis les deux sous-comptes et le drapeau agenda dans un seul SELECT.
 * S10 : les compteurs et l'agenda ne comptent que les éléments que le plan laisse visibles (plan-visibilite.ts).
 * L'agenda est proposé dès qu'une disponibilité existe ET qu'au moins un service reservable
 * actif et visible de type rdv/accompagnement : c'est la condition d'affichage de la section agenda.
 */
export async function getPublicVitrinePage(rawUsername: string, now: Date = new Date()): Promise<VitrinePage> {
  const vitrine = await getPublicVitrine(rawUsername)
  const vitrineId = vitrine.vitrine.id
  const { limites, badge } = await getPlanPublic(vitrine.vitrine, now)
  const servicesVisibles = sqlIdsVisibles(services, vitrineId, limites.services)
  const realisationsVisibles = sqlIdsVisibles(realisations, vitrineId, limites.realisations)
  const { rows } = await db.execute<ContenusPublics>(sql`
    SELECT
      (SELECT count(*) FROM ${services} WHERE ${services.vitrineId} = ${vitrineId} AND ${services.actif} AND ${servicesVisibles})::int AS services,
      (SELECT count(*) FROM ${realisations} WHERE ${realisations.vitrineId} = ${vitrineId} AND ${realisations.actif} AND ${realisationsVisibles})::int AS realisations,
      (
        EXISTS (SELECT 1 FROM ${disponibilites} WHERE ${disponibilites.vitrineId} = ${vitrineId})
        AND EXISTS (
          SELECT 1 FROM ${services}
          WHERE ${services.vitrineId} = ${vitrineId}
            AND ${services.actif}
            AND ${services.reservable}
            AND ${services.type} IN ('rdv', 'accompagnement')
            AND ${servicesVisibles}
        )
      ) AS agenda
  `)
  return { vitrine, contenus: rows[0] ?? { services: 0, realisations: 0, agenda: false }, badgeBrandself: badge }
}

export async function checkUsernameAvailability(userId: string, rawUsername: string): Promise<UsernameAvailability> {
  await enforceLimit(`username-check:${userId}`, USERNAME_CHECK_LIMIT.limit, USERNAME_CHECK_LIMIT.windowS)
  const username = normalizeUsername(rawUsername)
  if (!hasValidUsernameFormat(username)) return { username, disponible: false, raison: 'format' }
  if (isReserved(username)) return { username, disponible: false, raison: 'reserve' }
  const [owner] = await db
    .select({ userId: vitrines.userId })
    .from(vitrines)
    .where(eq(vitrines.username, username))
    .limit(1)
  if (!owner) return { username, disponible: true, raison: 'libre' }
  if (owner.userId === userId) return { username, disponible: true, raison: 'actuel' }
  return { username, disponible: false, raison: 'pris' }
}
