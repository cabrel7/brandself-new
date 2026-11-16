// A4 : contrats Zod STRICTS (entrées ET sorties) de la supervision et des réglages
// (docs/specs/A4-supervision-reglages.md §4). Les réponses sont construites champ par champ (jamais de spread d'une
// ligne) puis validées par ces schémas : une clé en trop fait échouer la réponse.
// Jamais exposés : adresse e-mail, téléphone, adresse IP, clé d'idempotence, `entree`/`sortie` d'une génération d'IA,
// `job.data` ni message d'erreur brut d'un job, `arguments_resume`/`resultat`/`avant`/`apres` du journal des assistants.
import { z } from 'zod'
import {
  ADMIN_ACTION_FORMAT,
  ADMIN_CIBLE_ID_MAX,
  ADMIN_CIBLE_TYPE_FORMAT,
  ADMIN_ENVOIS_JOURS_DEFAUT,
  ADMIN_JOB_ID_FORMAT,
  ADMIN_LISTE_LIMITE_MAX,
  ADMIN_SUPERVISION_ASSISTANTS_MAX,
  ADMIN_SUPERVISION_ERREURS_TOP_MAX,
  ADMIN_SUPERVISION_JOURS_DEFAUT,
  ADMIN_SUPERVISION_JOURS_MAX,
  ADMIN_SUPERVISION_JOURS_MIN,
  ADMIN_SUPERVISION_TOP_MAX,
  APP_VERSION_FORMAT,
  AUDIT_CLE_FORMAT,
  AUDIT_VALEUR_TEXTE_MAX,
  SANTE_ETATS,
  SAUVEGARDE_ETATS,
} from '../admin'
import { GENERATION_STATUTS, IA_TYPES, MOTIFS_REPLI } from '../ia'
import {
  ENVOIS_CODES_CANAUX,
  ENVOIS_CODES_CODE_ERREUR_MAX,
  ENVOIS_CODES_PAYS_FORMAT,
  ENVOIS_CODES_RETENTION_JOURS,
  FILES_SUPERVISEES,
  SUPERVISION_ECHECS_LISTES_MAX,
  SUPERVISION_PURGE_LIMITE_MAX,
} from '../jobs'
import { CODE_ECHEC_FORMAT } from '../paiements'
import { CAPACITES_PAYANTES } from '../plans'
import {
  MAINTENANCE_MESSAGE_LONGUEUR_MAX,
  REGLAGE_CATEGORIES,
  REGLAGE_CLES_LISTE,
  REGLAGE_CLE_FORMAT,
  REGLAGE_TEXTE_FORMAT,
  REGLAGE_TYPES,
  REGLAGES,
  REGLAGES_LISTE,
} from '../reglages'
import type { ReglageCle, ReglageDefinition, ReglageValeur } from '../reglages'
import { schemaMotifAdmin } from './admin'
import { schemaCleIdempotence, schemaIdAdmin, schemaPaginationAdmin } from './admin-a2'
import { schemaPwaInstallEvent } from './pwa'

const schemaInstant = z.iso.datetime()
const schemaDateJour = z.iso.date()
const schemaCompteur = z.number().int().nonnegative()
const schemaIdCourt = z.string().min(1).max(ADMIN_CIBLE_ID_MAX)
const schemaFile = z.enum(FILES_SUPERVISEES)

// --- Réglages ---

/**
 * Valeur d'un réglage telle qu'elle voyage : nombre entier, booléen ou texte. La borne de texte est celle du seul
 * réglage texte (le message de maintenance) ; `schemaValeurReglage(cle)` applique ensuite les bornes de LA clé.
 */
export const schemaReglageValeur = z.union([
  z.number().int(),
  z.boolean(),
  z.string().max(MAINTENANCE_MESSAGE_LONGUEUR_MAX),
])

