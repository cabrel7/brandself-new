import { desc, sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, pgTable, text, time, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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

// Une image = une ligne medias, jamais un chemin dans une autre table.
// Stockage sur disque local (unstorage), prêt pour S3/R2 plus tard.
// `chemin` = clé de stockage relative `{userId}/{mediaId}` ; `mime` toujours `image/webp` ;
// `largeur`/`hauteur` = variante 1600 après rotation EXIF. Déclarée avant vitrines (FK photo_media_id).
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
  (table) => [
    index('medias_user_id_idx').on(table.userId),
    check('medias_taille_check', sql`${table.taille} > 0`),
  ],
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
    titre: text('titre'),
    prenom: text('prenom').notNull(),
    nom: text('nom').notNull(),
    metier: text('metier').notNull(),
    ville: text('ville'),
    pays: text('pays'),
    accroche: text('accroche'),
    bio: text('bio'),
    photoMediaId: text('photo_media_id').references(() => medias.id, { onDelete: 'set null' }),
    emailContact: text('email_contact'),
    telephone: text('telephone'),
    whatsapp: text('whatsapp'),
    palette: text('palette').notNull().default('terracotta'),
    seoTitre: text('seo_titre'),
    seoDescription: text('seo_description'),
    sectionsMasquees: text('sections_masquees').array().notNull().default([]),
    fuseau: text('fuseau').notNull().default('Africa/Douala'),
    pasCreneauMin: integer('pas_creneau_min').notNull().default(30),
    preavisHeures: integer('preavis_heures').notNull().default(2),
    horizonJours: integer('horizon_jours').notNull().default(60),
    publieeLe: timestamp('publiee_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vitrines_photo_media_id_idx').on(table.photoMediaId),
    // Les listes ci-dessous sont recopiées en dur : la source côté application est
    // shared/palettes.ts (PALETTES) et shared/vitrine.ts (TITRES). Garder les trois synchronisées.
    check('vitrines_titre_check', sql`${table.titre} IS NULL OR ${table.titre} IN ('dr','pr','me','m','mme')`),
    check('vitrines_pays_check', sql`${table.pays} IS NULL OR ${table.pays} ~ '^[A-Z]{2}$'`),
    check(
      'vitrines_palette_check',
      sql`${table.palette} IN ('terracotta','sauge','indigo','ocre','bordeaux')`,
    ),
    check(
      'vitrines_username_format_check',
      sql`char_length(${table.username}) BETWEEN 3 AND 30 AND ${table.username} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('vitrines_pas_creneau_min_check', sql`${table.pasCreneauMin} IN (15, 30, 60)`),
    check('vitrines_preavis_heures_check', sql`${table.preavisHeures} BETWEEN 0 AND 720`),
    check('vitrines_horizon_jours_check', sql`${table.horizonJours} BETWEEN 1 AND 365`),
  ],
)

// Un service proposé par une vitrine (rendez-vous, accompagnement, atelier, devis).
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
// Les règles métier (S3, docs/specs/S3-services.md §5) sont doublées par des CHECK : la base refuse
// un état incohérent même si le code applicatif est contourné. Les listes de valeurs sont recopiées
// en dur ; leur source côté application est shared/services.ts (types, tarifs, paiements, rythmes,
// bornes) et shared/compte.ts (devises). Garder les deux synchronisées.
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
    imageMediaId: text('image_media_id').references(() => medias.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // rdv | accompagnement | atelier | devis
    nbSeances: integer('nb_seances'),
    rythme: text('rythme'), // hebdomadaire | bimensuel | mensuel | libre
    dureeMin: integer('duree_min'), // facultative pour le type devis seulement
    tarif: text('tarif').notNull(), // gratuit | payant | devis
    prixMontant: integer('prix_montant'), // unité mineure de la devise (XAF : francs, EUR/USD : centimes)
    prixDevise: text('prix_devise'),
    paiementMode: text('paiement_mode'), // en_ligne | sur_place | au_choix
    paiementInstructions: text('paiement_instructions'),
    inclus: text('inclus').array().notNull().default([]),
    reservable: boolean('reservable').notNull().default(true),
    enVedette: boolean('en_vedette').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité PAR vitrine ; sert aussi les recherches par vitrine_id (préfixe de l'index).
    uniqueIndex('services_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    index('services_image_media_id_idx').on(table.imageMediaId),
    check('services_type_check', sql`${table.type} IN ('rdv','accompagnement','atelier','devis')`),
    check('services_tarif_check', sql`${table.tarif} IN ('gratuit','payant','devis')`),
    check(
      'services_paiement_mode_check',
      sql`${table.paiementMode} IS NULL OR ${table.paiementMode} IN ('en_ligne','sur_place','au_choix')`,
    ),
    check(
      'services_rythme_check',
      sql`${table.rythme} IS NULL OR ${table.rythme} IN ('hebdomadaire','bimensuel','mensuel','libre')`,
    ),
    check(
      'services_prix_devise_check',
      sql`${table.prixDevise} IS NULL OR ${table.prixDevise} IN ('XAF','EUR','USD')`,
    ),
    check(
      'services_prix_montant_check',
      sql`${table.prixMontant} IS NULL OR ${table.prixMontant} BETWEEN 1 AND 1000000000`,
    ),
    check('services_duree_min_check', sql`${table.dureeMin} IS NULL OR ${table.dureeMin} BETWEEN 5 AND 1440`),
    check('services_nb_seances_check', sql`${table.nbSeances} IS NULL OR ${table.nbSeances} BETWEEN 2 AND 52`),
    check('services_ordre_check', sql`${table.ordre} >= 0`),
    check(
      'services_slug_format_check',
      sql`char_length(${table.slug}) BETWEEN 1 AND 80 AND ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('services_inclus_check', sql`cardinality(${table.inclus}) <= 12`),
    check('services_duree_requise_check', sql`${table.type} = 'devis' OR ${table.dureeMin} IS NOT NULL`),
    check(
      'services_seances_type_check',
      sql`(${table.type} = 'accompagnement') = (${table.nbSeances} IS NOT NULL)`,
    ),
    check('services_rythme_type_check', sql`${table.rythme} IS NULL OR ${table.type} = 'accompagnement'`),
    check('services_devis_tarif_check', sql`${table.type} <> 'devis' OR ${table.tarif} = 'devis'`),
    check(
      'services_prix_tarif_check',
      sql`(${table.tarif} = 'payant') = (${table.prixMontant} IS NOT NULL AND ${table.prixDevise} IS NOT NULL)`,
    ),
    check('services_paiement_tarif_check', sql`(${table.tarif} = 'payant') = (${table.paiementMode} IS NOT NULL)`),
    check('services_vedette_actif_check', sql`NOT ${table.enVedette} OR ${table.actif}`),
  ],
)

