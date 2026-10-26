import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { env } from '../../shared/env'
import { medias, services, vitrines } from '../../shared/db/schema'
import type { ServiceCreateInput, ServiceUpdateInput } from '../../shared/schemas/service'
import { AUTRES_SERVICES_MAX, SERVICE_SLUG_MAX, SERVICE_SLUG_REGEX, VEDETTE_MAX } from '../../shared/services'
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { deleteMediaIfUnreferenced } from './medias'
import type { MediaRow } from './medias'
import {
  checkServiceCoherence,
  computeALaUne,
  computeCompteurs,
  normalizeServiceState,
  pickAvailableSlug,
  resolveEnVedette,
  slugFromTitle,
} from './services-regles'
import type { Compteurs, ServiceState } from './services-regles'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type ServiceRow = typeof services.$inferSelect
export type { Compteurs } from './services-regles'

/** Un service et son image (jointure gauche sur `medias`). */
export interface ServiceAvecImage {
  service: ServiceRow
  image: MediaRow | null
}

export interface ServiceAvecCompteurs {
  item: ServiceAvecImage
  compteurs: Compteurs
}

export interface ServicesAvecCompteurs {
  items: ServiceAvecImage[]
  compteurs: Compteurs
}

export interface OptionsService {
  paiementEnLigne: boolean
}

export interface ServicesPublics {
  vitrine: VitrineRow
  total: number
  aLaUne: ServiceAvecImage[]
  services: ServiceAvecImage[]
}

export interface ServicePublic {
  vitrine: VitrineRow
  item: ServiceAvecImage
  autres: ServiceAvecImage[]
  total: number
}

const SLUG_UNIQUE = 'services_vitrine_id_slug_unique'
const IMAGE_FK = 'services_image_media_id_medias_id_fk'
const SLUG_ATTEMPTS = 2
const PAIEMENTS_EN_LIGNE: readonly string[] = ['en_ligne', 'au_choix']

type Executor = Pick<typeof db, 'select'>
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Options par défaut : le drapeau vient de la configuration validée (`shared/env.ts`), jamais de `process.env`. */
export function resolveServiceOptions(): OptionsService {
  return { paiementEnLigne: env.PAIEMENT_EN_LIGNE }
}

function selectWithImage(executor: Executor) {
  return executor
    .select({ service: services, image: medias })
    .from(services)
    .leftJoin(medias, eq(services.imageMediaId, medias.id))
}

const ORDER = [asc(services.ordre), asc(services.createdAt), asc(services.id)] as const

async function requireVitrineId(userId: string): Promise<string> {
  const [vitrine] = await db.select({ id: vitrines.id }).from(vitrines).where(eq(vitrines.userId, userId)).limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine.id
}

/** Verrou sur la ligne vitrine : sérialise vedette, slug et ordre des écritures concurrentes. */
async function lockVitrineId(tx: Transaction, userId: string): Promise<string> {
  const [vitrine] = await tx
    .select({ id: vitrines.id })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .for('update')
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine.id
}

async function listRows(executor: Executor, vitrineId: string): Promise<ServiceRow[]> {
  return executor
    .select()
    .from(services)
    .where(eq(services.vitrineId, vitrineId))
    .orderBy(...ORDER)
}

async function listWithImages(executor: Executor, vitrineId: string): Promise<ServiceAvecImage[]> {
  return selectWithImage(executor)
    .where(eq(services.vitrineId, vitrineId))
    .orderBy(...ORDER)
}

async function requireOwnedMedia(tx: Transaction, userId: string, mediaId: string): Promise<void> {
  const [owned] = await tx
    .select({ id: medias.id })
    .from(medias)
    .where(and(eq(medias.id, mediaId), eq(medias.userId, userId)))
    .limit(1)
  if (!owned) throw new UnprocessableError('MEDIA_INVALIDE')
}