/** Schéma de la valeur d'UN réglage, construit depuis le registre (bornes, longueur, forme du texte). */
export function schemaValeurReglage(cle: ReglageCle): z.ZodType<ReglageValeur> {
  const definition: ReglageDefinition = REGLAGES[cle]
  switch (definition.type) {
    case 'entier':
      return z.number().int().min(definition.min).max(definition.max)
    case 'booleen':
      return z.boolean()
    case 'texte':
      return z.string().trim().max(definition.longueurMax).regex(REGLAGE_TEXTE_FORMAT)
  }
}

/** `[cle]` de `PUT /api/admin/reglages/[cle]` : une clé hors registre (secret compris) répond 404, jamais une écriture. */
export const schemaReglageCleParam = z.strictObject({ cle: z.string().regex(REGLAGE_CLE_FORMAT) })
export type ReglageCleParam = z.infer<typeof schemaReglageCleParam>

/** `PUT /api/admin/reglages/[cle]` : `valeur` `null` = rétablir le défaut. La clé d'idempotence est dans le corps (D-A4-19). */
export const schemaModifierReglage = z.strictObject({
  valeur: schemaReglageValeur.nullable(),
  motif: schemaMotifAdmin,
  cleIdempotence: schemaCleIdempotence,
})
export type ModifierReglage = z.infer<typeof schemaModifierReglage>

const TYPE_JS_PAR_TYPE_REGLAGE = { entier: 'number', booleen: 'boolean', texte: 'string' } as const

export const schemaReglageDto = z
  .strictObject({
    cle: z.enum(REGLAGE_CLES_LISTE),
    type: z.enum(REGLAGE_TYPES),
    libelle: z.string().min(1),
    aide: z.string().min(1),
    categorie: z.enum(REGLAGE_CATEGORIES),
    reauth: z.boolean(),
    modifiable: z.boolean(),
    /** Drapeau de sécurité : repli fermé si la base est illisible (D-A4-06). */
    securite: z.boolean(),
    /** Valeur en vigueur (table, sinon valeur du code). */
    valeur: schemaReglageValeur,
    /** Valeur du code, rétablie par « Rétablir le défaut ». */
    defaut: schemaReglageValeur,
    /** Vrai si une ligne de la table fixe la valeur (sinon le code décide). */
    surcharge: z.boolean(),
    min: z.number().int().nullable(),
    max: z.number().int().nullable(),
    longueurMax: z.number().int().positive().nullable(),
    modifieLe: schemaInstant.nullable(),
    modifiePar: schemaIdCourt.nullable(),
  })
  .refine(
    (reglage) =>
      typeof reglage.valeur === TYPE_JS_PAR_TYPE_REGLAGE[reglage.type] &&
      typeof reglage.defaut === TYPE_JS_PAR_TYPE_REGLAGE[reglage.type],
    { message: 'La valeur ne correspond pas au type du réglage.' },
  )
export type ReglageDto = z.infer<typeof schemaReglageDto>

/** `GET /api/admin/reglages` : tout le registre (19 réglages), sans pagination. */
export const schemaListeReglagesDto = z.strictObject({
  elements: z.array(schemaReglageDto).max(REGLAGES_LISTE.length),
})
export type ListeReglagesDto = z.infer<typeof schemaListeReglagesDto>

export const schemaModifierReglageReponse = z.strictObject({ reglage: schemaReglageDto, rejoue: z.boolean() })
export type ModifierReglageReponse = z.infer<typeof schemaModifierReglageReponse>

/** `GET /api/public/etat` (public, jamais refusé par la maintenance) : le message n'est donné que pendant une maintenance. */
export const schemaEtatPublicDto = z
  .strictObject({
    maintenance: z.boolean(),
    message: z.string().max(MAINTENANCE_MESSAGE_LONGUEUR_MAX).nullable(),
    /** Faux quand les inscriptions sont fermées (réglage d'accès) : la connexion le dit sans rien révéler d'un compte. */
    inscriptions: z.boolean(),
  })
  .refine((etat) => etat.maintenance || etat.message === null, { message: 'Aucun message hors maintenance.' })
