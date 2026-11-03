import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { env } from '../../shared/env'
import { medias, services } from '../../shared/db/schema'
import type { ServiceCreateInput, ServiceUpdateInput } from '../../shared/schemas/service'
import { AUTRES_SERVICES_MAX, SERVICE_SLUG_MAX, SERVICE_SLUG_REGEX, VEDETTE_MAX } from '../../shared/services'
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_FOREIGN_KEY_VIOLATION, PG_RESTRICT_VIOLATION, PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import type { MediaRow } from './medias'
import { getLimiteStudio, getPlanPublic, marquerMasque, sqlIdsVisibles, vuePlanStudio } from './plan-visibilite'
import type { CompteursAvecPlan } from './plan-visibilite'
import { assertQuota } from './plans'
import {
  checkServiceCoherence,
  computeALaUne,
  computeCompteurs,
  normalizeServiceState,
  pickAvailableSlug,
  resolveEnVedette,
  slugFromTitle,
} from './services-regles'
import type { ServiceState } from './services-regles'
import { cleanupMedias, lockVitrineId, requireOwnedMedias, requireVitrineId } from './vitrine-acces'
import type { Executor } from './vitrine-acces'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type ServiceRow = typeof services.$inferSelect
export type { Compteurs } from './services-regles'

/** Un service et son image (jointure gauche sur `medias`). */
export interface ServiceAvecImage {
  service: ServiceRow
  image: MediaRow | null
}

/** Ligne du studio : `masqueParPlan` = actif mais au-delà de la limite du plan (S10 #127). */
export type ServiceStudioRow = ServiceRow & { masqueParPlan: boolean }

export interface ServiceStudioAvecImage {
  service: ServiceStudioRow
  image: MediaRow | null
}

export interface ServiceAvecCompteurs {
  item: ServiceStudioAvecImage
  compteurs: CompteursAvecPlan
}

export interface ServicesAvecCompteurs {
  items: ServiceStudioAvecImage[]
  compteurs: CompteursAvecPlan
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
const LOG_CONTEXTE = 'services'

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
  await cleanupMedias(userId, mediaId === null ? [] : [mediaId], LOG_CONTEXTE)
}

/**
 * Vue du studio sur la liste COMPLÈTE de la vitrine : chaque ligne porte `masqueParPlan`, les compteurs portent
 * `limitePlan` (usage = toutes les lignes, visibles ou non, comme le quota de création).
 */