function toState(row: ServiceRow): ServiceState {
  return {
    type: row.type,
    nbSeances: row.nbSeances,
    rythme: row.rythme,
    dureeMin: row.dureeMin,
    tarif: row.tarif,
    prixMontant: row.prixMontant,
    prixDevise: row.prixDevise,
    paiementMode: row.paiementMode,
    paiementInstructions: row.paiementInstructions,
    actif: row.actif,
    enVedette: row.enVedette,
  }
}

function pickState(patch: ServiceUpdateInput | ServiceCreateInput): Partial<ServiceState> {
  return {
    type: patch.type,
    nbSeances: patch.nbSeances,
    rythme: patch.rythme,
    dureeMin: patch.dureeMin,
    tarif: patch.tarif,
    prixMontant: patch.prixMontant,
    prixDevise: patch.prixDevise,
    paiementMode: patch.paiementMode,
    paiementInstructions: patch.paiementInstructions,
    actif: patch.actif,
    enVedette: patch.enVedette,
  }
}

/** Point de départ d'une création : le corps validé (défauts appliqués) est fusionné par-dessus. */
const EMPTY_STATE: ServiceState = {
  type: 'rdv',
  nbSeances: null,
  rythme: null,
  dureeMin: null,
  tarif: 'gratuit',
  prixMontant: null,
  prixDevise: null,
  paiementMode: null,
  paiementInstructions: null,
  actif: true,
  enVedette: false,
}

function orKeep<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value
}

function assertCoherent(etat: ServiceState): void {
  const erreurs = checkServiceCoherence(etat)
  if (Object.keys(erreurs).length > 0) throw new ValidationError(erreurs)
}

function assertPaiementAllowed(mode: string | null, options: OptionsService): void {
  if (!options.paiementEnLigne && mode !== null && PAIEMENTS_EN_LIGNE.includes(mode)) {
    throw new UnprocessableError('PAIEMENT_EN_LIGNE_INDISPONIBLE')
  }
}

function vedetteComplete(vedettes: readonly ServiceRow[]): ConflictError {
  return new ConflictError('VEDETTE_COMPLETE', {
    enVedette: vedettes.map((ligne) => ({ id: ligne.id, titre: ligne.titre })),
  })
}

/** Un orphelin de fichier sera nettoyé plus tard : l'échec ne doit pas faire échouer l'écriture déjà validée. */
async function cleanupImage(userId: string, mediaId: string | null): Promise<void> {
  if (mediaId === null) return
  await deleteMediaIfUnreferenced(userId, mediaId).catch((error: unknown) => {
    console.error({ services: 'image non supprimée', nom: error instanceof Error ? error.name : typeof error })
  })
}

export async function listOwnServices(userId: string): Promise<ServicesAvecCompteurs> {
  const items = await listWithImages(db, await requireVitrineId(userId))
  return { items, compteurs: computeCompteurs(items.map((item) => item.service), VEDETTE_MAX) }
}

export async function getOwnService(userId: string, id: string): Promise<ServiceAvecCompteurs> {
  const { items, compteurs } = await listOwnServices(userId)
  const item = items.find((entry) => entry.service.id === id)
  if (!item) throw new NotFoundError('SERVICE_INTROUVABLE')
  return { item, compteurs }
}