export type EtatPublicDto = z.infer<typeof schemaEtatPublicDto>

// --- Files et jobs ---

/** `POST /api/admin/systemes/jobs/relancer` (réauthentification : non, D-A4-02). Refusé pour `messages-auth`. */
export const schemaJobRelancer = z.strictObject({
  file: schemaFile,
  id: z.string().regex(ADMIN_JOB_ID_FORMAT),
  motif: schemaMotifAdmin,
  cleIdempotence: schemaCleIdempotence,
})
export type JobRelancer = z.infer<typeof schemaJobRelancer>

/** `POST /api/admin/systemes/jobs/purger` (réauthentification : oui) : jobs `failed` seulement, 1 000 au plus. */
export const schemaJobPurger = z.strictObject({
  file: schemaFile,
  motif: schemaMotifAdmin,
  limite: z.number().int().min(1).max(SUPERVISION_PURGE_LIMITE_MAX).default(SUPERVISION_PURGE_LIMITE_MAX),
})
export type JobPurger = z.infer<typeof schemaJobPurger>

/** Un job en échec : identifiant, nom, date, tentatives et CODE réduit (jamais `job.data` ni le message brut). */
export const schemaJobEchecDto = z.strictObject({
  id: z.string().regex(ADMIN_JOB_ID_FORMAT),
  nom: z.string().min(1).max(64),
  echecLe: schemaInstant.nullable(),
  tentatives: schemaCompteur,
  motif: z.string().regex(CODE_ECHEC_FORMAT).nullable(),
})
export type JobEchecDto = z.infer<typeof schemaJobEchecDto>

export const schemaEtatFileDto = z.strictObject({
  file: schemaFile,
  compteurs: z.strictObject({
    attente: schemaCompteur,
    actifs: schemaCompteur,
    differes: schemaCompteur,
    echoues: schemaCompteur,
    termines: schemaCompteur,
  }),
  /** Échecs DÉFINITIFS des 15 dernières minutes (compteur Redis du worker, indépendant de `removeOnFail`). */
  echecs15Min: schemaCompteur,
  /** Faux pour `messages-auth` : le bouton « Relancer » est désactivé et expliqué. */
  relancable: z.boolean(),
  echecs: z.array(schemaJobEchecDto).max(SUPERVISION_ECHECS_LISTES_MAX),
})
export type EtatFileDto = z.infer<typeof schemaEtatFileDto>

/** `GET /api/admin/systemes/jobs`. */
export const schemaEtatFilesDto = z.strictObject({
  files: z.array(schemaEtatFileDto).max(FILES_SUPERVISEES.length),
  /** Réglage `supervision.seuil_echecs_15_min` en vigueur. */
  seuilEchecs15Min: z.number().int().positive(),
  genereLe: schemaInstant,
})
export type EtatFilesDto = z.infer<typeof schemaEtatFilesDto>

/** Réponse de la purge : nombre de jobs `failed` supprimés. La relance répond `schemaActionAdminReponse` (A2). */
export const schemaPurgeFilesReponse = z.strictObject({ purges: schemaCompteur })
export type PurgeFilesReponse = z.infer<typeof schemaPurgeFilesReponse>

// --- Agrégats (lecture seule) ---

/** `?jours=` des agrégats IA, PWA et assistants : 1 à 30 (la table des générations est purgée à 30 jours). */
export const schemaJoursQuery = z.strictObject({
  jours: z.coerce
    .number()
    .int()
    .min(ADMIN_SUPERVISION_JOURS_MIN)
    .max(ADMIN_SUPERVISION_JOURS_MAX)
    .default(ADMIN_SUPERVISION_JOURS_DEFAUT),
})
export type JoursQuery = z.infer<typeof schemaJoursQuery>

