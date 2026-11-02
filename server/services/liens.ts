import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { liens, vitrines } from '../../shared/db/schema'
import { LISTE_SLUG_MAX } from '../../shared/listes'
import {
  adresseDepuisMailtoUrl,
  construireUrlLien,
  numeroDepuisTelUrl,
  numeroDepuisWhatsappUrl,
  pageDepuisVitrineUrl,
  plateformeDepuisUrl,
} from '../../shared/liens'
import type { LienSource, LienType } from '../../shared/liens'
import type { LienCreateInput, LienUpdateInput } from '../../shared/schemas/lien'
import { NotFoundError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { pickAvailableSlug, slugFromText } from './listes-regles'
import { checkLienPatchCoherence, getCurrentWeekClicks, getIsoWeekStartUtc } from './liens-regles'
import { enforceLimit } from './limiteur'
import { LIEN_CLIC_LIMIT } from '../../shared/limites'
import { lockVitrineId, requireVitrineId } from './vitrine-acces'
import type { Executor, Transaction } from './vitrine-acces'
import { getPublicVitrine } from './vitrines'
import type { VitrineRow } from './vitrines'

export type LienRow = typeof liens.$inferSelect

const SLUG_UNIQUE = 'liens_vitrine_id_slug_unique'
const ORDER = [asc(liens.ordre), asc(liens.createdAt), asc(liens.id)] as const

export interface LiensCompteurs {
  total: number
  visibles: number
  clicsSemaine: number
}

export function computeLiensCompteurs(rows: readonly LienRow[], reference: Date = new Date()): LiensCompteurs {
  return {
    total: rows.length,
    visibles: rows.filter((ligne) => ligne.actif).length,
    clicsSemaine: rows.reduce((somme, ligne) => somme + getCurrentWeekClicks(ligne, reference), 0),
  }
}

function selectLiens(executor: Executor) {
  return executor.select().from(liens)
}

async function listRows(executor: Executor, vitrineId: string): Promise<LienRow[]> {
  return executor.select().from(liens).where(eq(liens.vitrineId, vitrineId)).orderBy(...ORDER)
}

async function loadItem(executor: Executor, id: string): Promise<LienRow | undefined> {
  const [ligne] = await selectLiens(executor).where(eq(liens.id, id))
  return ligne
}

export async function listOwnLiens(userId: string): Promise<{ items: LienRow[]; compteurs: LiensCompteurs }> {
  const entries = await listRows(db, await requireVitrineId(userId))
  return { items: entries, compteurs: computeLiensCompteurs(entries) }
}

export async function getOwnLien(userId: string, id: string): Promise<{ item: LienRow }> {
  const entries = await listRows(db, await requireVitrineId(userId))
  const ligne = entries.find((candidate) => candidate.id === id)
  if (!ligne) throw new NotFoundError('LIEN_INTROUVABLE')
  return { item: ligne }
}

/** Verrou sur la vitrine, avec le `username` : les liens internes s'y construisent. */
async function lockVitrine(tx: Transaction, userId: string) {
  const [vitrine] = await tx
    .select({ id: vitrines.id, username: vitrines.username })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .for('update')
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine
}

/** URL finale selon le type : les champs construits (numéro, adresse, page) remplacent l'URL fournie. */
type ChampsLien = Pick<LienSource, 'url' | 'numero' | 'adresse' | 'page'>
function urlFinale(type: LienType, username: string, champs: ChampsLien): string {
  return construireUrlLien({ type, username, url: champs.url, numero: champs.numero, adresse: champs.adresse, page: champs.page })
}

/** La cohérence plateforme/URL est imposée pour les liens `reseau` (icône du pied de vitrine). */
function verifierPlateforme(url: string, plateforme: string | undefined): void {
  if (!plateforme || plateformeDepuisUrl(url) === plateforme) return
  throw new ValidationError({ url: ['Ce lien ne correspond pas au réseau social choisi.'] })
}

async function insertLien(userId: string, input: LienCreateInput): Promise<{ item: LienRow; compteurs: LiensCompteurs }> {
  return db.transaction(async (tx) => {
    const vitrine = await lockVitrine(tx, userId)
    const rows = await listRows(tx, vitrine.id)

    const url = urlFinale(input.type, vitrine.username, input)
    verifierPlateforme(url, 'plateforme' in input ? input.plateforme : undefined)

    const base = slugFromText(input.libelle, { max: LISTE_SLUG_MAX, repli: 'lien' })
    const slug = pickAvailableSlug(base, new Set(rows.map((ligne) => ligne.slug)), LISTE_SLUG_MAX)
    const [cree] = await tx
      .insert(liens)
      .values({
        id: randomUUID(),
        vitrineId: vitrine.id,
        slug,
        libelle: input.libelle,
        url,
        type: input.type,
        ordre: rows.reduce((max, ligne) => Math.max(max, ligne.ordre + 1), 0),
        actif: input.actif,
      })
      .returning({ id: liens.id })
    if (!cree) throw new Error('Insertion du lien sans résultat.')

    const item = await loadItem(tx, cree.id)
    if (!item) throw new NotFoundError('LIEN_INTROUVABLE')
    return { item, compteurs: computeLiensCompteurs([...rows, item]) }
  })
}

export async function createLien(userId: string, input: LienCreateInput): Promise<{ item: LienRow; compteurs: LiensCompteurs }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertLien(userId, input)
    } catch (error) {
      const { code, constraint } = readPgError(error)
      if (code === PG_UNIQUE_VIOLATION && constraint === SLUG_UNIQUE && attempt < 2) continue
      throw error
    }
  }
}