// Une réalisation publiée sur une vitrine (projet, oeuvre, expérience...).
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
// Les règles structurelles et de sécurité (S4, docs/specs/S4-realisations.md §3) sont doublées par des
// CHECK : la base refuse un état incohérent même si le code applicatif est contourné. Les bornes sont
// recopiées en dur ; leur source côté application est shared/realisations.ts (ANNEE_MIN/MAX,
// REALISATION_LIEN_MAX) et shared/listes.ts (LISTE_SLUG_MAX, LISTE_SLUG_REGEX). Garder les synchronisées.
// L'image principale est facultative en base (FK SET NULL : la route médias peut supprimer l'image) ;
// l'obligation à la création est une règle applicative.
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
    imageMediaId: text('image_media_id').references(() => medias.id, { onDelete: 'set null' }),
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
    // Unicité PAR vitrine ; sert aussi les recherches par vitrine_id (préfixe de l'index).
    uniqueIndex('realisations_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    index('realisations_image_media_id_idx').on(table.imageMediaId),
    check(
      'realisations_slug_format_check',
      sql`char_length(${table.slug}) BETWEEN 1 AND 80 AND ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('realisations_annee_check', sql`${table.annee} IS NULL OR ${table.annee} BETWEEN 1900 AND 2100`),
    // http(s) seulement : un `javascript:` dans un href public serait un vecteur XSS.
    check(
      'realisations_lien_check',
      sql`${table.lien} IS NULL OR (char_length(${table.lien}) <= 500 AND ${table.lien} ~* '^https?://')`,
    ),
    check('realisations_ordre_check', sql`${table.ordre} >= 0`),
    check('realisations_vedette_actif_check', sql`NOT ${table.enVedette} OR ${table.actif}`),
  ],
)

// Galerie d'une réalisation : 6 images au plus, garanti en base par ordre ∈ [0,5] + unicité
// (realisation_id, ordre) — pas de trigger. Une image = une ligne medias (jamais un chemin).
// media_id CASCADE : supprimer un média retire la vignette sans trou ; la protection contre une
// suppression involontaire est assurée par deleteMediaIfUnreferenced (qui connaît cette table).
export const realisationImages = pgTable(
  'realisation_images',
  {
    id: text('id').primaryKey(),
    realisationId: text('realisation_id')
      .notNull()
      .references(() => realisations.id, { onDelete: 'cascade' }),
    mediaId: text('media_id')
      .notNull()
      .references(() => medias.id, { onDelete: 'cascade' }),
    ordre: integer('ordre').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('realisation_images_realisation_id_ordre_unique').on(table.realisationId, table.ordre),
    uniqueIndex('realisation_images_realisation_id_media_id_unique').on(table.realisationId, table.mediaId),
    index('realisation_images_media_id_idx').on(table.mediaId),
    check('realisation_images_ordre_check', sql`${table.ordre} BETWEEN 0 AND 5`),
  ],
)

// Un témoignage publié sur une vitrine.
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
export const temoignages = pgTable(
  'temoignages',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    auteur: text('auteur').notNull(),
    fonction: text('fonction'),
    texte: text('texte').notNull(),
    enVedette: boolean('en_vedette').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('temoignages_vitrine_id_idx').on(table.vitrineId),
    uniqueIndex('temoignages_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    index('temoignages_actif_idx').on(table.actif),
  ],
)

// Un lien publié sur une vitrine (site externe, WhatsApp, email, téléphone, autre vitrine...).
// Les colonnes sont en français sans accents (PROJECT_CONTEXT.md §11).
// `clics` compte tous les clics ; `clics_semaine` est remis à zéro au premier clic d'une
// nouvelle semaine (repère : `semaine_debut`, lundi ISO — migration 0012, S6).
export const liens = pgTable(
  'liens',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    libelle: text('libelle').notNull(),
    url: text('url').notNull(),
    type: text('type').notNull(), // libre | whatsapp | reseau | email | telephone | vitrine
    ordre: integer('ordre').notNull().default(0),
    clics: integer('clics').notNull().default(0),
    clicsSemaine: integer('clics_semaine').notNull().default(0),
    semaineDebut: date('semaine_debut', { mode: 'string' }).notNull().default(sql`CURRENT_DATE`),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('liens_vitrine_id_idx').on(table.vitrineId),
    // Slug unique PAR VITRINE (comme services/réalisations) : les slugs publics
    // sont toujours scopés par username (`/[username]/liens/[slug]`), un slug
    // identique sur deux vitrines est donc légitime.
    uniqueIndex('liens_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    index('liens_actif_idx').on(table.actif),
  ],
)

// S7 : plages hebdomadaires locales. Une plage ne traverse jamais minuit ; les chevauchements
// sont refusés par le service lors du remplacement atomique du planning.
export const disponibilites = pgTable(
  'disponibilites',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    jourSemaine: integer('jour_semaine').notNull(),
    debut: time('debut').notNull(),
    fin: time('fin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('disponibilites_vitrine_id_jour_idx').on(table.vitrineId, table.jourSemaine, table.debut),
    check('disponibilites_jour_semaine_check', sql`${table.jourSemaine} BETWEEN 1 AND 7`),
    check('disponibilites_plage_check', sql`${table.debut} < ${table.fin}`),
  ],
)

// Une indisponibilité retire toute la date locale dans le fuseau de la vitrine.
export const indisponibilites = pgTable(
  'indisponibilites',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    raison: text('raison'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('indisponibilites_vitrine_id_date_unique').on(table.vitrineId, table.date),
    check('indisponibilites_raison_check', sql`${table.raison} IS NULL OR char_length(${table.raison}) <= 200`),
  ],
)

// Le jeton de confirmation n'est jamais persisté en clair. L'exclusion GiST des plages actives
// est ajoutée par le SQL de 0015, Drizzle ne sachant pas exprimer une contrainte EXCLUDE partielle.
export const reservations = pgTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    nom: text('nom').notNull(),
    email: text('email').notNull(),
    telephone: text('telephone').notNull(),
    note: text('note'),
    motifAnnulation: text('motif_annulation'),
    debut: timestamp('debut', { withTimezone: true }).notNull(),
    fin: timestamp('fin', { withTimezone: true }).notNull(),
    statut: text('statut').notNull().default('en_attente'),
    paiementChoisi: text('paiement_choisi').notNull().default('sur_place'),
    paiementStatut: text('paiement_statut').notNull().default('non_requis'),
    rappelEmail: boolean('rappel_email').notNull().default(false),
    confirmationTokenHash: text('confirmation_token_hash').notNull(),
    confirmationExpireLe: timestamp('confirmation_expire_le', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reservations_vitrine_id_debut_idx').on(table.vitrineId, table.debut),
    index('reservations_service_id_idx').on(table.serviceId),
    index('reservations_vitrine_id_statut_idx').on(table.vitrineId, table.statut),
    uniqueIndex('reservations_confirmation_token_hash_unique').on(table.confirmationTokenHash),
    check('reservations_plage_check', sql`${table.debut} < ${table.fin}`),
    check('reservations_statut_check', sql`${table.statut} IN ('en_attente', 'confirmee', 'annulee', 'terminee', 'refusee')`),
    check('reservations_paiement_choisi_check', sql`${table.paiementChoisi} = 'sur_place'`),
    check('reservations_paiement_statut_check', sql`${table.paiementStatut} = 'non_requis'`),
    check('reservations_note_check', sql`${table.note} IS NULL OR char_length(${table.note}) <= 1000`),
    check(
      'reservations_motif_annulation_check',
      sql`${table.motifAnnulation} IS NULL OR char_length(${table.motifAnnulation}) <= 1000`,
    ),
    check('reservations_confirmation_hash_check', sql`${table.confirmationTokenHash} ~ '^[a-f0-9]{64}$'`),
  ],
)

export const demandes = pgTable(
  'demandes',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    nom: text('nom').notNull(),
    email: text('email').notNull(),
    telephone: text('telephone').notNull(),
    message: text('message'),
    statut: text('statut').notNull().default('nouvelle'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('demandes_vitrine_id_created_at_idx').on(table.vitrineId, table.createdAt),
    index('demandes_service_id_idx').on(table.serviceId),
    index('demandes_vitrine_id_statut_idx').on(table.vitrineId, table.statut),
    check('demandes_statut_check', sql`${table.statut} IN ('nouvelle', 'en_cours', 'traitee', 'refusee')`),
    check('demandes_message_check', sql`${table.message} IS NULL OR char_length(${table.message}) <= 1000`),
  ],
)

// S7-bis : un message envoyé depuis la page Contact d'une vitrine publiée. Les coordonnées
// du visiteur sont des colonnes typées (jamais du JSON) ; `lu_le` suit le pattern
// `confirmation_expire_le` (date du dépliage au studio, idempotent). La source des sujets
// côté application est shared/message.ts (SUJETS_MESSAGE) ; les bornes sont recopiées en
// dur (CONTACT_NOM_MAX/CONTACT_EMAIL_MAX/MESSAGE_MAX) : garder synchronisées.
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade' }),
    nom: text('nom').notNull(),
    email: text('email').notNull(),
    telephone: text('telephone'),
    sujet: text('sujet').notNull(),
    message: text('message').notNull(),
    luLe: timestamp('lu_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Liste du professionnel, plus récents d'abord ; l'index partiel couvre le compteur de non lus.
    index('messages_vitrine_id_cree_le_idx').on(table.vitrineId, desc(table.createdAt)),
    index('messages_non_lus_idx').on(table.vitrineId, desc(table.createdAt)).where(sql`${table.luLe} IS NULL`),
    check(
      'messages_sujet_check',
      sql`${table.sujet} IN ('question_avant_reservation','demande_information','suivi_reservation','autre')`,
    ),
    check('messages_nom_check', sql`char_length(${table.nom}) BETWEEN 1 AND 120`),
    check('messages_email_check', sql`char_length(${table.email}) <= 254 AND ${table.email} ~ '^\\S+@\\S+'`),
    check('messages_telephone_check', sql`${table.telephone} IS NULL OR ${table.telephone} ~ '^\\+\\d+$'`),
    check('messages_message_check', sql`char_length(${table.message}) BETWEEN 1 AND 1000`),
  ],
)

// Outbox des courriels transactionnels : l'événement est écrit dans la même transaction que
// la réservation ou la demande. Les types sont recopiés depuis shared/jobs.ts.
export const emailsTransactionnels = pgTable(
  'emails_transactionnels',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    entiteType: text('entite_type').notNull(),
    entiteId: text('entite_id').notNull(),
    statut: text('statut').notNull().default('en_attente'),
    tentatives: integer('tentatives').notNull().default(0),
    prochaineTentative: timestamp('prochaine_tentative', { withTimezone: true }).defaultNow(),
    erreurCode: text('erreur_code'),
    envoyeLe: timestamp('envoye_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('emails_transactionnels_entite_evenement_unique').on(
      table.entiteType,
      table.entiteId,
      table.type,
    ),
    index('emails_transactionnels_pending_idx')
      .on(table.prochaineTentative, table.createdAt)
      .where(sql`${table.statut} = 'en_attente'`),
    check(
      'emails_transactionnels_type_check',
      sql`${table.type} IN (
        'reservation_professionnel_nouvelle',
        'reservation_visiteur_recue',
        'reservation_visiteur_confirmee',
        'reservation_visiteur_annulee',
        'reservation_visiteur_refusee',
        'demande_professionnel_nouvelle',
        'demande_visiteur_recue',
        'message_professionnel_nouvelle'
      )`,
    ),
    check(
      'emails_transactionnels_entite_type_check',
      sql`${table.entiteType} IN ('reservation', 'demande', 'message')`,
    ),
    check(
      'emails_transactionnels_entite_coherence_check',
      sql`(${table.entiteType} = 'reservation' AND ${table.type} LIKE 'reservation_%')
        OR (${table.entiteType} = 'demande' AND ${table.type} LIKE 'demande_%')
        OR (${table.entiteType} = 'message' AND ${table.type} LIKE 'message_%')`,
    ),
    check(
      'emails_transactionnels_statut_check',
      sql`${table.statut} IN ('en_attente', 'en_cours', 'envoye', 'echec')`,
    ),
    check(
      'emails_transactionnels_tentatives_check',
      sql`${table.tentatives} BETWEEN 0 AND 5`,
    ),
    check(
      'emails_transactionnels_erreur_code_check',
      sql`${table.erreurCode} IS NULL OR (
        char_length(${table.erreurCode}) BETWEEN 1 AND 64
        AND ${table.erreurCode} ~ '^[A-Z0-9_]+$'
      )`,
    ),
    check(
      'emails_transactionnels_envoye_le_check',
      sql`(${table.statut} = 'envoye') = (${table.envoyeLe} IS NOT NULL)`,
    ),
  ],
)