/** `?jours=` des envois de codes : 1 à la rétention du journal d'envoi (90 jours). */
export const schemaEnvoisQuery = z.strictObject({
  jours: z.coerce
    .number()
    .int()
    .min(ADMIN_SUPERVISION_JOURS_MIN)
    .max(ENVOIS_CODES_RETENTION_JOURS)
    .default(ADMIN_ENVOIS_JOURS_DEFAUT),
})
export type EnvoisQuery = z.infer<typeof schemaEnvoisQuery>

/** Fenêtre renvoyée : celle de la requête (envois : jusqu'à 90 jours ; IA, PWA et assistants : 30 jours au plus). */
const schemaJoursEnvois = z.number().int().min(ADMIN_SUPERVISION_JOURS_MIN).max(ENVOIS_CODES_RETENTION_JOURS)
const schemaJoursAgregat = z.number().int().min(ADMIN_SUPERVISION_JOURS_MIN).max(ADMIN_SUPERVISION_JOURS_MAX)

/** `GET /api/admin/systemes/envois` : AUCUN identifiant, numéro, adresse ni code (D-A4-15). */
export const schemaEnvoisDto = z.strictObject({
  jours: schemaJoursEnvois,
  total: z.strictObject({ envoyes: schemaCompteur, echecs: schemaCompteur }),
  lignes: z.array(
    z.strictObject({
      canal: z.enum(ENVOIS_CODES_CANAUX),
      /** Code pays alpha-2 déduit de l'indicatif ; `null` pour l'e-mail. */
      pays: z.string().regex(ENVOIS_CODES_PAYS_FORMAT).nullable(),
      envoyes: schemaCompteur,
      echecs: schemaCompteur,
    }),
  ),
  erreurs: z
    .array(z.strictObject({ codeErreur: z.string().min(1).max(ENVOIS_CODES_CODE_ERREUR_MAX), nombre: schemaCompteur }))
    .max(ADMIN_SUPERVISION_ERREURS_TOP_MAX),
  genereLe: schemaInstant,
})
export type EnvoisDto = z.infer<typeof schemaEnvoisDto>

/** `GET /api/admin/systemes/ia` (D-A4-17) : agrégats seulement, jamais `entree` ni `sortie`. */
export const schemaAgregatsIaDto = z.strictObject({
  jours: schemaJoursAgregat,
  total: schemaCompteur,
  parStatut: z.array(z.strictObject({ statut: z.enum(GENERATION_STATUTS), nombre: schemaCompteur })),
  parMotifRepli: z.array(z.strictObject({ motif: z.enum(MOTIFS_REPLI), nombre: schemaCompteur })),
  parType: z.array(z.strictObject({ type: z.enum(IA_TYPES), nombre: schemaCompteur })),
  /** `null` = repli sans appel (aucun fournisseur). */
  parFournisseur: z.array(z.strictObject({ fournisseur: z.string().min(1).max(40).nullable(), nombre: schemaCompteur })),
  /** Totaux de jetons consommés (des nombres, jamais le texte envoyé ni reçu). */
  tokensEntree: schemaCompteur,
  tokensSortie: schemaCompteur,
  dureeMoyenneMs: schemaCompteur.nullable(),
  injectionsSuspectees: schemaCompteur,
  /** Quota mensuel du plan gratuit, affiché seulement (la valeur se modifie dans les versions de plan, A5). `null` = illimité. */
  quotaGratuitMois: schemaCompteur.nullable(),
  /** Identifiant du compte (l'interface le tronque et renvoie vers la fiche utilisateur) : jamais d'e-mail ni de nom. */
  consommateurs: z.array(z.strictObject({ utilisateurId: schemaIdCourt, nombre: schemaCompteur })).max(ADMIN_SUPERVISION_TOP_MAX),
  genereLe: schemaInstant,
})
export type AgregatsIaDto = z.infer<typeof schemaAgregatsIaDto>