export async function updateLien(userId: string, id: string, patch: LienUpdateInput): Promise<{ item: LienRow; compteurs: LiensCompteurs }> {
  return db.transaction(async (tx) => {
    const vitrine = await lockVitrine(tx, userId)
    const rows = await listRows(tx, vitrine.id)
    const current = rows.find((ligne) => ligne.id === id)
    if (!current) throw new NotFoundError('LIEN_INTROUVABLE')

    const incoherences = checkLienPatchCoherence(current.type as LienType, patch)
    if (Object.keys(incoherences).length > 0) throw new ValidationError(incoherences)

    // Champ spécifique du type fusionné sur l'état courant, puis URL reconstruite
    // (le type est fixé à la création ; l'URL construite fait foi).
    const specifique = fusionType(current as { type: LienType; url: string }, patch, vitrine.username)
    const url = urlFinale(current.type as LienType, vitrine.username, { ...specifique, url: patch.url ?? current.url })
    verifierPlateforme(url, patch.plateforme ?? plateformeDepuisUrl(url) ?? undefined)

    await tx
      .update(liens)
      .set({
        libelle: patch.libelle ?? current.libelle,
        url,
        actif: patch.actif ?? current.actif,
        updatedAt: new Date(),
      })
      .where(and(eq(liens.id, id), eq(liens.vitrineId, vitrine.id)))

    const item = await loadItem(tx, id)
    if (!item) throw new NotFoundError('LIEN_INTROUVABLE')
    const compteurs = computeLiensCompteurs(rows.map((ligne) => (ligne.id === id ? item : ligne)))
    return { item, compteurs }
  })
}

/** Champ spécifique du type déduit du patch ou de l'URL stockée (l'URL construite fait foi). */
function fusionType(current: { type: LienType; url: string }, patch: LienUpdateInput, username: string): Pick<LienUpdateInput, 'numero' | 'adresse' | 'page'> {
  switch (current.type) {
    case 'whatsapp':
      return { numero: patch.numero ?? numeroDepuisWhatsappUrl(current.url) }
    case 'telephone':
      return { numero: patch.numero ?? numeroDepuisTelUrl(current.url) }
    case 'email':
      return { adresse: patch.adresse ?? adresseDepuisMailtoUrl(current.url) }
    case 'vitrine':
      // Un username récent peut avoir déplacé la page interne : repli sur l'accueil.
      return { page: patch.page ?? pageDepuisVitrineUrl(username, current.url) ?? 'accueil' }
    case 'libre':
    case 'reseau':
      return {}
  }
}

export async function deleteLien(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const [deleted] = await tx
      .delete(liens)
      .where(and(eq(liens.id, id), eq(liens.vitrineId, vitrineId)))
      .returning({ id: liens.id })
    if (!deleted) throw new NotFoundError('LIEN_INTROUVABLE')
  })
}

/** `ids` doit être une permutation exacte de TOUS les liens de la vitrine. */
export async function reorderLiens(userId: string, ids: readonly string[]): Promise<{ items: LienRow[]; compteurs: LiensCompteurs }> {
  return db.transaction(async (tx) => {
    const vitrineId = await lockVitrineId(tx, userId)
    const rows = await listRows(tx, vitrineId)
    const known = new Set(rows.map((ligne) => ligne.id))
    const complete = ids.length === known.size && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
    if (!complete) throw new UnprocessableError('ORDRE_INVALIDE')

    if (ids.length > 0) {
      const liste = sql.join(ids.map((id) => sql`${id}`), sql`, `)
      await tx.execute(sql`
        UPDATE liens AS l SET ordre = v.rang - 1
        FROM unnest(ARRAY[${liste}]::text[]) WITH ORDINALITY AS v(id, rang)
        WHERE l.id = v.id AND l.vitrine_id = ${vitrineId}
      `)
    }
    const entries = await listRows(tx, vitrineId)
    return { items: entries, compteurs: computeLiensCompteurs(entries) }
  })
}

async function listVisible(vitrineId: string): Promise<LienRow[]> {
  return selectLiens(db)
    .where(and(eq(liens.vitrineId, vitrineId), eq(liens.actif, true)))
    .orderBy(...ORDER)
}

/** Liens visibles d'une vitrine publiée. Username invalide, inconnu ou non publié : 404. */
export async function getPublicLiens(rawUsername: string): Promise<{ vitrine: VitrineRow; total: number; liens: LienRow[] }> {
  const { vitrine } = await getPublicVitrine(rawUsername)
  const visibles = await listVisible(vitrine.id)
  return { vitrine, total: visibles.length, liens: visibles }
}

/**
 * Enregistre un clic sur un lien visible (trafic public). Un seul UPDATE atomique : incrémente
 * le total et le compteur de la semaine (remis à zéro au premier clic d'une nouvelle semaine).
 * Limité en débit par adresse IP ; une 429 ne bloque jamais la navigation (appel en arrière-plan).
 */
export async function recordLienClic(rawUsername: string, slug: string, ip: string, reference: Date = new Date()): Promise<void> {
  await enforceLimit(`lien-clic:${ip}`, LIEN_CLIC_LIMIT.limit, LIEN_CLIC_LIMIT.windowS)
  const { vitrine } = await getPublicVitrine(rawUsername)
  const semaineDebut = getIsoWeekStartUtc(reference)
  const result = await db.execute(sql`
    UPDATE liens AS l SET
      clics = l.clics + 1,
      clics_semaine = CASE WHEN l.semaine_debut = ${semaineDebut}::date THEN l.clics_semaine + 1 ELSE 1 END,
      semaine_debut = ${semaineDebut}::date,
      updated_at = now()
    FROM vitrines AS v
    WHERE v.id = l.vitrine_id AND v.id = ${vitrine.id} AND l.slug = ${slug} AND l.actif
  `)
  if ((result.rowCount ?? 0) === 0) throw new NotFoundError('LIEN_INTROUVABLE')
}