function versStudio(items: readonly ServiceAvecImage[], limite: number | null): ServicesAvecCompteurs {
  const lignes = items.map((entry) => entry.service)
  const vue = vuePlanStudio(lignes, limite)
  return {
    items: items.map(({ service, image }) => ({ service: marquerMasque(service, vue.masques), image })),
    compteurs: { ...computeCompteurs(lignes, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

/** Même vue, centrée sur une ligne `cible` de `lignes` (la liste complète après l'écriture). */
function versStudioItem(lignes: readonly ServiceRow[], cible: ServiceAvecImage, limite: number | null): ServiceAvecCompteurs {
  const vue = vuePlanStudio(lignes, limite)
  return {
    item: { service: marquerMasque(cible.service, vue.masques), image: cible.image },
    compteurs: { ...computeCompteurs(lignes, VEDETTE_MAX), limitePlan: vue.limitePlan },
  }
}

export async function listOwnServices(userId: string, now: Date = new Date()): Promise<ServicesAvecCompteurs> {
  const vitrineId = await requireVitrineId(userId)
  const [items, limite] = await Promise.all([listWithImages(db, vitrineId), getLimiteStudio(userId, 'services', now)])
  return versStudio(items, limite)
}

export async function getOwnService(userId: string, id: string, now: Date = new Date()): Promise<ServiceAvecCompteurs> {
  const { items, compteurs } = await listOwnServices(userId, now)
  const item = items.find((entry) => entry.service.id === id)
  if (!item) throw new NotFoundError('SERVICE_INTROUVABLE')
  return { item, compteurs }
}

async function insertService(
  userId: string,
  input: ServiceCreateInput,
  options: OptionsService,
  now: Date,
): Promise<ServiceAvecCompteurs> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    // Quota sous le verrou vitrine : deux créations simultanées ne dépassent jamais la limite (CA79).
    const { limite } = await assertQuota(tx, { userId, vitrineId }, 'services', now)
    const rows = await listRows(tx, vitrineId)

    const etat = normalizeServiceState(EMPTY_STATE, pickState(input))
    assertCoherent(etat)
    assertPaiementAllowed(etat.paiementMode, options)
    if (input.imageMediaId !== null) await requireOwnedMedias(tx, userId, [input.imageMediaId])

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
    return versStudioItem([...rows, item.service], item, limite)
  })
}

export async function createService(
  userId: string,
  input: ServiceCreateInput,
  options: OptionsService = resolveServiceOptions(),
  now: Date = new Date(),
): Promise<ServiceAvecCompteurs> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertService(userId, input, options, now)
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
  now: Date = new Date(),
): Promise<ServiceAvecCompteurs> {
  let result: ServiceAvecCompteurs
  let previousImageId: string | null
  try {
    ;({ result, previousImageId } = await db.transaction(async (tx) => {
      const vitrineId = await lockVitrineId(tx, userId)
      const rows = await listRows(tx, vitrineId)
      const limite = await getLimiteStudio(userId, 'services', now, tx)
      const current = rows.find((ligne) => ligne.id === id)
      if (!current) throw new NotFoundError('SERVICE_INTROUVABLE')

      // Cohérence évaluée sur l'état fusionné (base + modification), pas sur le seul corps.
      const etat = normalizeServiceState(toState(current), pickState(patch))
      assertCoherent(etat)
      if (etat.paiementMode !== current.paiementMode) assertPaiementAllowed(etat.paiementMode, options)

      const imageMediaId = orKeep(patch.imageMediaId, current.imageMediaId)
      if (imageMediaId !== null && imageMediaId !== current.imageMediaId) await requireOwnedMedias(tx, userId, [imageMediaId])

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
      const lignes = rows.map((ligne) => (ligne.id === id ? item.service : ligne))
      return { result: versStudioItem(lignes, item, limite), previousImageId: current.imageMediaId }
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
  let deleted: { imageMediaId: string | null } | undefined
  try {
    ;[deleted] = await db
      .delete(services)
      .where(and(eq(services.id, id), eq(services.vitrineId, vitrineId)))
      .returning({ imageMediaId: services.imageMediaId })
  } catch (error) {
    const { code, constraint } = readPgError(error)
    const usedByAgenda = constraint === 'reservations_service_id_services_id_fk'
      || constraint === 'demandes_service_id_services_id_fk'
    if (usedByAgenda && (code === PG_RESTRICT_VIOLATION || code === PG_FOREIGN_KEY_VIOLATION)) {
      throw new ConflictError('SERVICE_UTILISE')
    }
    throw error
  }
  if (!deleted) throw new NotFoundError('SERVICE_INTROUVABLE')
  await cleanupImage(userId, deleted.imageMediaId)
}

/** `ids` doit être une permutation exacte de TOUS les services de la vitrine. */
export async function reorderServices(
  userId: string,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<ServicesAvecCompteurs> {
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
    return versStudio(items, await getLimiteStudio(userId, 'services', now, tx))
  })
}

/** Services actifs ET visibles au regard du plan (les `limite` plus anciens), dans l'ordre d'affichage. */
async function listVisible(vitrineId: string, limite: number | null): Promise<ServiceAvecImage[]> {
  return selectWithImage(db)
    .where(and(eq(services.vitrineId, vitrineId), eq(services.actif, true), sqlIdsVisibles(services, vitrineId, limite)))
    .orderBy(...ORDER)
}

/** Services visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : VITRINE_INTROUVABLE. */
export async function getPublicServices(rawUsername: string, now: Date = new Date()): Promise<ServicesPublics> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const { limites } = await getPlanPublic(vitrine, now)
  const visibles = await listVisible(vitrine.id, limites.services)
  const retenus = new Set(computeALaUne(visibles.map((item) => item.service), VEDETTE_MAX))
  return {
    vitrine,
    total: visibles.length,
    aLaUne: visibles.filter((item) => retenus.has(item.service)),
    services: visibles,
  }
}

/** Détail d'un service visible. Slug mal formé, masqué ou d'une autre vitrine : SERVICE_INTROUVABLE. */
export async function getPublicService(
  rawUsername: string,
  rawSlug: string,
  now: Date = new Date(),
): Promise<ServicePublic> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const slug = rawSlug.trim().toLowerCase()
  if (slug.length > SERVICE_SLUG_MAX || !SERVICE_SLUG_REGEX.test(slug)) throw new NotFoundError('SERVICE_INTROUVABLE')
  const { limites } = await getPlanPublic(vitrine, now)
  const visibles = await listVisible(vitrine.id, limites.services)
  const item = visibles.find((entry) => entry.service.slug === slug)
  if (!item) throw new NotFoundError('SERVICE_INTROUVABLE')
  return {
    vitrine,
    item,
    autres: visibles.filter((entry) => entry !== item).slice(0, AUTRES_SERVICES_MAX),
    total: visibles.length,
  }
}