/** `GET /api/admin/systemes/pwa` : événements d'installation du studio (aucune donnée personnelle). */
export const schemaAgregatsPwaDto = z.strictObject({
  jours: schemaJoursAgregat,
  total: schemaCompteur,
  lignes: z.array(
    z.strictObject({
      type: schemaPwaInstallEvent.shape.type,
      origine: schemaPwaInstallEvent.shape.origine,
      deviceType: schemaPwaInstallEvent.shape.deviceType,
      nombre: schemaCompteur,
    }),
  ),
  genereLe: schemaInstant,
})
export type AgregatsPwaDto = z.infer<typeof schemaAgregatsPwaDto>

/** `GET /api/admin/systemes/assistants` : `journal_assistant` agrégé, sans `arguments_resume`, `resultat`, `avant`, `apres`. */
export const schemaAgregatsAssistantsDto = z.strictObject({
  jours: schemaJoursAgregat,
  total: schemaCompteur,
  comptesActifs: schemaCompteur,
  /** Capacités `mcp` accordées par l'administration et non révoquées. */
  capacitesActives: schemaCompteur,
  parOutil: z.array(z.strictObject({ outil: z.string().min(1).max(ADMIN_CIBLE_ID_MAX), nombre: schemaCompteur })),
  parAssistant: z
    .array(z.strictObject({ assistantId: z.string().min(1).max(ADMIN_CIBLE_ID_MAX), nombre: schemaCompteur }))
    .max(ADMIN_SUPERVISION_ASSISTANTS_MAX),
  genereLe: schemaInstant,
})
export type AgregatsAssistantsDto = z.infer<typeof schemaAgregatsAssistantsDto>

const schemaControleSante = z.strictObject({
  etat: z.enum(SANTE_ETATS),
  latenceMs: schemaCompteur.nullable(),
})

/** `GET /api/admin/systemes/sante` : base, Redis, disque, dernière sauvegarde (`inconnue` si aucun battement), version. */
export const schemaSanteDto = z.strictObject({
  base: schemaControleSante,
  redis: schemaControleSante,
  disque: z.strictObject({
    etat: z.enum(SANTE_ETATS),
    libreOctets: schemaCompteur.nullable(),
    totalOctets: schemaCompteur.nullable(),
    libresPct: z.number().min(0).max(100).nullable(),
  }),
  sauvegarde: z.strictObject({
    etat: z.enum(SAUVEGARDE_ETATS),
    derniereReussiteLe: schemaInstant.nullable(),
    ageHeures: z.number().nonnegative().nullable(),
  }),
  version: z.string().regex(APP_VERSION_FORMAT),
  genereLe: schemaInstant,
})
export type SanteDto = z.infer<typeof schemaSanteDto>

// --- Capacités accordées (routes d'A2 sous /api/admin/utilisateurs/[id]/capacites) ---

const schemaCapacite = z.enum(CAPACITES_PAYANTES)

/** `POST …/capacites` (réauthentification : oui ; clé d'idempotence dans l'en-tête, comme A2). */
export const schemaCapaciteAccorder = z.strictObject({ capacite: schemaCapacite, motif: schemaMotifAdmin })
export type CapaciteAccorder = z.infer<typeof schemaCapaciteAccorder>

/** `[id]` et `[capacite]` de `DELETE …/capacites/[capacite]` (corps : `schemaActionMotif` d'A2). */
export const schemaCapaciteParam = z.strictObject({ id: schemaIdAdmin, capacite: schemaCapacite })
export type CapaciteParam = z.infer<typeof schemaCapaciteParam>

export const schemaCapaciteDto = z.strictObject({
  id: schemaIdCourt,
  utilisateurId: schemaIdCourt,
  capacite: schemaCapacite,
  motif: z.string().min(1),
  accordePar: schemaIdCourt,
  accordeLe: schemaInstant,
  revoqueLe: schemaInstant.nullable(),
})
export type CapaciteDto = z.infer<typeof schemaCapaciteDto>

