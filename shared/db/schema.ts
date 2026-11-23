import { desc, sql } from 'drizzle-orm'
import {
  bigint,
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
  unique,
  uniqueIndex,
  primaryKey,
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
  // A1 (migration 0028) : plugin admin() de Better Auth. Les PROPRIÉTÉS (role, banned, banReason,
  // banExpires) sont les noms de champs du plugin (node_modules/better-auth/dist/plugins/admin/schema.mjs,
  // exigés par l'adaptateur Drizzle) ; les colonnes SQL sont en français. `role` ∈ {'user','superadmin'}
  // (CHECK) ; la source des valeurs côté application est shared/admin.ts. `banned` = compte suspendu.
  role: text('role').notNull().default('user'),
  banned: boolean('suspendu').notNull().default(false),
  banReason: text('motif_suspension'),
  banExpires: timestamp('suspension_fin', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('users_role_check', sql`${table.role} IN ('user','superadmin')`),
  // Index partiel : ne contient que les comptes privilégiés (quelques lignes). Requête réelle :
  // « liste des superadmins » (requireSuperadmin, sendVerificationOTP de l'hôte admin, admin:reinitialiser).
  index('users_role_privilegie_idx').on(table.role).where(sql`${table.role} <> 'user'`),
  // A2 (migration 0029, docs/specs/A2-utilisateurs-vitrines.md §3). Requêtes réelles de la liste des comptes :
  // filtre « suspendus » (index partiel : quelques lignes), tri par défaut « plus récents d'abord », recherche
  // par numéro de téléphone (égalité sur les chiffres, D-A2-11 ; partiel : la colonne est facultative).
  index('users_suspendu_idx').on(table.banned).where(sql`${table.banned}`),
  index('users_cree_le_idx').on(desc(table.createdAt)),
  index('users_telephone_idx').on(table.phoneNumber).where(sql`${table.phoneNumber} IS NOT NULL`),
])

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
    // A1 (migration 0028). `impersonatedBy` : champ du plugin admin() ; l'impersonation est INTERDITE
    // (CHECK sessions_sans_incarnation_check : toujours NULL). `admin` : session ouverte sur l'hôte
    // d'administration (durée absolue 8 h imposée par la garde, voir docs/specs/A1-socle-admin.md D-A1-05).
    impersonatedBy: text('incarne_par'),
    admin: boolean('admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
    check('sessions_sans_incarnation_check', sql`${table.impersonatedBy} IS NULL`),
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
    // Migration 0027 : proposition SEO générée par l'IA, stockée à part des champs saisis (seo_titre/seo_description
    // restent la saisie manuelle et gagnent toujours). `seo_ia_signature` = empreinte SHA-256 (hex) des données
    // d'entrée qui ont produit la proposition ; `seo_ia_genere_le` = date de génération. Les quatre colonnes sont
    // soit toutes NULL, soit signature + date renseignées (titre et description pouvant manquer isolément).
    seoIaTitre: text('seo_ia_titre'),
    seoIaDescription: text('seo_ia_description'),
    seoIaSignature: text('seo_ia_signature'),
    seoIaGenereLe: timestamp('seo_ia_genere_le', { withTimezone: true }),
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
    // A2 (migration 0029, D-A2-02) : dépublication par l'administration. `publiee_le` est CONSERVÉE : republier
    // = remettre `blocage_admin` à false. Le motif (5-500) est affiché au professionnel, jamais au visiteur.
    blocageAdmin: boolean('blocage_admin').notNull().default(false),
    blocageMotif: text('blocage_motif'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vitrines_photo_media_id_idx').on(table.photoMediaId),
    // A2 : liste « vitrines bloquées » de l'administration (index partiel : quelques lignes).
    index('vitrines_blocage_idx').on(table.blocageAdmin).where(sql`${table.blocageAdmin}`),
    // A2 : bornes du motif recopiées de shared/admin.ts (motif 5-500) : garder synchronisées. `IS NOT NULL` est
    // indispensable (ÉCART DE LA SPEC §3, voir rapport) : sans lui, char_length(btrim(NULL)) BETWEEN ... vaut NULL et un
    // CHECK à NULL est ACCEPTÉ par PostgreSQL : une vitrine bloquée SANS motif passerait.
    check(
      'vitrines_blocage_check',
      sql`(${table.blocageAdmin} = false AND ${table.blocageMotif} IS NULL)
        OR (${table.blocageAdmin} = true AND ${table.blocageMotif} IS NOT NULL
          AND char_length(btrim(${table.blocageMotif})) BETWEEN 5 AND 500)`,
    ),
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
    // Migration 0027 : bornes de la proposition SEO IA (titre 10-50, description 50-160, signature SHA-256 hex).
    check(
      'vitrines_seo_ia_titre_check',
      sql`${table.seoIaTitre} IS NULL OR char_length(${table.seoIaTitre}) BETWEEN 10 AND 50`,
    ),
    check(
      'vitrines_seo_ia_description_check',
      sql`${table.seoIaDescription} IS NULL OR char_length(${table.seoIaDescription}) BETWEEN 50 AND 160`,
    ),
    check(
      'vitrines_seo_ia_signature_check',
      sql`${table.seoIaSignature} IS NULL OR ${table.seoIaSignature} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'vitrines_seo_ia_coherence_check',
      sql`(${table.seoIaSignature} IS NULL) = (${table.seoIaGenereLe} IS NULL) AND (${table.seoIaSignature} IS NOT NULL OR (${table.seoIaTitre} IS NULL AND ${table.seoIaDescription} IS NULL))`,
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
    // S16 : origine du contenu — 'utilisateur' (studio) ou 'assistant' (MCP). Un contenu créé par
    // un assistant est brouillon (actif = false) et ne peut pas être publié via le MCP.
    source: text('source').notNull().default('utilisateur'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité PAR vitrine ; sert aussi les recherches par vitrine_id (préfixe de l'index).
    uniqueIndex('services_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    check('services_source_check', sql`${table.source} IN ('utilisateur','assistant')`),
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
    // S16 : origine du contenu — 'utilisateur' (studio) ou 'assistant' (MCP). Une réalisation créée
    // par un assistant sans image principale est brouillon et ne peut pas être activée.
    source: text('source').notNull().default('utilisateur'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité PAR vitrine ; sert aussi les recherches par vitrine_id (préfixe de l'index).
    uniqueIndex('realisations_vitrine_id_slug_unique').on(table.vitrineId, table.slug),
    check('realisations_source_check', sql`${table.source} IN ('utilisateur','assistant')`),
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
// `GGGG-Www` pour le résumé hebdomadaire). `categorie` : le résumé et les deux relances de l'essai gratuit (E1,
// migration 0036 : `abonnement_essai_services`, `abonnement_essai_statistiques`) sont les seuls e-mails `relationnel`
// (désabonnables, préférence `email_hebdo`) ; tout le reste est `transactionnel`. Statut `annule` = ligne devenue non pertinente, jamais
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
        'utilisateur_rappel_journee',
        'abonnement_rappel',
        'paiement_confirme',
        'utilisateur_suspendu',
        'utilisateur_reactive',
        'utilisateur_jours_offerts',
        'utilisateur_depubliee',
        'abonnement_essai_services',
        'abonnement_essai_statistiques'
      )`,
    ),
    check(
      'emails_transactionnels_entite_type_check',
      sql`${table.entiteType} IN ('reservation', 'demande', 'message', 'utilisateur', 'abonnement', 'paiement')`,
    ),
    check(
      'emails_transactionnels_entite_coherence_check',
      sql`(${table.entiteType} = 'reservation' AND ${table.type} LIKE 'reservation_%')
        OR (${table.entiteType} = 'demande' AND ${table.type} LIKE 'demande_%')
        OR (${table.entiteType} = 'message' AND ${table.type} LIKE 'message_%')
        OR (${table.entiteType} = 'utilisateur' AND ${table.type} LIKE 'utilisateur_%')
        OR (${table.entiteType} = 'abonnement' AND ${table.type} LIKE 'abonnement_%')
        OR (${table.entiteType} = 'paiement' AND ${table.type} LIKE 'paiement_%')`,
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
    // Le résumé hebdomadaire et, depuis E1 (migration 0036), les deux relances de l'essai gratuit sont les seuls
    // e-mails relationnels, et réciproquement (liste recopiée depuis shared/notifications.ts : garder synchronisées).
    check(
      'emails_transactionnels_categorie_type_check',
      sql`(${table.type} IN ('utilisateur_resume_hebdo','abonnement_essai_services','abonnement_essai_statistiques')) = (${table.categorie} = 'relationnel')`,
    ),
    check(
      'emails_transactionnels_occurrence_check',
      sql`char_length(${table.occurrence}) <= 32 AND ${table.occurrence} ~ '^[0-9A-Z:.-]*$'`,
    ),
    // Un e-mail récurrent ou replanifiable sans clé d'occurrence ne serait plus idempotent.
    check(
      'emails_transactionnels_occurrence_requise_check',
      sql`${table.type} NOT IN ('reservation_visiteur_rappel','utilisateur_resume_hebdo','utilisateur_rappel_journee','abonnement_rappel','abonnement_essai_services','abonnement_essai_statistiques')
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
    // A5 (migration 0032, D-A5-09) : pourquoi cette version a été créée et par qui (identifiant d'administrateur,
    // `systeme` pour une migration). Nullables : `cree_par` reste NULL pour l'historique (0018, 0027) ; `motif` y est
    // rempli par la migration. SEULS `actif` (et ces deux colonnes à la création) bougent : un déclencheur de la
    // migration (`prompts_ia_figer`, non généré par drizzle-kit) fige systeme, gabarit, variables, parametres,
    // schema_sortie, type, version et created_at, et interdit la suppression (42501).
    motif: text('motif'),
    creePar: text('cree_par'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('prompts_ia_type_version_unique').on(table.type, table.version),
    // Au plus une version active par type : garanti par la base, pas seulement par le code.
    uniqueIndex('prompts_ia_type_actif_unique')
      .on(table.type)
      .where(sql`${table.actif}`),
    check(
      'prompts_ia_type_check',
      sql`${table.type} IN ('onboarding_vitrine','ameliorer_texte','seo_vitrine')`,
    ),
    check('prompts_ia_version_check', sql`${table.version} >= 1`),
    check('prompts_ia_systeme_check', sql`char_length(${table.systeme}) BETWEEN 1 AND 20000`),
    check('prompts_ia_gabarit_check', sql`char_length(${table.gabarit}) BETWEEN 1 AND 5000`),
    check('prompts_ia_parametres_check', sql`jsonb_typeof(${table.parametres}) = 'object'`),
    check('prompts_ia_schema_sortie_check', sql`${table.schemaSortie} ~ '^[a-z0-9_]{1,60}$'`),
    check('prompts_ia_motif_check', sql`${table.motif} IS NULL OR char_length(btrim(${table.motif})) BETWEEN 5 AND 500`),
    check('prompts_ia_cree_par_check', sql`${table.creePar} IS NULL OR char_length(${table.creePar}) <= 64`),
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
    check(
      'generations_ia_type_check',
      sql`${table.type} IN ('onboarding_vitrine','ameliorer_texte','seo_vitrine')`,
    ),
    check(
      'generations_ia_statut_check',
      sql`${table.statut} IN ('en_attente','en_cours','terminee','repli','expiree')`,
    ),
    check(
      'generations_ia_motif_check',
      sql`${table.motifRepli} IS NULL OR ${table.motifRepli} IN (
        'echec_fournisseur','delai_depasse','sortie_invalide','injection','sans_fournisseur',
        'sans_prompt','file_indisponible','limiteur_indisponible','plafond_global','quota_atteint','ia_coupee')`,
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
// S15 : statistiques d'installation PWA pour le super admin de la plateforme.
// Evenements : proposee / installee / refusee, origine studio ou marketing.
// Pas de donnee personnelle, pas de lien vers une vitrine (plateforme, pas pro).
export const pwaInstallEvents = pgTable('pwa_install_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  origine: text('origine').notNull(),
  deviceType: text('device_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    'pwa_install_events_type_check',
    sql`${table.type} IN ('proposee','installee','refusee')`,
  ),
  check(
    'pwa_install_events_origine_check',
    sql`${table.origine} IN ('studio','marketing')`,
  ),
  check(
    'pwa_install_events_device_type_check',
    sql`${table.deviceType} IN ('mobile','tablette','ordinateur','inconnu')`,
  ),
  index('pwa_install_events_type_origine_idx').on(table.type, table.origine),
  index('pwa_install_events_created_at_idx').on(table.createdAt),
])

export type PwaInstallEvent = typeof pwaInstallEvents.$inferSelect
export type NewPwaInstallEvent = typeof pwaInstallEvents.$inferInsert

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
  ]
)

// S16 : journal des appels d'assistant MCP. Utilisateur, assistant (ID du client MCP), outil,
// résumé des arguments, résultat, avant/après (modifications uniquement), date. Le JSON est admis
// ici uniquement ; aucune autre table n'utilise du JSON pour des données métier.
export const journalAssistant = pgTable('journal_assistant', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  assistantId: text('assistant_id').notNull(),
  outil: text('outil').notNull(),
  argumentsResume: jsonb('arguments_resume').notNull(),
  resultat: jsonb('resultat'),
  avant: jsonb('avant'),
  apres: jsonb('apres'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('journal_assistant_user_id_idx').on(table.userId),
  index('journal_assistant_created_at_idx').on(table.createdAt),
])

// ─── A1 : administration (migration 0028, docs/specs/A1-socle-admin.md §2) ─────────────────────────────────
// Journal des actions du superadmin : AJOUT SEUL et CHAÎNÉ.
// `numero`, `empreinte_precedente`, `empreinte` et `cree_le` sont posés par le déclencheur
// `journal_admin_chainer` (BEFORE INSERT, sous pg_advisory_xact_lock, READ COMMITTED obligatoire) : les
// valeurs par défaut ci-dessous ne sont que des marqueurs de typage (jamais conservés ; `numero` à 0 est
// refusé par le CHECK si le déclencheur manquait). UPDATE, DELETE et TRUNCATE sont refusés (42501) par
// `journal_admin_sans_modif` / `journal_admin_sans_vidage`. Les déclencheurs et fonctions ne sont pas
// générés par drizzle-kit : ils sont écrits à la main dans la migration.
// `avant`/`apres` : objet plat, clés ^[a-z_]+$, valeurs string ≤ 64 | number | boolean | null (validé par le
// service d'audit ; la base garantit seulement le type objet). Aucune donnée personnelle : D-A1-09.
export const journalAdmin = pgTable(
  'journal_admin',
  {
    id: text('id').primaryKey(),
    numero: bigint('numero', { mode: 'number' }).notNull().default(0),
    adminId: text('admin_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    cibleType: text('cible_type').notNull(),
    cibleId: text('cible_id'),
    avant: jsonb('avant'),
    apres: jsonb('apres'),
    motif: text('motif').notNull(),
    ip: text('ip').notNull(),
    cleIdempotence: text('cle_idempotence'),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
    empreintePrecedente: text('empreinte_precedente').notNull().default(sql`repeat('0', 64)`),
    empreinte: text('empreinte').notNull().default(sql`repeat('0', 64)`),
  },
  (table) => [
    unique('journal_admin_numero_unique').on(table.numero),
    unique('journal_admin_empreinte_unique').on(table.empreinte),
    index('journal_admin_cree_le_idx').on(desc(table.creeLe)),
    index('journal_admin_cible_idx').on(table.cibleType, table.cibleId),
    // Requête réelle : contrôle RESTRICT de la clé étrangère à chaque suppression d'un compte, et liste du
    // journal filtrée par administrateur (A5). L'unique partiel ci-dessous ne peut pas servir à cela.
    index('journal_admin_admin_id_idx').on(table.adminId),
    // CA21 : une clé d'idempotence ne rejoue pas la même action pour un même administrateur.
    uniqueIndex('journal_admin_idempotence_unique')
      .on(table.adminId, table.cleIdempotence)
      .where(sql`${table.cleIdempotence} IS NOT NULL`),
    check('journal_admin_numero_check', sql`${table.numero} > 0`),
    check('journal_admin_action_check', sql`${table.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
    check('journal_admin_cible_type_check', sql`${table.cibleType} ~ '^[a-z_]+$'`),
    check('journal_admin_cible_id_check', sql`${table.cibleId} IS NULL OR char_length(${table.cibleId}) <= 64`),
    check('journal_admin_avant_check', sql`${table.avant} IS NULL OR jsonb_typeof(${table.avant}) = 'object'`),
    check('journal_admin_apres_check', sql`${table.apres} IS NULL OR jsonb_typeof(${table.apres}) = 'object'`),
    check('journal_admin_motif_check', sql`char_length(btrim(${table.motif})) BETWEEN 5 AND 500`),
    check('journal_admin_ip_check', sql`char_length(${table.ip}) <= 64`),
    check(
      'journal_admin_cle_idempotence_check',
      sql`${table.cleIdempotence} IS NULL OR char_length(${table.cleIdempotence}) BETWEEN 8 AND 128`,
    ),
    check('journal_admin_empreinte_precedente_check', sql`${table.empreintePrecedente} ~ '^[0-9a-f]{64}$'`),
    check('journal_admin_empreinte_check', sql`${table.empreinte} ~ '^[0-9a-f]{64}$'`),
  ],
)

// Réauthentification d'une action destructrice (D-A1-08) : code à 6 chiffres haché (HMAC-SHA256, secret
// NUXT_BETTER_AUTH_SECRET, jamais le code en clair), 10 min, 3 essais, lié au triplet
// (action, cible_type, cible_id), usage unique (`consomme_le`). Consommé DANS la transaction de l'action.
export const adminReauth = pgTable(
  'admin_reauth',
  {
    id: text('id').primaryKey(),
    adminId: text('admin_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    cibleType: text('cible_type').notNull(),
    cibleId: text('cible_id'),
    codeEmpreinte: text('code_empreinte').notNull(),
    essais: smallint('essais').notNull().default(0),
    expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
    consommeLe: timestamp('consomme_le', { withTimezone: true }),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Requête réelle : recherche de la demande ouverte (admin, triplet) à consommer ou à faire expirer.
    index('admin_reauth_ouvert_idx')
      .on(table.adminId, table.action, table.cibleType, table.cibleId)
      .where(sql`${table.consommeLe} IS NULL`),
    check('admin_reauth_action_check', sql`${table.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
    check('admin_reauth_cible_type_check', sql`${table.cibleType} ~ '^[a-z_]+$'`),
    check('admin_reauth_cible_id_check', sql`${table.cibleId} IS NULL OR char_length(${table.cibleId}) <= 64`),
    check('admin_reauth_code_empreinte_check', sql`${table.codeEmpreinte} ~ '^[0-9a-f]{64}$'`),
    check('admin_reauth_essais_check', sql`${table.essais} BETWEEN 0 AND 3`),
  ],
)

// S16 : les tables maison mcp_clients / mcp_tokens ont été supprimées (migration 0026) : l'OAuth du
// serveur MCP est porté par les tables Better Auth ci-dessous (oauth_clients, oauth_*_tokens, ...).

// ─── Better Auth : plugins jwt() et mcp() (@better-auth/oauth-provider 1.7.18) ───────────────────────────
// Source des champs : node_modules/better-auth/dist/plugins/jwt/schema.mjs et
// @better-auth/oauth-provider dist/authorize-*.mjs (const `schema`, région src/schema.ts).
// Les PROPRIÉTÉS des colonnes sont les noms de champs du plugin (camelCase, exigé par l'adaptateur
// Drizzle) ; les colonnes SQL sont en snake_case. Avec `usePlural: true`, l'adaptateur cherche la clé
// d'export `${modèle}s` : oauthClient -> oauthClients, ... et jwks -> `jwkss` (la table SQL reste `jwks`).
// Ne PAS renommer ces clés d'export sans changer la configuration de l'adaptateur.
// Isolation : pas de tenant ici, le périmètre est l'utilisateur (`user_id` -> users.id ON DELETE CASCADE).

// Clés de signature des jetons (plugin jwt). `private_key` est chiffrée par Better Auth (clé BETTER_AUTH_SECRET).
export const jwkss = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  alg: text('alg'),
  crv: text('crv'),
})

// Clients OAuth (assistants). `client_id` est la clé référencée par les jetons, consentements et liaisons.
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    // Métadonnées libres du plugin : le JSON est admis ici car il est imposé par Better Auth (réglages).
    metadata: jsonb('metadata'),
  },
  (table) => [index('oauth_clients_user_id_idx').on(table.userId)],
)

// Ressource protégée dont le serveur d'autorisation émet des jetons (ici : le serveur MCP).
export const oauthResources = pgTable('oauth_resources', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata'),
})

// Liaison client <-> ressource : unicité (client_id, resource_id) exigée par le plugin (idempotence).
export const oauthClientResources = pgTable(
  'oauth_client_resources',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_client_resources_client_id_resource_id_unique').on(table.clientId, table.resourceId),
    index('oauth_client_resources_resource_id_idx').on(table.resourceId),
  ],
)

// Jeton de rafraîchissement opaque (haché par défaut), lié à une session.
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp('revoked', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: timestamp('rotation_replay_expires_at', { withTimezone: true }),
    authTime: timestamp('auth_time', { withTimezone: true }),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_refresh_tokens_client_id_idx').on(table.clientId),
    index('oauth_refresh_tokens_session_id_idx').on(table.sessionId),
    index('oauth_refresh_tokens_user_id_idx').on(table.userId),
    index('oauth_refresh_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
  ],
)

// Jeton d'accès opaque (émis quand aucun `resource` n'est demandé ; sinon JWT sans ligne ici).
export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: text('refresh_id').references(() => oauthRefreshTokens.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp('revoked', { withTimezone: true }),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_access_tokens_client_id_idx').on(table.clientId),
    index('oauth_access_tokens_session_id_idx').on(table.sessionId),
    index('oauth_access_tokens_user_id_idx').on(table.userId),
    index('oauth_access_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_tokens_refresh_id_idx').on(table.refreshId),
  ],
)

// Consentement donné par un utilisateur à un client pour des portées données.
export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_consents_client_id_idx').on(table.clientId),
    index('oauth_consents_user_id_idx').on(table.userId),
  ],
)

// Usage unique des `jti` d'assertions client (private_key_jwt) : la clé primaire fait foi (anti-rejeu).
// Le plugin ne purge pas les lignes expirées (TODO amont) : `expires_at` servira à un nettoyage ultérieur
// (pas d'index tant qu'aucune requête de purge n'existe).
export const oauthClientAssertions = pgTable('oauth_client_assertions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// S10 (docs/specs/S10-abonnements.md §2, migration 0021) : un paiement = une tentative de règlement d'un
// abonnement. `id` (UUID généré par l'application) est l'`externalId` envoyé au fournisseur. Pièce
// comptable : `user_id` passe à NULL à la suppression du compte (ON DELETE SET NULL), la ligne survit.
// `fournisseur` et `methode` ne sont PAS des énumérations en base (seulement un format) : ajouter un
// fournisseur ou un moyen ne demande aucune migration. Le numéro du payeur n'est JAMAIS stocké :
// `telephone_masque` (affichage, contient « • ») et `telephone_empreinte` (HMAC-SHA256, limite par numéro).
// Montants en entiers de la plus petite unité de la devise ; snapshot des frais au moment de l'initiation.
// L'état d'abonnement (actif, grâce, gratuit) n'est jamais stocké : il se calcule depuis `abonnements.expire_le`.
// Les listes (statuts, supporteurs, formats) sont recopiées depuis shared/paiements.ts et shared/plans.ts :
// garder synchronisées.
export const paiements = pgTable(
  'paiements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    fournisseur: text('fournisseur').notNull(),
    methode: text('methode').notNull(),
    operateur: text('operateur'),
    environnement: text('environnement').notNull(),
    idFournisseur: text('id_fournisseur'),
    referenceFournisseur: text('reference_fournisseur'),
    statut: text('statut').notNull().default('cree'),
    plan: text('plan').notNull(),
    periodeMois: smallint('periode_mois').notNull(),
    devise: text('devise').notNull(),
    montantPlan: integer('montant_plan').notNull(),
    montant: integer('montant').notNull(),
    fraisTauxPb: integer('frais_taux_pb').notNull(),
    fraisSupporteur: text('frais_supporteur').notNull(),
    fraisEstimes: integer('frais_estimes').notNull(),
    netEstime: integer('net_estime').notNull(),
    fraisReels: integer('frais_reels'),
    netReel: integer('net_reel'),
    telephoneMasque: text('telephone_masque'),
    telephoneEmpreinte: text('telephone_empreinte'),
    codeEchec: text('code_echec'),
    initiationIncertaine: boolean('initiation_incertaine').notNull().default(false),
    expireAvant: timestamp('expire_avant', { withTimezone: true }).notNull(),
    prochaineVerification: timestamp('prochaine_verification', { withTimezone: true }),
    verifications: smallint('verifications').notNull().default(0),
    appliqueLe: timestamp('applique_le', { withTimezone: true }),
    abonnementExpireAvant: timestamp('abonnement_expire_avant', { withTimezone: true }),
    abonnementExpireApres: timestamp('abonnement_expire_apres', { withTimezone: true }),
    termineLe: timestamp('termine_le', { withTimezone: true }),
    // A3 (migration 0030, D-A3-03) : origine de l'encaissement. P1 (migration 0033) : 'fournisseur' = passé par un
    // fournisseur de paiement (K-PAY, Mercy Pay…, toutes les lignes existantes) ; 'manuel' = créé par l'administration
    // (marquage manuel). Le fournisseur précis est dans `fournisseur`. Source côté application : shared/paiements.ts.
    source: text('source').notNull().default('fournisseur'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A3 : listes de l'administration (filtre par statut, plus récents d'abord) et revenus du mois par devise
    // (somme des paiements `reussi` bornée par `applique_le`, D-A3-01).
    index('paiements_liste_admin_idx').on(table.statut, desc(table.createdAt)),
    index('paiements_encaisse_idx').on(table.devise, table.appliqueLe).where(sql`${table.statut} = 'reussi'`),
    // Un identifiant et une référence fournisseur n'existent qu'une fois par fournisseur (rapprochement du webhook).
    uniqueIndex('paiements_fournisseur_id_unique')
      .on(table.fournisseur, table.idFournisseur)
      .where(sql`${table.idFournisseur} IS NOT NULL`),
    uniqueIndex('paiements_fournisseur_reference_unique')
      .on(table.fournisseur, table.referenceFournisseur)
      .where(sql`${table.referenceFournisseur} IS NOT NULL`),
    // Historique d'un utilisateur (carte Compte) et FK parcourue à la suppression du compte.
    index('paiements_user_created_idx').on(table.userId, desc(table.createdAt)),
    // Plafond de paiements ouverts par utilisateur (PAIEMENTS_OUVERTS_MAX) et relance.
    index('paiements_ouverts_idx')
      .on(table.userId)
      .where(sql`${table.statut} IN ('cree','en_attente')`),
    // Tick de rapprochement du worker : paiements dus (FOR UPDATE SKIP LOCKED) et expiration locale.
    index('paiements_a_verifier_idx')
      .on(table.prochaineVerification)
      .where(sql`${table.statut} IN ('cree','en_attente')`),
    // Limite d'initiations par numéro (empreinte) sur une fenêtre glissante.
    index('paiements_telephone_idx')
      .on(table.telephoneEmpreinte, table.createdAt)
      .where(sql`${table.telephoneEmpreinte} IS NOT NULL`),
    check('paiements_fournisseur_check', sql`${table.fournisseur} ~ '^[a-z0-9_-]{1,40}$'`),
    check('paiements_methode_check', sql`${table.methode} ~ '^[a-z_]{1,30}$'`),
    check('paiements_operateur_check', sql`${table.operateur} IS NULL OR ${table.operateur} ~ '^[A-Z0-9_]{2,40}$'`),
    check('paiements_environnement_check', sql`${table.environnement} IN ('test','live')`),
    check(
      'paiements_statut_check',
      sql`${table.statut} IN ('cree','en_attente','reussi','echoue','annule','expire','anomalie')`,
    ),
    check('paiements_plan_check', sql`${table.plan} ~ '^[a-z_]{1,30}$' AND ${table.plan} <> 'gratuit'`),
    check('paiements_periode_check', sql`${table.periodeMois} BETWEEN 1 AND 36`),
    check('paiements_devise_check', sql`${table.devise} ~ '^[A-Z]{3}$'`),
    check(
      'paiements_montants_check',
      sql`${table.montantPlan} > 0 AND ${table.montant} >= ${table.montantPlan} AND ${table.montant} <= 1000000000
        AND ${table.fraisEstimes} >= 0 AND ${table.netEstime} = ${table.montant} - ${table.fraisEstimes}
        AND (${table.fraisReels} IS NULL OR ${table.fraisReels} >= 0) AND (${table.netReel} IS NULL OR ${table.netReel} >= 0)`,
    ),
    check('paiements_frais_taux_check', sql`${table.fraisTauxPb} BETWEEN 0 AND 5000`),
    check('paiements_frais_supporteur_check', sql`${table.fraisSupporteur} IN ('marchand','client')`),
    check(
      'paiements_telephone_masque_check',
      sql`${table.telephoneMasque} IS NULL
        OR (char_length(${table.telephoneMasque}) <= 32 AND position('•' in ${table.telephoneMasque}) > 0)`,
    ),
    check(
      'paiements_telephone_empreinte_check',
      sql`${table.telephoneEmpreinte} IS NULL OR ${table.telephoneEmpreinte} ~ '^[0-9a-f]{64}$'`,
    ),
    check('paiements_code_echec_check', sql`${table.codeEchec} IS NULL OR ${table.codeEchec} ~ '^[A-Z0-9_]{1,64}$'`),
    check(
      'paiements_ids_check',
      sql`(${table.idFournisseur} IS NULL OR char_length(${table.idFournisseur}) BETWEEN 1 AND 100)
        AND (${table.referenceFournisseur} IS NULL OR char_length(${table.referenceFournisseur}) BETWEEN 1 AND 100)`,
    ),
    // `reussi` ⇔ appliqué à l'abonnement (une seule fois) ; un paiement ouvert n'a pas de date de fin.
    check('paiements_applique_check', sql`(${table.statut} = 'reussi') = (${table.appliqueLe} IS NOT NULL)`),
    check(
      'paiements_terminal_check',
      sql`(${table.statut} IN ('cree','en_attente')) = (${table.termineLe} IS NULL)`,
    ),
    // `en_attente` sans identifiant fournisseur n'est admis que si l'initiation est incertaine (délai, 409).
    check(
      'paiements_attente_id_check',
      sql`${table.statut} <> 'en_attente' OR ${table.idFournisseur} IS NOT NULL OR ${table.initiationIncertaine}`,
    ),
    check('paiements_verifications_check', sql`${table.verifications} BETWEEN 0 AND 1000`),
    check('paiements_source_check', sql`${table.source} IN ('fournisseur','manuel')`),
    // A3 : un paiement manuel (et lui seul) a le fournisseur 'manuel' ; il n'a ni identifiant fournisseur, ni frais,
    // ni code d'échec, sa référence est 'manuel-' || id, il ne peut être que `cree` (transitoire) ou `reussi`.
    // Les index uniques (fournisseur, id_fournisseur) et (fournisseur, reference_fournisseur) sont inchangés : un
    // manuel ne peut pas entrer en collision avec une référence d'un fournisseur de paiement (fournisseur différent).
    // P1 (migration 0033) : la source 'kpay' devient 'fournisseur' (K-PAY, Mercy Pay… partagent la même source).
    // ÉCART DE LA SPEC §3 (voir rapport) : la spec écrit (source = 'kpay') = (fournisseur = 'kpay'), ce qui interdirait
    // tout autre fournisseur en base (contraire à la règle S10 « fournisseur n'est pas une énumération » et à une
    // ligne `stripe` créée par tests/integration/webhook-kpay-route.test.ts). On garantit ici l'équivalence côté
    // manuel seulement : manuel <=> fournisseur 'manuel'. Second écart : `reference_fournisseur IS NOT NULL` explicite
    // (une comparaison avec NULL vaut NULL, et un CHECK à NULL est accepté : un manuel sans référence passerait).
    check(
      'paiements_source_coherence_check',
      sql`(${table.source} = 'manuel') = (${table.fournisseur} = 'manuel')
        AND (${table.source} = 'fournisseur' OR (
          ${table.methode} = 'manuel' AND ${table.statut} IN ('cree','reussi')
          AND ${table.idFournisseur} IS NULL AND ${table.referenceFournisseur} IS NOT NULL
          AND ${table.referenceFournisseur} = 'manuel-' || ${table.id}
          AND ${table.fraisTauxPb} = 0 AND ${table.fraisEstimes} = 0 AND ${table.netEstime} = ${table.montant}
          AND ${table.codeEchec} IS NULL AND ${table.initiationIncertaine} = false
        ))`,
    ),
  ],
)

// A3 (migration 0030, D-A3-05) : compteur horaire des webhooks refusés (signature invalide, corps trop gros).
// Une ligne par (heure, fournisseur, motif) : taille bornée sous attaque. Aucun corps, aucune IP, aucun en-tête.
// Rétention 90 jours (purge applicative). Écriture best-effort. Motifs recopiés de shared/paiements.ts.
export const webhooksRefuses = pgTable(
  'webhooks_refuses',
  {
    heure: timestamp('heure', { withTimezone: true }).notNull(),
    fournisseur: text('fournisseur').notNull(),
    motif: text('motif').notNull(),
    nombre: integer('nombre').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.heure, table.fournisseur, table.motif] }),
    check('webhooks_refuses_fournisseur_check', sql`${table.fournisseur} ~ '^[a-z0-9_-]{1,40}$'`),
    check('webhooks_refuses_motif_check', sql`${table.motif} IN ('SIGNATURE_INVALIDE','CORPS_TROP_GROS')`),
    check('webhooks_refuses_nombre_check', sql`${table.nombre} >= 1`),
  ],
)

// S10 : une ligne par utilisateur (unique). `expire_le` est EXCLUSIF (minuit local suivant le dernier jour
// payé). L'état actif / grâce / gratuit se calcule (resoudrePlanEffectif), il n'est jamais stocké. CASCADE :
// l'abonnement disparaît avec le compte (les paiements, eux, survivent).
export const abonnements = pgTable(
  'abonnements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull().default('payant'),
    expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
    premiereActivationLe: timestamp('premiere_activation_le', { withTimezone: true }).notNull(),
    dernierPaiementId: text('dernier_paiement_id').references(() => paiements.id, { onDelete: 'set null' }),
    // A2 (migration 0029, D-A2-04/05, D-A3-06) : comment l'abonnement a été CRÉÉ. 'paiement' = encaissement
    // (défaut, lignes existantes) ; 'offert' = jours offerts par l'administration ; 'admin' = changement de plan ;
    // E1 (migration 0036) : 'essai' = essai gratuit accordé à la création de la vitrine.
    // Une prolongation par paiement la remet à 'paiement' (D2). Source côté application : shared/admin-a2.ts.
    origine: text('origine').notNull().default('paiement'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('abonnements_origine_check', sql`${table.origine} IN ('paiement','offert','admin','essai')`),
    // Planificateur des rappels J-7 / J-3 / J0 (balayage des échéances proches).
    index('abonnements_expire_le_idx').on(table.expireLe),
    // FK parcourue à la suppression d'un paiement (ON DELETE SET NULL).
    index('abonnements_dernier_paiement_idx').on(table.dernierPaiementId),
    check('abonnements_plan_check', sql`${table.plan} ~ '^[a-z_]{1,30}$' AND ${table.plan} <> 'gratuit'`),
    check('abonnements_dates_check', sql`${table.premiereActivationLe} < ${table.expireLe}`),
  ],
)

// S10 : journal des événements de paiement (webhook et interrogation). Il sert de déduplication
// (unicité fournisseur + id_transaction + événement, insertion ON CONFLICT DO NOTHING dans la transaction
// qui applique l'événement) et de piste d'audit. Aucun corps de requête, aucun numéro : des codes seulement.
// `paiement_id` passe à NULL si le paiement est supprimé (ON DELETE SET NULL).
export const evenementsPaiement = pgTable(
  'evenements_paiement',
  {
    id: text('id').primaryKey(),
    fournisseur: text('fournisseur').notNull(),
    evenement: text('evenement').notNull(),
    source: text('source').notNull(),
    idTransaction: text('id_transaction').notNull(),
    externalId: text('external_id'),
    paiementId: text('paiement_id').references(() => paiements.id, { onDelete: 'set null' }),
    statutFournisseur: text('statut_fournisseur'),
    montant: integer('montant'),
    traitement: text('traitement').notNull(),
    motif: text('motif'),
    horodatageFournisseur: timestamp('horodatage_fournisseur', { withTimezone: true }),
    recuLe: timestamp('recu_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('evenements_paiement_dedup_unique').on(table.fournisseur, table.idTransaction, table.evenement),
    // FK parcourue à la suppression d'un paiement, et historique d'un paiement.
    index('evenements_paiement_paiement_idx').on(table.paiementId),
    check('evenements_paiement_fournisseur_check', sql`${table.fournisseur} ~ '^[a-z0-9_-]{1,40}$'`),
    check('evenements_paiement_evenement_check', sql`${table.evenement} ~ '^[a-z_]{1,20}\\.[a-z_]{1,20}$'`),
    check('evenements_paiement_source_check', sql`${table.source} IN ('webhook','interrogation')`),
    check(
      'evenements_paiement_ids_check',
      sql`char_length(${table.idTransaction}) BETWEEN 1 AND 100
        AND (${table.externalId} IS NULL OR char_length(${table.externalId}) <= 100)`,
    ),
    check(
      'evenements_paiement_statut_check',
      sql`${table.statutFournisseur} IS NULL OR ${table.statutFournisseur} ~ '^[A-Z_]{1,30}$'`,
    ),
    check('evenements_paiement_traitement_check', sql`${table.traitement} IN ('applique','ignore','anomalie')`),
    check('evenements_paiement_motif_check', sql`${table.motif} IS NULL OR ${table.motif} ~ '^[A-Z0-9_]{1,64}$'`),
  ],
)

// S11 (docs/specs/S11-statistiques.md §2, migration 0022) : suivi des visites des vitrines publiques.
// Jamais d'adresse IP brute : `empreinte` est un HMAC-SHA256 à sel journalier (le jour), vérifié par CHECK.
// Lignes brutes purgées à 90 jours ; agrégats conservés 180 jours ; zéro JSON, aucune métadonnée libre.
export const vues = pgTable(
  'vues',
  {
    id: text('id').primaryKey().notNull(),
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade', onUpdate: 'no action' }),
    jour: date('jour').notNull(),
    empreinte: text('empreinte').notNull(),
    pageType: text('page_type').notNull(),
    pageIdentifiant: text('page_identifiant').notNull().default(''),
    source: text('source').notNull(),
    appareil: text('appareil').notNull(),
    pays: text('pays'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vues_vitrine_id_jour_idx').on(table.vitrineId, table.jour),
    index('vues_jour_idx').on(table.jour),
    check('vues_empreinte_check', sql`${table.empreinte} ~ '^[a-f0-9]{64}$'`),
    check(
      'vues_page_type_check',
      sql`${table.pageType} IN ('accueil','service','realisation','agenda','contact','reservation','autre')`,
    ),
    check(
      'vues_page_identifiant_check',
      sql`char_length(${table.pageIdentifiant}) <= 80 AND (${table.pageIdentifiant} = '' OR ${table.pageIdentifiant} ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    ),
    check(
      'vues_source_check',
      sql`${table.source} IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram','linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre')`,
    ),
    check(
      'vues_appareil_check',
      sql`${table.appareil} IN ('mobile','tablette','ordinateur','inconnu')`,
    ),
    check('vues_pays_check', sql`${table.pays} IS NULL OR ${table.pays} ~ '^[A-Z]{2}$'`),
  ],
)

export const statistiquesJour = pgTable(
  'statistiques_jour',
  {
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade', onUpdate: 'no action' }),
    jour: date('jour').notNull(),
    visites: integer('visites').notNull().default(0),
    visiteursUniques: integer('visiteurs_uniques').notNull().default(0),
    clics: integer('clics').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('statistiques_jour_visites_check', sql`${table.visites} >= 0`),
    check('statistiques_jour_visiteurs_uniques_check', sql`${table.visiteursUniques} >= 0`),
    check('statistiques_jour_clics_check', sql`${table.clics} >= 0`),
    primaryKey({ columns: [table.vitrineId, table.jour] }),
  ],
)

export const statistiquesJourPages = pgTable(
  'statistiques_jour_pages',
  {
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade', onUpdate: 'no action' }),
    jour: date('jour').notNull(),
    pageType: text('page_type').notNull(),
    pageIdentifiant: text('page_identifiant').notNull().default(''),
    visites: integer('visites').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.vitrineId, table.jour, table.pageType, table.pageIdentifiant],
    }),
    check(
      'spj_page_type_check',
      sql`${table.pageType} IN ('accueil','service','realisation','agenda','contact','reservation','autre')`,
    ),
    check(
      'spj_page_identifiant_check',
      sql`char_length(${table.pageIdentifiant}) <= 80 AND (${table.pageIdentifiant} = '' OR ${table.pageIdentifiant} ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    ),
  ],
)

export const statistiquesJourSources = pgTable(
  'statistiques_jour_sources',
  {
    vitrineId: text('vitrine_id')
      .notNull()
      .references(() => vitrines.id, { onDelete: 'cascade', onUpdate: 'no action' }),
    jour: date('jour').notNull(),
    source: text('source').notNull(),
    visites: integer('visites').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.vitrineId, table.jour, table.source] }),
    check(
      'sjs_source_check',
      sql`${table.source} IN ('direct','interne','google','bing','duckduckgo','yahoo','facebook','instagram','linkedin','twitter','x','youtube','tiktok','whatsapp','telegram','pinterest','reddit','autre')`,
    ),
  ],
)

// ─── A4 : supervision et registre des réglages (migration 0031, docs/specs/A4-supervision-reglages.md §3) ──────
// Registre des réglages d'exploitation : UNE ligne par clé MODIFIÉE (pas de ligne = valeur du code, ou repli
// restrictif par clé, D-A4-06). `valeur` est un scalaire JSON (nombre, booléen, texte) : un réglage, donc JSON
// autorisé (CLAUDE.md §4.3) ; les bornes et la validation croisée vivent dans shared/reglages.ts, la base ne
// garantit que la forme. Aucun secret ni URL (garde de test sur les clés). Journal de chaque écriture : journal_admin.
export const reglages = pgTable(
  'reglages',
  {
    cle: text('cle').primaryKey(),
    valeur: jsonb('valeur').notNull(),
    modifiePar: text('modifie_par')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    modifieLe: timestamp('modifie_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('reglages_cle_check', sql`${table.cle} ~ '^[a-z][a-z0-9_.]{2,63}$'`),
    check('reglages_valeur_check', sql`jsonb_typeof(${table.valeur}) IN ('number','boolean','string')`),
  ],
)

// Capacité accordée à un compte hors plan (D-A4-11 : `mcp` seulement). Une ligne par octroi, jamais supprimée :
// la révocation pose `revoque_le`. Au plus UNE capacité active par (compte, capacité) : index unique partiel.
// Disparaît avec le compte (CASCADE) ; l'administrateur auteur est protégé (RESTRICT, comme `journal_admin`).
// Source de la liste des capacités côté application : shared/plans.ts (CAPACITES_PAYANTES).
export const capacitesAccordees = pgTable(
  'capacites_accordees',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    capacite: text('capacite').notNull(),
    motif: text('motif').notNull(),
    accordePar: text('accorde_par')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    accordeLe: timestamp('accorde_le', { withTimezone: true }).notNull().defaultNow(),
    revoqueLe: timestamp('revoque_le', { withTimezone: true }),
  },
  (table) => [
    // Requête réelle : « ce compte a-t-il la capacité X ? » (consentement MCP et chaque appel d'outil, D-A4-11).
    uniqueIndex('capacites_accordees_actives_unique')
      .on(table.userId, table.capacite)
      .where(sql`${table.revoqueLe} IS NULL`),
    check('capacites_accordees_capacite_check', sql`${table.capacite} IN ('mcp')`),
    check('capacites_accordees_motif_check', sql`char_length(btrim(${table.motif})) BETWEEN 5 AND 500`),
    check('capacites_accordees_revocation_check', sql`${table.revoqueLe} IS NULL OR ${table.revoqueLe} >= ${table.accordeLe}`),
  ],
)

// Journal d'envoi des codes de connexion (D-A4-15) : AUCUN identifiant, AUCUN numéro, AUCUN code, AUCUNE adresse.
// Seulement le canal, le pays (indicatif résolu, NULL pour l'e-mail), le statut, le numéro de tentative et un code
// d'erreur court. Écrit par le worker (best-effort : ne lève jamais), purgé à 90 jours.
export const envoisCodes = pgTable(
  'envois_codes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
    canal: text('canal').notNull(),
    pays: text('pays'),
    statut: text('statut').notNull(),
    tentative: smallint('tentative').notNull(),
    codeErreur: text('code_erreur'),
  },
  (table) => [
    // Requêtes réelles : agrégat des envois par canal et pays sur une fenêtre de temps, et purge à 90 jours.
    index('envois_codes_cree_le_idx').on(table.creeLe, table.canal, table.pays),
    check('envois_codes_canal_check', sql`${table.canal} IN ('sms','email','whatsapp')`),
    check('envois_codes_pays_check', sql`${table.pays} IS NULL OR ${table.pays} ~ '^[A-Z]{2}$'`),
    check('envois_codes_statut_check', sql`${table.statut} IN ('envoye','echec')`),
    check('envois_codes_tentative_check', sql`${table.tentative} BETWEEN 1 AND 3`),
    check('envois_codes_code_erreur_check', sql`${table.codeErreur} IS NULL OR char_length(${table.codeErreur}) <= 40`),
  ],
)

// Battements du système (D-A4-16) : dernier instant connu d'un événement d'exploitation écrit par un script
// extérieur (`sauvegarde_derniere_reussite`). Une ligne par clé ; absente = « inconnu » (jamais « bon »).
export const battementsSysteme = pgTable(
  'battements_systeme',
  {
    cle: text('cle').primaryKey(),
    horodatage: timestamp('horodatage', { withTimezone: true }).notNull(),
    ecritLe: timestamp('ecrit_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('battements_systeme_cle_check', sql`${table.cle} ~ '^[a-z_]{3,40}$'`)],
)

// ─── A5 : catalogues et versions de configuration (migration 0032, docs/specs/A5-catalogues-versions.md §4) ────
// Devises que le produit sait gérer (codes fixés ; `actif` = ce qu'un compte peut CHOISIR, pas ce qui est PAYABLE,
// D-A5-11). Pas de création depuis l'interface. Les décimales et l'affichage restent dans shared/devises.ts.
export const devises = pgTable(
  'devises',
  {
    code: text('code').primaryKey(),
    actif: boolean('actif').notNull().default(true),
    modifieLe: timestamp('modifie_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('devises_code_check', sql`${table.code} IN ('XAF','EUR','USD')`)],
)

// Pays proposés (clé = code ISO alpha-2). Créés par MIGRATION seulement (D-A5-10) : un pays exige un indicatif, des
// fuseaux et un format de numéro. `vitrines.pays` n'a PAS de clé étrangère vers cette table (valeurs historiques :
// la suppression d'un pays est refusée par le service dès qu'une vitrine le référence). L'indicatif n'est pas
// unique (+1 : Canada et États-Unis). `fuseaux` : liste de fuseaux IANA, le premier est le fuseau de repli.
// Canaux de connexion par pays (D-A5-13) : sms et whatsapp appliqués côté serveur, email informatif.
export const pays = pgTable(
  'pays',
  {
    code: text('code').primaryKey(),
    libelle: text('libelle').notNull(),
    indicatif: text('indicatif').notNull(),
    actif: boolean('actif').notNull().default(true),
    deviseDefaut: text('devise_defaut')
      .notNull()
      .references(() => devises.code),
    fuseaux: text('fuseaux').array().notNull(),
    canalSms: boolean('canal_sms').notNull().default(true),
    canalWhatsapp: boolean('canal_whatsapp').notNull().default(false),
    canalEmail: boolean('canal_email').notNull().default(true),
    modifieLe: timestamp('modifie_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('pays_code_check', sql`${table.code} ~ '^[A-Z]{2}$'`),
    check('pays_libelle_check', sql`char_length(${table.libelle}) BETWEEN 2 AND 80`),
    check('pays_indicatif_check', sql`${table.indicatif} ~ '^[1-9][0-9]{0,3}$'`),
    // Au moins un fuseau, sans élément NULL ni vide : `cardinality(...) >= 1` seul laisse passer ARRAY[NULL] et ARRAY[''].
    check(
      'pays_fuseaux_check',
      sql`cardinality(${table.fuseaux}) >= 1 AND array_position(${table.fuseaux}, NULL) IS NULL AND array_position(${table.fuseaux}, '') IS NULL`,
    ),
  ],
)

// Noms d'adresse interdits en plus de la liste du code (shared/reserved.ts, `isReserved`). Ajout par le superadmin,
// avec motif ; `cree_par` = identifiant d'administrateur (texte court, sans clé étrangère : journal de décision).
export const usernamesBloques = pgTable(
  'usernames_bloques',
  {
    valeur: text('valeur').primaryKey(),
    motif: text('motif').notNull(),
    creePar: text('cree_par').notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('usernames_bloques_valeur_check', sql`${table.valeur} ~ '^[a-z0-9][a-z0-9_-]{1,39}$'`),
    check('usernames_bloques_motif_check', sql`char_length(btrim(${table.motif})) BETWEEN 5 AND 200`),
    check('usernames_bloques_cree_par_check', sql`char_length(${table.creePar}) <= 64`),
  ],
)

// Versions de configuration commerciale (D-A5-01, D-A5-02) : plan, prix, frais, moyens, et depuis E1 (migration 0036)
// essai (clé unique `inscription`). UNE seule table, en
// AJOUT SEUL : seuls `statut` et `validee_le` (une fois, NULL -> date) évoluent, et `effective_a` une fois posée
// n'est plus modifiable. Le déclencheur `configuration_versions_proteger` (non généré par drizzle-kit, écrit dans la
// migration) refuse tout autre UPDATE, tout DELETE et tout TRUNCATE (42501). Une seule version `active` et une
// seule `programmee` par (categorie, cle), garanties par deux index uniques partiels. `valeurs` est un objet JSON
// validé par Zod côté service (schéma strict par catégorie) : un réglage, donc JSON autorisé.
// `cree_par` = identifiant d'administrateur ou `systeme` (seed) ; pas de clé étrangère (la version survit au compte).
export const configurationVersions = pgTable(
  'configuration_versions',
  {
    id: text('id').primaryKey(),
    categorie: text('categorie').notNull(),
    cle: text('cle').notNull(),
    numero: integer('numero').notNull(),
    valeurs: jsonb('valeurs').notNull(),
    statut: text('statut').notNull(),
    effectiveA: timestamp('effective_a', { withTimezone: true }),
    valideeLe: timestamp('validee_le', { withTimezone: true }),
    motif: text('motif').notNull(),
    creePar: text('cree_par').notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Requête réelle : `lireVersionActive(categorie, cle)` (chemin chaud, cache 5 s) et garantie d'unicité.
    uniqueIndex('configuration_versions_active_unique')
      .on(table.categorie, table.cle)
      .where(sql`${table.statut} = 'active'`),
    // Requête réelle : balayage du job `versions-appliquer` (programmées échues) et garantie d'unicité.
    uniqueIndex('configuration_versions_programmee_unique')
      .on(table.categorie, table.cle)
      .where(sql`${table.statut} = 'programmee'`),
    // Historique d'une clé (numéro décroissant) : parcours de l'unique (categorie, cle, numero).
    unique('configuration_versions_numero_unique').on(table.categorie, table.cle, table.numero),
    check('configuration_versions_id_check', sql`char_length(${table.id}) BETWEEN 8 AND 64`),
    check('configuration_versions_categorie_check', sql`${table.categorie} IN ('plan','prix','frais','moyens','essai')`),
    check('configuration_versions_cle_check', sql`${table.cle} ~ '^[a-z0-9_:.-]{1,60}$'`),
    check('configuration_versions_numero_check', sql`${table.numero} >= 1`),
    check('configuration_versions_valeurs_check', sql`jsonb_typeof(${table.valeurs}) = 'object'`),
    check('configuration_versions_statut_check', sql`${table.statut} IN ('brouillon','programmee','active','remplacee')`),
    check('configuration_versions_motif_check', sql`char_length(btrim(${table.motif})) BETWEEN 5 AND 500`),
    check('configuration_versions_cree_par_check', sql`char_length(${table.creePar}) <= 64`),
    check('configuration_versions_plan_cle_check', sql`${table.categorie} <> 'plan' OR ${table.cle} IN ('gratuit','payant')`),
    // E1 : la catégorie `essai` n'a qu'une clé, `inscription` (l'essai accordé à la création de la vitrine).
    check('configuration_versions_essai_cle_check', sql`${table.categorie} <> 'essai' OR ${table.cle} = 'inscription'`),
    // Un brouillon n'a pas de date d'effet, toute autre version en a une.
    check('configuration_versions_effet_check', sql`(${table.statut} = 'brouillon') = (${table.effectiveA} IS NULL)`),
    // Seule une grille de prix se valide (D-A5-07).
    check('configuration_versions_validee_check', sql`${table.valideeLe} IS NULL OR ${table.categorie} = 'prix'`),
  ],
)

// E1 (docs/specs/E1-essai-gratuit.md §3, migration 0036) : trace d'un essai gratuit accordé à la création de la vitrine.
// Une ligne par essai ; elle SURVIT au compte (`user_id` passe à NULL, ON DELETE SET NULL) pour que le compteur de
// conversions (D11) et l'indicateur admin gardent l'historique (`converti_le` conservé). L'unicité de `user_id`
// (index unique PARTIEL : une ligne détachée, `user_id` NULL, n'entre pas dans l'unicité) garantit « un essai par
// compte » sous concurrence ; l'unicité par personne est portée par `essais_empreintes`. Le déclencheur
// `essais_proteger` (non généré par drizzle-kit, écrit dans la migration) rend la ligne immuable : seuls
// `user_id` -> NULL et `converti_le` NULL -> date passent ; tout autre UPDATE et tout DELETE = 42501.
// `version_id` = identifiant de la version `essai` de configuration_versions appliquée, ou `code` (repli sur
// ESSAI_DEFAUT quand la configuration est illisible) : sans clé étrangère, `code` n'est pas une ligne. `duree_jours`
// est copiée de la version (un changement de durée ne touche que les essais accordés ensuite). `fin_le` est EXCLUSIF
// comme `abonnements.expire_le`. Aucune donnée personnelle dans cette table.
// Index `essais_debut_le_idx` : requête réelle de `statistiquesEssais(now, jours)` (essais accordés sur 30 jours).
export const essais = pgTable(
  'essais',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    debutLe: timestamp('debut_le', { withTimezone: true }).notNull(),
    finLe: timestamp('fin_le', { withTimezone: true }).notNull(),
    dureeJours: integer('duree_jours').notNull(),
    versionId: text('version_id').notNull(),
    convertiLe: timestamp('converti_le', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('essais_user_id_unique')
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index('essais_debut_le_idx').on(table.debutLe),
    check('essais_duree_jours_check', sql`${table.dureeJours} BETWEEN 1 AND 90`),
    check('essais_dates_check', sql`${table.debutLe} < ${table.finLe}`),
    check('essais_converti_le_check', sql`${table.convertiLe} IS NULL OR ${table.convertiLe} >= ${table.debutLe}`),
    check('essais_version_id_check', sql`char_length(${table.versionId}) BETWEEN 1 AND 64`),
  ],
)

// E1 (D4, migration 0036) : marqueur anti-abus « un essai par personne ». `empreinte` = HMAC-SHA256 (64 caractères
// hexadécimaux minuscules) d'une clé normalisée (adresse e-mail, ou numéro vérifié en chiffres seuls) sur une clé HKDF
// dérivée du secret serveur : aucune donnée en clair, aucune clé étrangère vers `users` (l'empreinte survit à la
// suppression du compte, c'est son but). `nature` = ce qui a été haché. La clé primaire rend l'attribution atomique
// (`INSERT ... ON CONFLICT DO NOTHING RETURNING`, D6) : deux comptes simultanés avec la même clé ne peuvent pas
// obtenir chacun un essai. RESTRICT : un essai ne se supprime pas tant qu'il porte des empreintes (il ne se supprime
// de toute façon jamais, `essais_proteger`). Le déclencheur `essais_empreintes_proteger` (écrit dans la migration, non
// généré par drizzle-kit) rend la ligne immuable (DELETE et UPDATE qui change une valeur = 42501) : sinon un DELETE
// ou un changement de `essai_id` rouvrirait l'essai à la personne.
export const essaisEmpreintes = pgTable(
  'essais_empreintes',
  {
    empreinte: text('empreinte').primaryKey(),
    nature: text('nature').notNull(),
    essaiId: text('essai_id')
      .notNull()
      .references(() => essais.id, { onDelete: 'restrict' }),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('essais_empreintes_empreinte_check', sql`${table.empreinte} ~ '^[0-9a-f]{64}$'`),
    check('essais_empreintes_nature_check', sql`${table.nature} IN ('email','telephone')`),
  ],
)

export type Vue = typeof vues.$inferSelect
export type NewVue = typeof vues.$inferInsert
export type StatistiquesJour = typeof statistiquesJour.$inferSelect
export type NewStatistiquesJour = typeof statistiquesJour.$inferInsert
export type StatistiquesJourPages = typeof statistiquesJourPages.$inferSelect
export type NewStatistiquesJourPages = typeof statistiquesJourPages.$inferInsert
export type StatistiquesJourSources = typeof statistiquesJourSources.$inferSelect
export type NewStatistiquesJourSources = typeof statistiquesJourSources.$inferInsert

export type Paiement = typeof paiements.$inferSelect
export type NewPaiement = typeof paiements.$inferInsert
export type Abonnement = typeof abonnements.$inferSelect
export type NewAbonnement = typeof abonnements.$inferInsert
export type WebhookRefuse = typeof webhooksRefuses.$inferSelect
export type NewWebhookRefuse = typeof webhooksRefuses.$inferInsert
export type EvenementPaiement = typeof evenementsPaiement.$inferSelect
export type NewEvenementPaiement = typeof evenementsPaiement.$inferInsert

export type PromptIa = typeof promptsIa.$inferSelect
export type NewPromptIa = typeof promptsIa.$inferInsert
export type GenerationIa = typeof generationsIa.$inferSelect
export type NewGenerationIa = typeof generationsIa.$inferInsert
export type ProgressionInscription = typeof progressionsInscription.$inferSelect
export type NewProgressionInscription = typeof progressionsInscription.$inferInsert
export type JournalAssistant = typeof journalAssistant.$inferSelect
export type NewJournalAssistant = typeof journalAssistant.$inferInsert
export type JournalAdmin = typeof journalAdmin.$inferSelect
export type NewJournalAdmin = typeof journalAdmin.$inferInsert
export type AdminReauth = typeof adminReauth.$inferSelect
export type NewAdminReauth = typeof adminReauth.$inferInsert
export type Reglage = typeof reglages.$inferSelect
export type NewReglage = typeof reglages.$inferInsert
export type CapaciteAccordee = typeof capacitesAccordees.$inferSelect
export type NewCapaciteAccordee = typeof capacitesAccordees.$inferInsert
export type EnvoiCode = typeof envoisCodes.$inferSelect
export type NewEnvoiCode = typeof envoisCodes.$inferInsert
export type BattementSysteme = typeof battementsSysteme.$inferSelect
export type NewBattementSysteme = typeof battementsSysteme.$inferInsert
export type DeviseCatalogue = typeof devises.$inferSelect
export type NewDeviseCatalogue = typeof devises.$inferInsert
export type PaysCatalogue = typeof pays.$inferSelect
export type NewPaysCatalogue = typeof pays.$inferInsert
export type UsernameBloque = typeof usernamesBloques.$inferSelect
export type NewUsernameBloque = typeof usernamesBloques.$inferInsert
export type ConfigurationVersion = typeof configurationVersions.$inferSelect
export type NewConfigurationVersion = typeof configurationVersions.$inferInsert
export type Essai = typeof essais.$inferSelect
export type NewEssai = typeof essais.$inferInsert
export type EssaiEmpreinte = typeof essaisEmpreintes.$inferSelect
export type NewEssaiEmpreinte = typeof essaisEmpreintes.$inferInsert