async function insertService(userId: string, input: ServiceCreateInput, options: OptionsService): Promise<ServiceAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)

    const etat = normalizeServiceState(EMPTY_STATE, pickState(input))
    assertCoherent(etat)
    assertPaiementAllowed(etat.paiementMode, options)
    if (input.imageMediaId !== null) await requireOwnedMedia(tx, userId, input.imageMediaId)

    const vedettes = rows.filter((ligne) => ligne.enVedette)
    const enVedette = resolveEnVedette({
      demande: input.enVedette,
      actif: etat.actif,
      autresEnVedette: vedettes.length,
      max: VEDETTE_MAX,
    })
    if (enVedette === 'COMPLET') throw vedetteComplete(vedettes)

    const slug = pickAvailableSlug(slugFromTitle(input.titre), new Set(rows.map((ligne) => ligne.slug)))
    const [created] = await tx
      .insert(services)
      .values({
        id: randomUUID(),
        vitrineId,
        slug,
        titre: input.titre,
        description: input.description,
        imageMediaId: input.imageMediaId,
        type: etat.type,
        nbSeances: etat.nbSeances,
        rythme: etat.rythme,
        dureeMin: etat.dureeMin,
        tarif: etat.tarif,
        prixMontant: etat.prixMontant,
        prixDevise: etat.prixDevise,
        paiementMode: etat.paiementMode,
        paiementInstructions: etat.paiementInstructions,
        inclus: input.inclus,
        reservable: input.reservable,
        enVedette,
        ordre: rows.reduce((max, ligne) => Math.max(max, ligne.ordre + 1), 0),
        actif: etat.actif,
      })
      .returning({ id: services.id })
    if (!created) throw new Error('Insertion du service sans résultat.')

    const [item] = await selectWithImage(tx).where(eq(services.id, created.id))
    if (!item) throw new Error('Service créé introuvable.')
    return { item, compteurs: computeCompteurs([...rows, item.service], VEDETTE_MAX) }
  })
}

export async function createService(
  userId: string,
  input: ServiceCreateInput,
  options: OptionsService = resolveServiceOptions(),
): Promise<ServiceAvecCompteurs> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertService(userId, input, options)
    } catch (error) {
      const { code, constraint } = readPgError(error)
      // Collision de slug (insertion hors verrou) : une nouvelle tentative relit les slugs existants.
      if (code === PG_UNIQUE_VIOLATION && constraint === SLUG_UNIQUE && attempt < SLUG_ATTEMPTS) continue
      if (code === PG_FOREIGN_KEY_VIOLATION && constraint === IMAGE_FK) throw new UnprocessableError('MEDIA_INVALIDE')
      throw error
    }
  }
}

export async function updateService(
  userId: string,
  id: string,
  patch: ServiceUpdateInput,
  options: OptionsService = resolveServiceOptions(),
): Promise<ServiceAvecCompteurs> {
  let result: ServiceAvecCompteurs
  let previousImageId: string | null
  try {
    ;({ result, previousImageId } = await db.transaction(async (tx) => {
      const vitrineId = await lockVitrineId(tx, userId)
      const rows = await listRows(tx, vitrineId)
      const current = rows.find((ligne) => ligne.id === id)
      if (!current) throw new NotFoundError('SERVICE_INTROUVABLE')

      // Cohérence évaluée sur l'état fusionné (base + modification), pas sur le seul corps.
      const etat = normalizeServiceState(toState(current), pickState(patch))
      assertCoherent(etat)
      if (etat.paiementMode !== current.paiementMode) assertPaiementAllowed(etat.paiementMode, options)

      const imageMediaId = orKeep(patch.imageMediaId, current.imageMediaId)
      if (imageMediaId !== null && imageMediaId !== current.imageMediaId) await requireOwnedMedia(tx, userId, imageMediaId)

      if (etat.enVedette && !current.enVedette) {
        const autres = rows.filter((ligne) => ligne.id !== id && ligne.enVedette)
        const decision = resolveEnVedette({ demande: true, actif: etat.actif, autresEnVedette: autres.length, max: VEDETTE_MAX })
        if (decision === 'COMPLET') throw vedetteComplete(autres)
      }

      await tx
        .update(services)
        .set({
          titre: orKeep(patch.titre, current.titre),
          description: orKeep(patch.description, current.description),
          imageMediaId,
          type: etat.type,
          nbSeances: etat.nbSeances,
          rythme: etat.rythme,
          dureeMin: etat.dureeMin,
          tarif: etat.tarif,
          prixMontant: etat.prixMontant,
          prixDevise: etat.prixDevise,
          paiementMode: etat.paiementMode,
          paiementInstructions: etat.paiementInstructions,
          inclus: orKeep(patch.inclus, current.inclus),
          reservable: orKeep(patch.reservable, current.reservable),
          enVedette: etat.enVedette,
          actif: etat.actif,
          updatedAt: new Date(),
        })
        .where(and(eq(services.id, id), eq(services.vitrineId, vitrineId)))

      const [item] = await selectWithImage(tx).where(eq(services.id, id))
      if (!item) throw new NotFoundError('SERVICE_INTROUVABLE')
      const compteurs = computeCompteurs(
        rows.map((ligne) => (ligne.id === id ? item.service : ligne)),
        VEDETTE_MAX,
      )
      return { result: { item, compteurs }, previousImageId: current.imageMediaId }
    }))
  } catch (error) {
    const { code, constraint } = readPgError(error)
    if (code === PG_FOREIGN_KEY_VIOLATION && constraint === IMAGE_FK) throw new UnprocessableError('MEDIA_INVALIDE')
    throw error
  }

  // Après le commit : l'ancienne image disparaît si plus rien ne la référence.
  if (previousImageId !== result.item.service.imageMediaId) await cleanupImage(userId, previousImageId)
  return result
}