export const schemaCapaciteReponse = z.strictObject({ capacite: schemaCapaciteDto, rejoue: z.boolean() })
export type CapaciteReponse = z.infer<typeof schemaCapaciteReponse>

// --- Journal d'administration ---

const schemaFiltresJournalBase = z.strictObject({
  adminId: schemaIdAdmin.optional(),
  action: z.string().regex(ADMIN_ACTION_FORMAT).optional(),
  cibleType: z.string().regex(ADMIN_CIBLE_TYPE_FORMAT).optional(),
  cibleId: schemaIdAdmin.optional(),
  du: schemaDateJour.optional(),
  au: schemaDateJour.optional(),
})

const periodeCoherente = (filtres: { du?: string | undefined, au?: string | undefined }): boolean =>
  filtres.du === undefined || filtres.au === undefined || filtres.du <= filtres.au

/** Filtres communs à la liste et à l'export du journal (`du` <= `au`). */
export const schemaFiltresJournal = schemaFiltresJournalBase.refine(periodeCoherente, {
  message: 'La date de début doit précéder la date de fin.',
  path: ['du'],
})
export type FiltresJournal = z.infer<typeof schemaFiltresJournal>

/** `GET /api/admin/journal?…&page&limite` (limite 100 au plus). */
export const schemaListeJournalQuery = schemaPaginationAdmin
  .extend(schemaFiltresJournalBase.shape)
  .refine(periodeCoherente, { message: 'La date de début doit précéder la date de fin.', path: ['du'] })
export type ListeJournalQuery = z.infer<typeof schemaListeJournalQuery>

/** `POST /api/admin/journal/export` : motif dans le corps (jamais dans l'URL) ; journalisé `journal.exporter`. */
export const schemaExportJournal = z.strictObject({
  motif: schemaMotifAdmin,
  filtres: schemaFiltresJournal.default({}),
})
export type ExportJournal = z.infer<typeof schemaExportJournal>

/** `avant`/`apres` : objet PLAT (clés `^[a-z_]+$`, valeurs courtes), comme à l'écriture (D-A1-09, D-A4-20). */
const schemaEtatJournal = z
  .record(
    z.string().regex(AUDIT_CLE_FORMAT),
    z.union([z.string().max(AUDIT_VALEUR_TEXTE_MAX), z.number(), z.boolean(), z.null()]),
  )
  .nullable()

/** Une entrée du journal. Ni adresse IP ni clé d'idempotence en sortie. */
export const schemaJournalEntreeDto = z.strictObject({
  id: schemaIdCourt,
  numero: z.number().int().min(1),
  adminId: schemaIdCourt,
  action: z.string().regex(ADMIN_ACTION_FORMAT),
  cibleType: z.string().regex(ADMIN_CIBLE_TYPE_FORMAT),
  cibleId: schemaIdCourt.nullable(),
  motif: z.string().min(1),
  avant: schemaEtatJournal,
  apres: schemaEtatJournal,
  creeLe: schemaInstant,
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
})
export type JournalEntreeDto = z.infer<typeof schemaJournalEntreeDto>

export const schemaListeJournalDto = z.strictObject({
  elements: z.array(schemaJournalEntreeDto).max(ADMIN_LISTE_LIMITE_MAX),
  total: schemaCompteur,
  page: z.number().int().min(1),
  limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
})
export type ListeJournalDto = z.infer<typeof schemaListeJournalDto>

/** `GET …/journal/verifier` : `premiereRupture` = `numero` de la première ligne incohérente, sinon `null` (CA14). */
export const schemaJournalVerificationDto = z
  .strictObject({
    intacte: z.boolean(),
    premiereRupture: z.number().int().min(1).nullable(),
  })
  .refine((verification) => verification.intacte === (verification.premiereRupture === null), {
    message: 'Une chaîne intacte n’a pas de rupture, une chaîne rompue en a une.',
  })
export type JournalVerificationDto = z.infer<typeof schemaJournalVerificationDto>
