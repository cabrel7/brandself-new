import { desc, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Tables gérées par Better Auth (source des champs : @better-auth/core dist/db/schema).
// Propriétés = noms de modèles Better Auth ; colonnes = français sans accents (PROJECT_CONTEXT.md §11).
// Champs applicatifs supplémentaires : nom, locale, devise, fuseau, email_hebdo, email_rappel_jour.
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
  // S9 (migration 0020) : préférence « rendez-vous du jour » (e-mail du matin au professionnel), désabonnable.
  email_rappel_jour: boolean('email_rappel_jour').notNull().default(true),
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
    // S9 (migration 0020) : étapes de « prochaine étape » ignorées pour toujours (sous-ensemble de NEXT_STEPS) et
    // date du premier partage de la vitrine (le canal n'est pas stocké : minimisation).
    etapesIgnorees: text('etapes_ignorees').array().notNull().default([]),
    partageeLe: timestamp('partagee_le', { withTimezone: true }),
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
    // Liste recopiée depuis NEXT_STEPS (shared/vitrine.ts) : garder synchronisées.
    check(
      'vitrines_etapes_ignorees_check',
      sql`${table.etapesIgnorees} <@ ARRAY['photo','service','disponibilites','realisation','partager']::text[]`,
    ),
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

// Outbox des courriels : l'événement est écrit dans la même transaction que la réservation, la demande ou le
// message ; depuis S9 (migration 0020) elle est aussi le planificateur unique des envois différés
// (`prochaine_tentative` = heure d'envoi) et des e-mails récurrents (`occurrence` = clé d'idempotence métier :
// '' pour les types S7, `debut` en ISO UTC pour le rappel visiteur, `AAAA-MM-JJ` pour le rendez-vous du jour,
// `GGGG-Www` pour le résumé hebdomadaire). `categorie` : le résumé est le seul e-mail `relationnel` (plafonné à
// un par semaine) ; tout le reste est `transactionnel`. Statut `annule` = ligne devenue non pertinente, jamais
// envoyée (`erreur_code` = code d'annulation). Les listes (types, entités, statuts, catégories, types à
// occurrence obligatoire) sont recopiées depuis shared/jobs.ts (TRANSACTIONAL_EMAIL_TYPES) et
// shared/notifications.ts (EMAIL_STATUTS, EMAIL_CATEGORIES) : garder synchronisées.
export const emailsTransactionnels = pgTable(
  'emails_transactionnels',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    entiteType: text('entite_type').notNull(),
    entiteId: text('entite_id').notNull(),
    occurrence: text('occurrence').notNull().default(''),
    categorie: text('categorie').notNull().default('transactionnel'),
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
      table.occurrence,
    ),
    index('emails_transactionnels_pending_idx')
      .on(table.prochaineTentative, table.createdAt)
      .where(sql`${table.statut} = 'en_attente'`),
    // Plafond « un e-mail relationnel par semaine » (S9 §4.3) : lignes relationnelles d'un utilisateur.
    index('emails_transactionnels_relationnel_idx')
      .on(table.entiteId, table.createdAt)
      .where(sql`${table.categorie} = 'relationnel'`),
    // Purge de rétention (job quotidien notifications-purger, S9 #97) : lignes terminales anciennes.
    index('emails_transactionnels_terminal_idx')
      .on(table.updatedAt)
      .where(sql`${table.statut} IN ('envoye','echec','annule')`),
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
        'message_professionnel_nouvelle',
        'reservation_visiteur_rappel',
        'utilisateur_resume_hebdo',
        'utilisateur_rappel_journee'
      )`,
    ),
    check(
      'emails_transactionnels_entite_type_check',
      sql`${table.entiteType} IN ('reservation', 'demande', 'message', 'utilisateur')`,
    ),
    check(
      'emails_transactionnels_entite_coherence_check',
      sql`(${table.entiteType} = 'reservation' AND ${table.type} LIKE 'reservation_%')
        OR (${table.entiteType} = 'demande' AND ${table.type} LIKE 'demande_%')
        OR (${table.entiteType} = 'message' AND ${table.type} LIKE 'message_%')
        OR (${table.entiteType} = 'utilisateur' AND ${table.type} LIKE 'utilisateur_%')`,
    ),
    check(
      'emails_transactionnels_statut_check',
      sql`${table.statut} IN ('en_attente', 'en_cours', 'envoye', 'echec', 'annule')`,
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
    check(
      'emails_transactionnels_categorie_check',
      sql`${table.categorie} IN ('transactionnel', 'relationnel')`,
    ),
    // Le résumé hebdomadaire est le seul e-mail relationnel, et réciproquement.
    check(
      'emails_transactionnels_categorie_type_check',
      sql`(${table.type} = 'utilisateur_resume_hebdo') = (${table.categorie} = 'relationnel')`,
    ),
    check(
      'emails_transactionnels_occurrence_check',
      sql`char_length(${table.occurrence}) <= 32 AND ${table.occurrence} ~ '^[0-9A-Z:.-]*$'`,
    ),
    // Un e-mail récurrent ou replanifiable sans clé d'occurrence ne serait plus idempotent.
    check(
      'emails_transactionnels_occurrence_requise_check',
      sql`${table.type} NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee')
        OR ${table.occurrence} <> ''`,
    ),
  ],
)

// S8 (docs/specs/S8-onboarding-ia.md §2, migration 0018) : prompts IA versionnés en base
// (CLAUDE.md §4 règle 6). Une seule version `actif` par type (index unique partiel) ; une nouvelle
// version se publie par une nouvelle migration. `parametres` est un réglage (JSON autorisé) validé par
// Zod au chargement (schemaPromptParametres). `schema_sortie` = identifiant du schéma Zod attendu.
// Les types sont recopiés depuis shared/ia.ts (IA_TYPES) : garder synchronisés.
export const promptsIa = pgTable(
  'prompts_ia',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    systeme: text('systeme').notNull(),
    gabarit: text('gabarit').notNull(),
    variables: text('variables').array().notNull().default([]),
    parametres: jsonb('parametres').notNull().default({}),
    schemaSortie: text('schema_sortie').notNull(),
    actif: boolean('actif').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('prompts_ia_type_version_unique').on(table.type, table.version),
    // Au plus une version active par type : garanti par la base, pas seulement par le code.
    uniqueIndex('prompts_ia_type_actif_unique')
      .on(table.type)
      .where(sql`${table.actif}`),
    check('prompts_ia_type_check', sql`${table.type} IN ('onboarding_vitrine','ameliorer_texte')`),
    check('prompts_ia_version_check', sql`${table.version} >= 1`),
    check('prompts_ia_systeme_check', sql`char_length(${table.systeme}) BETWEEN 1 AND 20000`),
    check('prompts_ia_gabarit_check', sql`char_length(${table.gabarit}) BETWEEN 1 AND 5000`),
    check('prompts_ia_parametres_check', sql`jsonb_typeof(${table.parametres}) = 'object'`),
    check('prompts_ia_schema_sortie_check', sql`${table.schemaSortie} ~ '^[a-z0-9_]{1,60}$'`),
  ],
)

// S8 : une génération IA = une trace (statut, coût, durée) + l'entrée minimisée et la sortie servie
// (IA ou repli). `entree`/`sortie` passent à NULL après IA_RETENTION_JOURS (job ia-purger) ; les
// métadonnées restent (quota, coût). `erreur_code` est un code court : jamais de message brut ni de
// donnée personnelle. Les listes de statuts et de motifs sont recopiées depuis shared/ia.ts
// (GENERATION_STATUTS, MOTIFS_REPLI) : garder synchronisées. `fournisseur` n'est PAS une énumération en base
// (seulement un format, depuis 0019) : ajouter un fournisseur (IA_FOURNISSEURS dans shared/ia.ts) ne demande
// aucune migration.
// `entree` et `sortie` sont du JSON non typé : ils sont toujours relus via un schéma Zod.
export const generationsIa = pgTable(
  'generations_ia',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    statut: text('statut').notNull().default('en_attente'),
    motifRepli: text('motif_repli'),
    promptId: text('prompt_id').references(() => promptsIa.id, { onDelete: 'restrict' }),
    fournisseur: text('fournisseur'),
    modele: text('modele'),
    tentatives: smallint('tentatives').notNull().default(0),
    tokensEntree: integer('tokens_entree'),
    tokensSortie: integer('tokens_sortie'),
    dureeMs: integer('duree_ms'),
    erreurCode: text('erreur_code'),
    injectionSuspectee: boolean('injection_suspectee').notNull().default(false),
    entreeEmpreinte: text('entree_empreinte').notNull(),
    entree: jsonb('entree'),
    sortie: jsonb('sortie'),
    demarreeLe: timestamp('demarree_le', { withTimezone: true }),
    termineeLe: timestamp('terminee_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Quota mensuel et liste d'un utilisateur.
    index('generations_ia_user_created_idx').on(table.userId, desc(table.createdAt)),
    // Dédoublonnage : même identité + même prompt = même génération.
    index('generations_ia_dedoublonnage_idx').on(table.userId, table.type, table.entreeEmpreinte),
    // Générations non terminées (suivi des tâches perdues).
    index('generations_ia_actives_idx')
      .on(table.createdAt)
      .where(sql`${table.statut} IN ('en_attente','en_cours')`),
    // Purge de rétention (job quotidien).
    index('generations_ia_a_purger_idx')
      .on(table.createdAt)
      .where(sql`${table.entree} IS NOT NULL OR ${table.sortie} IS NOT NULL`),
    check('generations_ia_type_check', sql`${table.type} IN ('onboarding_vitrine','ameliorer_texte')`),
    check(
      'generations_ia_statut_check',
      sql`${table.statut} IN ('en_attente','en_cours','terminee','repli','expiree')`,
    ),
    check(
      'generations_ia_motif_check',
      sql`${table.motifRepli} IS NULL OR ${table.motifRepli} IN (
        'echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur',
        'sans_prompt','file_indisponible','limiteur_indisponible','plafond_global')`,
    ),
    check('generations_ia_motif_coherence_check', sql`(${table.statut} = 'repli') = (${table.motifRepli} IS NOT NULL)`),
    check(
      'generations_ia_terminee_check',
      sql`${table.statut} IN ('en_attente','en_cours') OR ${table.termineeLe} IS NOT NULL`,
    ),
    check(
      'generations_ia_fournisseur_check',
      sql`${table.fournisseur} IS NULL OR ${table.fournisseur} ~ '^[a-z0-9_-]{1,40}$'`,
    ),
    check('generations_ia_modele_check', sql`${table.modele} IS NULL OR char_length(${table.modele}) <= 100`),
    check('generations_ia_tentatives_check', sql`${table.tentatives} BETWEEN 0 AND 10`),
    check(
      'generations_ia_tokens_check',
      sql`coalesce(${table.tokensEntree},0) >= 0 AND coalesce(${table.tokensSortie},0) >= 0`,
    ),
    check('generations_ia_duree_check', sql`${table.dureeMs} IS NULL OR ${table.dureeMs} >= 0`),
    check(
      'generations_ia_erreur_code_check',
      sql`${table.erreurCode} IS NULL OR ${table.erreurCode} ~ '^[a-z_]{1,40}$'`,
    ),
    check('generations_ia_empreinte_check', sql`${table.entreeEmpreinte} ~ '^[0-9a-f]{64}$'`),
  ],
)

// S8 : brouillon de l'inscription guidée, une ligne par utilisateur (PK = user_id). Une vitrine ne peut
// pas exister avant l'étape 4 (username NOT NULL UNIQUE) : le brouillon vit ici, sans squatter d'adresse.
// L'étape de reprise n'est PAS stockée, elle se déduit des données (computeEtapeReprise). Seule la liste
// des 3 services proposés est en JSON (brouillon, jamais interrogé). Photo = ligne `medias` (règle 4).
// Les bornes (60, 80, 160, 2000, titres, pays) sont recopiées depuis shared/vitrine.ts : garder synchronisées.
export const progressionsInscription = pgTable(
  'progressions_inscription',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    titre: text('titre'),
    prenom: text('prenom'),
    nom: text('nom'),
    metier: text('metier'),
    ville: text('ville'),
    pays: text('pays'),
    photoMediaId: text('photo_media_id').references(() => medias.id, { onDelete: 'set null' }),
    generationId: text('generation_id').references(() => generationsIa.id, { onDelete: 'set null' }),
    accroche: text('accroche'),
    presentation: text('presentation'),
    servicesProposes: jsonb('services_proposes'), // [{titre, description, type, dureeMin, nbSeances, actif}] (≤ 3)
    propositionValideeLe: timestamp('proposition_validee_le', { withTimezone: true }),
    termineLe: timestamp('termine_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FK parcourues à la suppression d'un média (deleteMediaIfUnreferenced) ou d'une génération.
    index('progressions_inscription_photo_media_id_idx').on(table.photoMediaId),
    index('progressions_inscription_generation_id_idx').on(table.generationId),
    check(
      'progressions_inscription_titre_check',
      sql`${table.titre} IS NULL OR ${table.titre} IN ('dr','pr','me','m','mme')`,
    ),
    check('progressions_inscription_pays_check', sql`${table.pays} IS NULL OR ${table.pays} ~ '^[A-Z]{2}$'`),
    check(
      'progressions_inscription_longueurs_check',
      sql`coalesce(char_length(${table.prenom}),0) <= 60 AND coalesce(char_length(${table.nom}),0) <= 60
        AND coalesce(char_length(${table.metier}),0) <= 80 AND coalesce(char_length(${table.ville}),0) <= 80
        AND coalesce(char_length(${table.accroche}),0) <= 160 AND coalesce(char_length(${table.presentation}),0) <= 2000`,
    ),
    check(
      'progressions_inscription_services_check',
      sql`${table.servicesProposes} IS NULL
        OR (jsonb_typeof(${table.servicesProposes}) = 'array' AND jsonb_array_length(${table.servicesProposes}) <= 3)`,
    ),
    check(
      'progressions_inscription_validation_check',
      sql`${table.propositionValideeLe} IS NULL
        OR (${table.accroche} IS NOT NULL AND ${table.presentation} IS NOT NULL AND ${table.servicesProposes} IS NOT NULL)`,
    ),
  ],
)

export type PromptIa = typeof promptsIa.$inferSelect
export type NewPromptIa = typeof promptsIa.$inferInsert
export type GenerationIa = typeof generationsIa.$inferSelect
export type NewGenerationIa = typeof generationsIa.$inferInsert
export type ProgressionInscription = typeof progressionsInscription.$inferSelect
export type NewProgressionInscription = typeof progressionsInscription.$inferInsert
