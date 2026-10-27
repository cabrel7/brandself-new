import { asc, eq } from 'drizzle-orm'
import { db } from '../../../server/utils/db'
import { realisationImages, realisations } from '../../../shared/db/schema'
import { schemaRealisationCreate, schemaRealisationUpdate } from '../../../shared/schemas/realisation'
import type { RealisationCreateRaw } from '../../../shared/schemas/realisation'
import type { MediaRow, RealisationImageRow, RealisationRow } from './fabriques'
import { insertMediaRow } from './fabriques'
import { realisationsService } from './modules'

// CONTRAT DE LA COUCHE SERVICE ATTENDU PAR LES TESTS S4 (phase RED -> à respecter en GREEN).
//
// server/services/realisations.ts exporte, sans jamais recevoir d'`event` ni renvoyer de DTO :
//   listOwnRealisations(userId)                  -> Promise<{ items: RealisationAvecMedias[], compteurs }>
//   getOwnRealisation(userId, id)                -> Promise<{ item: RealisationAvecMedias, compteurs }>
//   createRealisation(userId, input)             -> Promise<{ item, compteurs }>   input = schemaRealisationCreate.parse(...)
//   updateRealisation(userId, id, patch)         -> Promise<{ item, compteurs }>   patch = schemaRealisationUpdate.parse(...)
//   deleteRealisation(userId, id)                -> Promise<void>
//   reorderRealisations(userId, ids)             -> Promise<{ items: RealisationAvecMedias[], compteurs }>
//   getPublicRealisations(rawUsername)           -> Promise<{ vitrine: VitrineRow, total, aLaUne: RealisationAvecImage[], realisations: RealisationAvecImage[] }>
//   getPublicRealisation(rawUsername, rawSlug)   -> Promise<{ vitrine: VitrineRow, item: RealisationAvecMedias, autres: RealisationAvecImage[], total }>
// avec
//   RealisationAvecImage  = { realisation: RealisationRow, image: MediaRow | null }
//   RealisationAvecMedias = RealisationAvecImage & { galerie: MediaRow[] }   // galerie dans l'ordre d'affichage
//   compteurs             = { total, visibles, enVedette, vedetteMax }       // mêmes clés que RealisationsCompteursDTO
//
// server/resources/realisation.ts exporte :
//   toRealisationStudioResource(row, image, galerie)                  -> RealisationStudioDTO
//   toRealisationsCompteursResource(compteurs)                        -> RealisationsCompteursDTO
//   toRealisationPublicCarteResource(row, image)                      -> RealisationPublicCarteDTO
//   toRealisationPublicDetailResource(row, image, galerie, vitrine)   -> RealisationPublicDetailDTO

export interface RealisationAvecImage {
  realisation: RealisationRow
  image: MediaRow | null
}

export interface RealisationAvecMedias extends RealisationAvecImage {
  galerie: MediaRow[]
}

export interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

export const TITRE_PAR_DEFAUT = 'Une réalisation'

/**
 * Crée une réalisation via la vraie couche service ; l'entrée passe par le vrai schéma Zod.
 * Sans `imageMediaId`, un média de l'utilisateur est inséré (ligne seule : pas de fichier, la propriété
 * est vérifiée en base). Les tests de fichiers fournissent un vrai média téléversé.
 */
export async function creer(userId: string, surcharges: Partial<RealisationCreateRaw> = {}) {
  const { createRealisation } = await realisationsService()
  const imageMediaId = surcharges.imageMediaId ?? (await insertMediaRow(userId)).id
  return createRealisation(userId, schemaRealisationCreate.parse({ titre: TITRE_PAR_DEFAUT, ...surcharges, imageMediaId }))
}

/** Met à jour via la vraie couche service ; le patch passe par le vrai schéma Zod (partiel, strict). */
export async function modifier(userId: string, id: string, patch: Record<string, unknown>) {
  const { updateRealisation } = await realisationsService()
  return updateRealisation(userId, id, schemaRealisationUpdate.parse(patch))
}

/** Lignes `realisations` d'une vitrine dans l'ordre d'affichage (ordre, puis création, puis id). */
export async function lignesDeLaVitrine(vitrineId: string): Promise<RealisationRow[]> {
  return db
    .select()
    .from(realisations)
    .where(eq(realisations.vitrineId, vitrineId))
    .orderBy(asc(realisations.ordre), asc(realisations.createdAt), asc(realisations.id))
}

export async function ligneRealisation(id: string): Promise<RealisationRow | undefined> {
  const [ligne] = await db.select().from(realisations).where(eq(realisations.id, id))
  return ligne
}

/** Lignes de galerie d'une réalisation, dans l'ordre d'affichage. */
export async function lignesDeGalerie(realisationId: string): Promise<RealisationImageRow[]> {
  return db
    .select()
    .from(realisationImages)
    .where(eq(realisationImages.realisationId, realisationId))
    .orderBy(asc(realisationImages.ordre))
}

/** Identifiants de médias de la galerie, dans l'ordre d'affichage. */
export async function galerieEnBase(realisationId: string): Promise<string[]> {
  return (await lignesDeGalerie(realisationId)).map((ligne) => ligne.mediaId)
}

export async function toutesLesLignesDeGalerie(): Promise<RealisationImageRow[]> {
  return db.select().from(realisationImages)
}

/** Liste d'identifiants dont l'ordre est volontairement l'inverse de l'ordre alphabétique (un tri accidentel se verrait). */
export function ordreContraireDuTri(ids: readonly string[]): string[] {
  return [...ids].sort().reverse()
}