export async function deleteService(userId: string, id: string): Promise<void> {
  const vitrineId = await requireVitrineId(userId)
  const [deleted] = await db
    .delete(services)
    .where(and(eq(services.id, id), eq(services.vitrineId, vitrineId)))
    .returning({ imageMediaId: services.imageMediaId })
  if (!deleted) throw new NotFoundError('SERVICE_INTROUVABLE')
  await cleanupImage(userId, deleted.imageMediaId)
}

/** `ids` doit être une permutation exacte de TOUS les services de la vitrine. */
export async function reorderServices(userId: string, ids: readonly string[]): Promise<ServicesAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const known = new Set(rows.map((ligne) => ligne.id))
    const complete = ids.length === known.size && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
    if (!complete) throw new UnprocessableError('ORDRE_INVALIDE')

    if (ids.length > 0) {
      const liste = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await tx.execute(sql`
        UPDATE services AS s SET ordre = v.rang - 1
        FROM unnest(ARRAY[${liste}]::text[]) WITH ORDINALITY AS v(id, rang)
        WHERE s.id = v.id AND s.vitrine_id = ${vitrineId}
      `)
    }
    const items = await listWithImages(tx, vitrineId)
    return { items, compteurs: computeCompteurs(items.map((item) => item.service), VEDETTE_MAX) }
  })
}

async function listVisible(vitrineId: string): Promise<ServiceAvecImage[]> {
  return selectWithImage(db)
    .where(and(eq(services.vitrineId, vitrineId), eq(services.actif, true)))
    .orderBy(...ORDER)
}

/** Services visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : VITRINE_INTROUVABLE. */
export async function getPublicServices(rawUsername: string): Promise<ServicesPublics> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const visibles = await listVisible(vitrine.id)
  const retenus = new Set(computeALaUne(visibles.map((item) => item.service), VEDETTE_MAX))
  return {
    vitrine,
    total: visibles.length,
    aLaUne: visibles.filter((item) => retenus.has(item.service)),
    services: visibles,
  }
}

/** Détail d'un service visible. Slug mal formé, masqué ou d'une autre vitrine : SERVICE_INTROUVABLE. */
export async function getPublicService(rawUsername: string, rawSlug: string): Promise<ServicePublic> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const slug = rawSlug.trim().toLowerCase()
  if (slug.length > SERVICE_SLUG_MAX || !SERVICE_SLUG_REGEX.test(slug)) throw new NotFoundError('SERVICE_INTROUVABLE')
  const visibles = await listVisible(vitrine.id)
  const item = visibles.find((entry) => entry.service.slug === slug)
  if (!item) throw new NotFoundError('SERVICE_INTROUVABLE')
  return {
    vitrine,
    item,
    autres: visibles.filter((entry) => entry !== item).slice(0, AUTRES_SERVICES_MAX),
    total: visibles.length,
  }
}
