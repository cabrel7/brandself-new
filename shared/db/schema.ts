import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// Tables gérées par Better Auth (source des champs : @better-auth/core dist/db/schema).
// Propriétés = noms de modèles Better Auth ; colonnes = français sans accents (PROJECT_CONTEXT.md §11).
// Champs applicatifs supplémentaires : nom, locale, devise, fuseau, email_hebdo.
// Le schéma vit dans shared/ : importé par le serveur, le worker et la configuration Better Auth.

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  phoneNumber: text('telephone'),
  phoneNumberVerified: boolean('telephone_verifie').notNull().default(false),
  nom: text('nom').notNull().default(''),
  locale: text('locale').notNull().default('fr'),
  devise: text('devise').notNull().default('XAF'),
  fuseau: text('fuseau').notNull().default('Africa/Douala'),
  email_hebdo: boolean('email_hebdo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
)

// Une vitrine = un profil public. Une donnée interrogeable est une colonne typée.
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
export const vitrines = pgTable(
  'vitrines',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull().unique(),
    titre: text('titre').notNull(),
    prenom: text('prenom').notNull(),
    nom: text('nom').notNull(),
    metier: text('metier').notNull(),
    ville: text('ville').notNull(),
    pays: text('pays').notNull(),
    accroche: text('accroche'),
    bio: text('bio'),
    photoMediaId: text('photo_media_id'),
    emailContact: text('email_contact'),
    telephone: text('telephone'),
    whatsapp: text('whatsapp'),
    palette: text('palette').notNull().default('terracotta'),
    seoTitre: text('seo_titre'),
    seoDescription: text('seo_description'),
    sectionsMasquees: text('sections_masquees').array().notNull().default([]),
    fuseau: text('fuseau').notNull().default('Africa/Douala'),
    pasCreneauMin: integer('pas_creneau_min').notNull().default(15),
    preavisHeures: integer('preavis_heures').notNull().default(24),
    horizonJours: integer('horizon_jours').notNull().default(30),
    publieeLe: timestamp('publiee_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vitrines_username_idx').on(table.username),
    index('vitrines_user_id_idx').on(table.userId),
  ],
)

// Une image = une ligne medias, jamais un chemin dans une autre table.
// Stockage sur disque local (unstorage), prêt pour S3/R2 plus tard.
export const medias = pgTable(
  'medias',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    disk: text('disk').notNull().default('local'),
    chemin: text('chemin').notNull(),
    mime: text('mime').notNull(),
    taille: integer('taille').notNull(),
    largeur: integer('largeur'),
    hauteur: integer('hauteur'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('medias_user_id_idx').on(table.userId)],
)

// Un service proposé par une vitrine (rendez-vous, accompagnement, atelier, devis).
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
export const services = pgTable(
  'services',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    titre: text('titre').notNull(),
    description: text('description'),
    imageMediaId: text('image_media_id'),
    type: text('type').notNull(), // rdv | accompagnement | atelier | devis
    nbSeances: integer('nb_seances'),
    rythme: text('rythme'),
    dureeMin: integer('duree_min').notNull(),
    tarif: text('tarif').notNull(), // gratuit | payant | devis
    prixMontant: integer('prix_montant'),
    prixDevise: text('prix_devise'),
    paiementMode: text('paiement_mode'), // en_ligne | sur_place | au_choix
    paiementInstructions: text('paiement_instructions'),
    reservable: boolean('reservable').notNull().default(true),
    enVedette: boolean('en_vedette').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('services_vitrine_id_idx').on(table.vitrineId),
    index('services_slug_idx').on(table.slug),
    index('services_actif_idx').on(table.actif),
  ],
)

// Une réalisation publiée sur une vitrine (projet, oeuvre, expérience...).
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
export const realisations = pgTable(
  'realisations',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    titre: text('titre').notNull(),
    description: text('description'),
    imageMediaId: text('image_media_id'),
    annee: integer('annee'),
    lieu: text('lieu'),
    role: text('role'),
    lien: text('lien'),
    enVedette: boolean('en_vedette').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('realisations_vitrine_id_idx').on(table.vitrineId),
    index('realisations_slug_idx').on(table.slug),
    index('realisations_actif_idx').on(table.actif),
  ],
)
