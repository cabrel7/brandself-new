import { asc, eq } from 'drizzle-orm'
import { db } from '../../../server/utils/db'
import { services as tableServices, vitrines } from '../../../shared/db/schema'
import { schemaServiceCreate, schemaServiceUpdate } from '../../../shared/schemas/service'
import type { ServiceCreateRaw } from '../../../shared/schemas/service'
import type { MediaRow, ServiceRow, UserRow, VitrineRow } from './fabriques'
import { insertVitrineRow } from './fabriques'
import { servicesService } from './modules'

// CONTRAT DE LA COUCHE SERVICE ATTENDU PAR LES TESTS S3 (phase RED -> à respecter en GREEN).
//
// server/services/services.ts exporte, sans jamais recevoir d'`event` ni renvoyer de DTO :
//   listOwnServices(userId)                         -> Promise<{ items: ServiceAvecImage[], compteurs }>
//   getOwnService(userId, id)                       -> Promise<{ item: ServiceAvecImage, compteurs }>
//   createService(userId, input, opts?)             -> Promise<{ item, compteurs }>   input = schemaServiceCreate.parse(...)
//   updateService(userId, id, patch, opts?)         -> Promise<{ item, compteurs }>   patch = schemaServiceUpdate.parse(...)
//   deleteService(userId, id)                       -> Promise<void>
//   reorderServices(userId, ids)                    -> Promise<{ items: ServiceAvecImage[], compteurs }>
//   getPublicServices(rawUsername)                  -> Promise<{ vitrine: VitrineRow, total, aLaUne: ServiceAvecImage[], services: ServiceAvecImage[] }>
//   getPublicService(rawUsername, rawSlug)          -> Promise<{ vitrine: VitrineRow, item: ServiceAvecImage, autres: ServiceAvecImage[], total }>
// opts = { paiementEnLigne: boolean } (défaut : env.PAIEMENT_EN_LIGNE).
// `compteurs` = { total, visibles, enVedette, vedetteMax } (mêmes clés que ServicesCompteursDTO).
//
// server/resources/service.ts exporte :
//   toServiceStudioResource(row: ServiceRow, image: MediaRow | null)                -> ServiceStudioDTO
//   toServicesCompteursResource(compteurs)                                           -> ServicesCompteursDTO
//   toServicePublicCarteResource(row, image)                                         -> ServicePublicCarteDTO
//   toServicePublicDetailResource(row, image, vitrine: VitrineRow, { paiementEnLigne }) -> ServicePublicDetailDTO

export interface ServiceAvecImage {
  service: ServiceRow
  image: MediaRow | null
}

export interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

export interface OptionsService {
  paiementEnLigne: boolean
}

export const HORS_LIGNE: OptionsService = { paiementEnLigne: false }
export const EN_LIGNE: OptionsService = { paiementEnLigne: true }

export const DONNEES_DE_BASE: ServiceCreateRaw = { titre: 'Consultation', type: 'rdv', dureeMin: 30, tarif: 'gratuit' }

export const DONNEES_PAYANTES: ServiceCreateRaw = {
  titre: 'Consultation de cardiologie',
  type: 'rdv',
  dureeMin: 45,
  tarif: 'payant',
  prixMontant: 15000,
  prixDevise: 'XAF',
}

/** Crée un service pour l'utilisateur via la vraie couche service ; l'entrée passe par le vrai schéma Zod. */
export async function creer(userId: string, surcharges: Partial<ServiceCreateRaw> = {}, options: OptionsService = HORS_LIGNE) {
  const { createService } = await servicesService()
  return createService(userId, schemaServiceCreate.parse({ ...DONNEES_DE_BASE, ...surcharges }), options)
}

/** Met à jour via la vraie couche service ; le patch passe par le vrai schéma Zod (partiel, strict). */
export async function modifier(userId: string, id: string, patch: Record<string, unknown>, options: OptionsService = HORS_LIGNE) {
  const { updateService } = await servicesService()
  return updateService(userId, id, schemaServiceUpdate.parse(patch), options)
}

/** Vitrine publiée prête à l'emploi (Dr Cabrel Nguesso, Cardiologue, Douala), insérée directement. */
export async function creerVitrinePubliee(user: UserRow, username = 'dr-test'): Promise<VitrineRow> {
  return insertVitrineRow(user.id, { username, publiee: true })
}

/** Lignes `services` d'une vitrine dans l'ordre d'affichage (ordre, puis création, puis id). */
export async function lignesDeLaVitrine(vitrineId: string): Promise<ServiceRow[]> {
  return db
    .select()
    .from(tableServices)
    .where(eq(tableServices.vitrineId, vitrineId))
    .orderBy(asc(tableServices.ordre), asc(tableServices.createdAt), asc(tableServices.id))
}

export async function ligneService(id: string): Promise<ServiceRow | undefined> {
  const [ligne] = await db.select().from(tableServices).where(eq(tableServices.id, id))
  return ligne
}

export async function vitrineDe(userId: string): Promise<VitrineRow> {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.userId, userId))
  return ligne
}

export const UUID_V4_OU_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
