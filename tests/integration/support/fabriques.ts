import { randomUUID } from 'node:crypto'
import { db } from '../../../server/utils/db'
import {
  liens,
  medias,
  realisations,
  services,
  sessions,
  temoignages,
  users,
  vitrines,
} from '../../../shared/db/schema'

// Fabriques d'état de départ : insertions directes en base (jamais de mock). Les comportements
// éprouvés par les critères passent, eux, par les services réels.

export type UserRow = typeof users.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type VitrineRow = typeof vitrines.$inferSelect
export type MediaRow = typeof medias.$inferSelect

const HEURE_MS = 3_600_000

export async function createUser(surcharges: Partial<typeof users.$inferInsert> = {}): Promise<UserRow> {
  const id = surcharges.id ?? randomUUID()
  const [ligne] = await db
    .insert(users)
    .values({
      id,
      name: 'Utilisateur de test',
      email: `${id}@exemple.com`,
      emailVerified: true,
      ...surcharges,
    })
    .returning()
  return ligne
}

export interface SessionOptions {
  creeIlYADesHeures?: number
  expireDansDesHeures?: number
  userAgent?: string | null
  updatedAt?: Date
}

export async function createSession(userId: string, options: SessionOptions = {}): Promise<SessionRow> {
  const maintenant = Date.now()
  const [ligne] = await db
    .insert(sessions)
    .values({
      id: randomUUID(),
      userId,
      token: `jeton-secret-${randomUUID()}`,
      userAgent: options.userAgent === undefined ? 'Mozilla/5.0 (test)' : options.userAgent,
      ipAddress: '203.0.113.7',
      createdAt: new Date(maintenant - (options.creeIlYADesHeures ?? 0) * HEURE_MS),
      updatedAt: options.updatedAt ?? new Date(maintenant),
      expiresAt: new Date(maintenant + (options.expireDansDesHeures ?? 24 * 30) * HEURE_MS),
    })
    .returning()
  return ligne
}

export async function insertMediaRow(userId: string, surcharges: Partial<typeof medias.$inferInsert> = {}): Promise<MediaRow> {
  const id = surcharges.id ?? randomUUID()
  const [ligne] = await db
    .insert(medias)
    .values({
      id,
      userId,
      chemin: `${userId}/${id}`,
      mime: 'image/webp',
      taille: 1234,
      largeur: 100,
      hauteur: 100,
      ...surcharges,
    })
    .returning()
  return ligne
}

export interface VitrineSeed {
  username?: string
  titre?: string | null
  prenom?: string
  nom?: string
  metier?: string
  ville?: string | null
  pays?: string | null
  publiee?: boolean
}

/** Vitrine complète (prête à publier) insérée directement ; ne passe PAS par createVitrine. */
export async function insertVitrineRow(userId: string, seed: VitrineSeed = {}): Promise<VitrineRow> {
  const [ligne] = await db
    .insert(vitrines)
    .values({
      id: randomUUID(),
      userId,
      username: seed.username ?? `vitrine-${randomUUID().slice(0, 8)}`,
      titre: seed.titre === undefined ? 'dr' : seed.titre,
      prenom: seed.prenom ?? 'Cabrel',
      nom: seed.nom ?? 'Nguesso',
      metier: seed.metier ?? 'Cardiologue',
      ville: seed.ville === undefined ? 'Douala' : seed.ville,
      pays: seed.pays === undefined ? 'CM' : seed.pays,
      publieeLe: seed.publiee ? new Date() : null,
    })
    .returning()
  return ligne
}

export async function insertService(vitrineId: string, surcharges: Partial<typeof services.$inferInsert> = {}): Promise<void> {
  await db.insert(services).values({
    id: randomUUID(),
    vitrineId,
    slug: `service-${randomUUID().slice(0, 8)}`,
    titre: 'Consultation',
    type: 'rdv',
    dureeMin: 30,
    tarif: 'gratuit',
    ...surcharges,
  })
}

export async function insertRealisation(vitrineId: string, surcharges: Partial<typeof realisations.$inferInsert> = {}): Promise<void> {
  await db.insert(realisations).values({
    id: randomUUID(),
    vitrineId,
    slug: `realisation-${randomUUID().slice(0, 8)}`,
    titre: 'Une réalisation',
    ...surcharges,
  })
}

export async function insertTemoignage(vitrineId: string, surcharges: Partial<typeof temoignages.$inferInsert> = {}): Promise<void> {
  await db.insert(temoignages).values({
    id: randomUUID(),
    vitrineId,
    slug: `temoignage-${randomUUID()}`,
    auteur: 'Un patient',
    texte: 'Très bien.',
    ...surcharges,
  })
}

export async function insertLien(vitrineId: string, surcharges: Partial<typeof liens.$inferInsert> = {}): Promise<void> {
  await db.insert(liens).values({
    id: randomUUID(),
    vitrineId,
    slug: `lien-${randomUUID()}`,
    libelle: 'Mon site',
    url: 'https://exemple.com',
    type: 'libre',
    ...surcharges,
  })
}
