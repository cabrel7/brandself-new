import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../server/utils/db'
import {
  generationsIa,
  liens,
  medias,
  progressionsInscription,
  promptsIa,
  realisationImages,
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

export type ServiceRow = typeof services.$inferSelect

/**
 * Service inséré directement. Les défauts respectent les CHECK de la migration 0010 :
 * rendez-vous gratuit de 30 minutes, durée renseignée, aucun prix, slug conforme (`service-xxxxxxxx`).
 * Les surcharges peuvent volontairement violer une contrainte (tests des CHECK).
 */
export async function insertService(vitrineId: string, surcharges: Partial<typeof services.$inferInsert> = {}): Promise<ServiceRow> {
  const [ligne] = await db
    .insert(services)
    .values({
      id: randomUUID(),
      vitrineId,
      slug: `service-${randomUUID().slice(0, 8)}`,
      titre: 'Consultation',
      type: 'rdv',
      dureeMin: 30,
      tarif: 'gratuit',
      ...surcharges,
    })
    .returning()
  return ligne
}

/** Service payant complet (rendez-vous de 45 minutes à 15 000 XAF, règlement sur place, avec liste « inclus »). */
export async function insertServiceComplet(vitrineId: string, surcharges: Partial<typeof services.$inferInsert> = {}): Promise<ServiceRow> {
  return insertService(vitrineId, {
    titre: 'Consultation de cardiologie',
    description: 'Un bilan complet de votre santé cardiaque.',
    dureeMin: 45,
    tarif: 'payant',
    prixMontant: 15000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    paiementInstructions: 'Règlement en espèces ou par Mobile Money.',
    inclus: ['Examen clinique', 'Électrocardiogramme', 'Compte rendu écrit'],
    ...surcharges,
  })
}

export type RealisationRow = typeof realisations.$inferSelect
export type RealisationImageRow = typeof realisationImages.$inferSelect

/**
 * Réalisation insérée directement et RENVOYÉE. Les défauts respectent les CHECK de la migration 0011 :
 * slug conforme (`realisation-xxxxxxxx`), ordre 0, visible, hors vedette, sans image principale.
 * Les surcharges peuvent volontairement violer une contrainte (tests des CHECK).
 */
export async function insertRealisation(vitrineId: string, surcharges: Partial<typeof realisations.$inferInsert> = {}): Promise<RealisationRow> {
  const [ligne] = await db
    .insert(realisations)
    .values({
      id: randomUUID(),
      vitrineId,
      slug: `realisation-${randomUUID().slice(0, 8)}`,
      titre: 'Une réalisation',
      ...surcharges,
    })
    .returning()
  return ligne
}

/** Image de galerie insérée directement (identifiant UUID, `ordre` de 0 à 5 garanti par la base). */
export async function insertRealisationImage(realisationId: string, mediaId: string, ordre: number): Promise<RealisationImageRow> {
  const [ligne] = await db.insert(realisationImages).values({ id: randomUUID(), realisationId, mediaId, ordre }).returning()
  return ligne
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

export async function insertLien(vitrineId: string, surcharges: Partial<typeof liens.$inferInsert> = {}): Promise<typeof liens.$inferSelect> {
  const [ligne] = await db
    .insert(liens)
    .values({
      id: randomUUID(),
      vitrineId,
      slug: `lien-${randomUUID()}`,
      libelle: 'Mon site',
      url: 'https://exemple.com',
      type: 'libre',
      ...surcharges,
    })
    .returning()
  return ligne
}

// ---------------------------------------------------------------------------------------------
// S8 : prompts IA, générations, progression de l'inscription (insertions directes).
// ---------------------------------------------------------------------------------------------

export type PromptIaRow = typeof promptsIa.$inferSelect
export type GenerationIaRow = typeof generationsIa.$inferSelect
export type ProgressionRow = typeof progressionsInscription.$inferSelect

/** Empreinte hexadécimale valide (64 caractères) pour les générations insérées à la main. */
export function empreinteDeTest(graine: string = randomUUID()): string {
  return createHash('sha256').update(graine).digest('hex')
}

/**
 * Prompt inséré directement. `prompts_ia` n'est PAS vidée entre les tests (elle ne dépend d'aucun utilisateur,
 * et les versions 1 viennent de la migration) : tout prompt ajouté ici doit être supprimé par le test.
 * Défauts : type `ameliorer_texte`, version 900 (loin des versions réelles), inactif.
 */
export async function insertPromptIa(surcharges: Partial<typeof promptsIa.$inferInsert> = {}): Promise<PromptIaRow> {
  const [ligne] = await db
    .insert(promptsIa)
    .values({
      id: randomUUID(),
      type: 'ameliorer_texte',
      version: 900,
      systeme: 'Système de test.',
      gabarit: 'Gabarit de test <donnees>{{donnees}}</donnees>',
      variables: ['donnees'],
      parametres: { temperature: 0.4, maxTokens: 900 },
      schemaSortie: 'texte_ameliore_v1',
      actif: false,
      ...surcharges,
    })
    .returning()
  return ligne
}

/** Version active d'un prompt, telle que la migration 0018 l'a insérée. */
export async function activePromptRow(type: 'onboarding_vitrine' | 'ameliorer_texte'): Promise<PromptIaRow> {
  const [ligne] = await db.select().from(promptsIa).where(and(eq(promptsIa.type, type), eq(promptsIa.actif, true)))
  if (!ligne) throw new Error(`Aucun prompt actif pour ${type} : la migration 0018 doit les insérer.`)
  return ligne
}

/**
 * Génération insérée directement, par défaut : `onboarding_vitrine` en attente, prompt actif, entrée de
 * démonstration, créée maintenant. Les surcharges peuvent volontairement violer une contrainte (tests des CHECK)
 * et doivent fournir motif / terminee_le pour les statuts terminaux.
 */
export async function insertGeneration(userId: string, surcharges: Partial<typeof generationsIa.$inferInsert> = {}): Promise<GenerationIaRow> {
  const type = surcharges.type ?? 'onboarding_vitrine'
  const promptId = surcharges.promptId === undefined ? (await activePromptRow(type)).id : surcharges.promptId
  const [ligne] = await db
    .insert(generationsIa)
    .values({
      id: randomUUID(),
      userId,
      type,
      statut: 'en_attente',
      promptId,
      entreeEmpreinte: empreinteDeTest(),
      entree: { titre: 'Dr', metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'Cameroun' },
      ...surcharges,
    })
    .returning()
  return ligne
}

/**
 * Progression d'inscription insérée directement. Par défaut : identité de démonstration complète
 * (dr, Cabrel, Nguesso, Cardiologue interventionnel, Douala, CM), rien d'autre. Passer `null` vide une colonne.
 */
export async function insertProgression(userId: string, surcharges: Partial<typeof progressionsInscription.$inferInsert> = {}): Promise<ProgressionRow> {
  const [ligne] = await db
    .insert(progressionsInscription)
    .values({
      userId,
      titre: 'dr',
      prenom: 'Cabrel',
      nom: 'Nguesso',
      metier: 'Cardiologue interventionnel',
      ville: 'Douala',
      pays: 'CM',
      ...surcharges,
    })
    .returning()
  return ligne
}
