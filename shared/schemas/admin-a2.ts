// A2 : contrats Zod STRICTS (entrées ET sorties) des utilisateurs, vitrines et assistants. Les réponses sont
// construites champ par champ (jamais de spread d'une ligne) puis validées par ces schémas : une clé en trop fait
// échouer la réponse. Interdits en sortie : nom, e-mail ou téléphone d'un VISITEUR, motif/message/contenu d'une
// réservation, demande ou message, adresse IP, jetons (spec §5).
import { z } from 'zod'
import {
  ADMIN_CIBLE_ID_MAX,
  ADMIN_CLE_IDEMPOTENCE_FORMAT,
  ADMIN_CLE_IDEMPOTENCE_MAX,
  ADMIN_CLE_IDEMPOTENCE_MIN,
  ADMIN_LISTE_LIMITE_DEFAUT,
  ADMIN_LISTE_LIMITE_MAX,
  ADMIN_LISTE_PAGE_MAX,
  ADMIN_ORDRES,
} from '../admin'
import {
  ADMIN_EMAIL_CONFIRMATION_MAX,
  ADMIN_FICHE_LIGNES_MAX,
  ADMIN_FILTRES_VITRINE_UTILISATEUR,
  ADMIN_JOURS_MAX,
  ADMIN_JOURS_MIN,
  ADMIN_PLANS_CHANGEMENT,
  ADMIN_RECHERCHE_MAX,
  ADMIN_RECHERCHE_MIN,
  ADMIN_STATUTS_VITRINE,
  ADMIN_UTILISATEURS_TRIS,
  ADMIN_UTILISATEURS_TRI_DEFAUT,
  ADMIN_VITRINES_TRIS,
  ADMIN_VITRINES_TRI_DEFAUT,
  ABONNEMENT_ORIGINES,
} from '../admin-a2'
import { CAPACITES_PAYANTES, ETATS_ABONNEMENT, PLAN_IDS } from '../plans'
import { schemaMotifAdmin } from './admin'

// --- Briques communes (réutilisées par A3) ---

/** Identifiant de cible dans l'URL (`[id]`). */
export const schemaIdAdmin = z.string().min(1).max(ADMIN_CIBLE_ID_MAX)

/** Clé d'idempotence (D-A2-06) : 8 à 128 caractères sûrs. En-tête `Idempotency-Key` (A2) ou champ du corps (A3). */
export const schemaCleIdempotence = z
  .string()
  .min(ADMIN_CLE_IDEMPOTENCE_MIN)
  .max(ADMIN_CLE_IDEMPOTENCE_MAX)
  .regex(ADMIN_CLE_IDEMPOTENCE_FORMAT)

/** Pagination par page (1 = première) : valeurs venues de la query string, donc converties. */
export const schemaPaginationAdmin = z.strictObject({
  page: z.coerce.number().int().min(1).max(ADMIN_LISTE_PAGE_MAX).default(1),
  limite: z.coerce.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX).default(ADMIN_LISTE_LIMITE_DEFAUT),
})
export type PaginationAdmin = z.infer<typeof schemaPaginationAdmin>

const schemaDateJour = z.iso.date()
const schemaInstant = z.iso.datetime()
const schemaCompteur = z.number().int().nonnegative()
const schemaPlan = z.enum(PLAN_IDS)
const schemaEtat = z.enum(ETATS_ABONNEMENT)

// --- Entrées ---

/** `GET /api/admin/recherche?q=` (D-A2-11, CA09 : moins de 3 caractères = 422). */
export const schemaRechercheQuery = z.strictObject({
  q: z.string().trim().min(ADMIN_RECHERCHE_MIN).max(ADMIN_RECHERCHE_MAX),
})
export type RechercheQuery = z.infer<typeof schemaRechercheQuery>

/** `GET /api/admin/utilisateurs`. */
export const schemaListeUtilisateursQuery = schemaPaginationAdmin.extend({
  q: z.string().trim().min(ADMIN_RECHERCHE_MIN).max(ADMIN_RECHERCHE_MAX).optional(),
  plan: schemaPlan.optional(),
  etat: schemaEtat.optional(),
  suspendu: z.stringbool().optional(),
  vitrine: z.enum(ADMIN_FILTRES_VITRINE_UTILISATEUR).optional(),
  du: schemaDateJour.optional(),
  au: schemaDateJour.optional(),
  tri: z.enum(ADMIN_UTILISATEURS_TRIS).default(ADMIN_UTILISATEURS_TRI_DEFAUT),
  ordre: z.enum(ADMIN_ORDRES).default('desc'),
})
export type ListeUtilisateursQuery = z.infer<typeof schemaListeUtilisateursQuery>

/** `GET /api/admin/vitrines`. */
export const schemaListeVitrinesQuery = schemaPaginationAdmin.extend({
  q: z.string().trim().min(ADMIN_RECHERCHE_MIN).max(ADMIN_RECHERCHE_MAX).optional(),
  plan: schemaPlan.optional(),
  statut: z.enum(ADMIN_STATUTS_VITRINE).optional(),
  tri: z.enum(ADMIN_VITRINES_TRIS).default(ADMIN_VITRINES_TRI_DEFAUT),
  ordre: z.enum(ADMIN_ORDRES).default('desc'),
})
export type ListeVitrinesQuery = z.infer<typeof schemaListeVitrinesQuery>

/** `GET /api/admin/assistants?utilisateurId=`. */
export const schemaListeAssistantsQuery = z.strictObject({ utilisateurId: schemaIdAdmin })

/** Corps des actions à motif seul : suspendre, réactiver, révoquer les sessions, retirer les assistants, (dé)publier. */
export const schemaActionMotif = z.strictObject({ motif: schemaMotifAdmin })
export type ActionMotif = z.infer<typeof schemaActionMotif>

/** `POST …/offrir-jours` (clé d'idempotence dans l'en-tête). */
export const schemaOffrirJours = z.strictObject({
  motif: schemaMotifAdmin,
  jours: z.number().int().min(ADMIN_JOURS_MIN).max(ADMIN_JOURS_MAX),
})
export type OffrirJours = z.infer<typeof schemaOffrirJours>

/** `POST …/changer-plan` : `payant` exige `jours` (D-A2-05), `gratuit` n'en accepte pas. Clé dans l'en-tête. */
export const schemaChangerPlan = z.discriminatedUnion('plan', [
  z.strictObject({
    plan: z.literal(ADMIN_PLANS_CHANGEMENT[0]),
    motif: schemaMotifAdmin,
    jours: z.number().int().min(ADMIN_JOURS_MIN).max(ADMIN_JOURS_MAX),
  }),
  z.strictObject({ plan: z.literal(ADMIN_PLANS_CHANGEMENT[1]), motif: schemaMotifAdmin }),
])
export type ChangerPlan = z.infer<typeof schemaChangerPlan>

/** `POST …/supprimer` (D-A2-08) : l'e-mail exact du compte est ressaisi ; la comparaison se fait côté service. */
export const schemaSupprimerUtilisateur = z.strictObject({
  motif: schemaMotifAdmin,
  emailConfirmation: z.string().trim().min(3).max(ADMIN_EMAIL_CONFIRMATION_MAX),
})
export type SupprimerUtilisateur = z.infer<typeof schemaSupprimerUtilisateur>

// --- Sorties ---

const schemaVitrineEtatCourt = z.strictObject({ publiee: z.boolean(), bloquee: z.boolean() })

/** Ligne de la liste des utilisateurs. `nom` et `email` sont ceux du PROFESSIONNEL titulaire, jamais d'un visiteur. */
export const schemaUtilisateurLigneDto = z.strictObject({
  id: z.string(),
  nom: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  plan: schemaPlan,
  etat: schemaEtat,
  suspendu: z.boolean(),
  inscritLe: schemaInstant,
  derniereConnexion: schemaInstant.nullable(),
  vitrine: schemaVitrineEtatCourt.nullable(),
})
export type UtilisateurLigneDto = z.infer<typeof schemaUtilisateurLigneDto>

const schemaAbonnementFiche = z.strictObject({
  origine: z.enum(ABONNEMENT_ORIGINES),
  expireLe: schemaInstant,
  premiereActivationLe: schemaInstant,
})

const schemaSessionActive = z.strictObject({ id: z.string(), creeLe: schemaInstant, expireLe: schemaInstant })

/** Consentement d'un assistant (client OAuth) : identifiant du consentement, jamais de jeton. */
export const schemaAssistantDto = z.strictObject({
  id: z.string(),
  client: z.string(),
  portees: z.array(z.string()),
  dernierUsage: schemaInstant.nullable(),
})
export type AssistantDto = z.infer<typeof schemaAssistantDto>

export const schemaUtilisateurFicheDto = schemaUtilisateurLigneDto.extend({
  /** Téléphone du PROFESSIONNEL titulaire (jamais d'un visiteur). */
  telephone: z.string().nullable(),
  pays: z.string().nullable(),
  devise: z.string(),
  fuseau: z.string(),
  motifSuspension: z.string().nullable(),
  abonnement: schemaAbonnementFiche.nullable(),
  compteurs: z.strictObject({
    services: schemaCompteur,
    realisations: schemaCompteur,
    temoignages: schemaCompteur,
    liens: schemaCompteur,
  }),
  /** Nombres seulement : jamais le contenu d'une réservation, d'une demande ou d'un message. */
  activite30j: z.strictObject({
    vues: schemaCompteur,
    reservations: schemaCompteur,
    demandes: schemaCompteur,
    messages: schemaCompteur,
  }),
  iaMois: schemaCompteur,
  sessionsActives: z.array(schemaSessionActive).max(ADMIN_FICHE_LIGNES_MAX),
  assistants: z.array(schemaAssistantDto).max(ADMIN_FICHE_LIGNES_MAX),
  /** A4 : capacités accordées par l'administration à ce compte (hors plan), pour n'afficher que l'action utile. */
  capacites: z.array(z.enum(CAPACITES_PAYANTES)).max(CAPACITES_PAYANTES.length),
})
export type UtilisateurFicheDto = z.infer<typeof schemaUtilisateurFicheDto>

const schemaPagination = {
  total: schemaCompteur,
  page: z.number().int().min(1),
  limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
}

export const schemaListeUtilisateursDto = z.strictObject({
  elements: z.array(schemaUtilisateurLigneDto).max(ADMIN_LISTE_LIMITE_MAX),
  ...schemaPagination,
})
export type ListeUtilisateursDto = z.infer<typeof schemaListeUtilisateursDto>

export const schemaVitrineLigneDto = z.strictObject({
  id: z.string(),
  utilisateurId: z.string(),
  username: z.string(),
  nom: z.string(),
  metier: z.string().nullable(),
  plan: schemaPlan,
  publiee: z.boolean(),
  bloquee: z.boolean(),
  /** Visible du professionnel (D-A2-13) : ne contient jamais de donnée de visiteur. */
  blocageMotif: z.string().nullable(),
  proprietaireSuspendu: z.boolean(),
  creeLe: schemaInstant,
})
export type VitrineLigneDto = z.infer<typeof schemaVitrineLigneDto>

export const schemaVitrineFicheDto = schemaVitrineLigneDto.extend({
  publieeLe: schemaInstant.nullable(),
  compteurs: z.strictObject({
    services: schemaCompteur,
    realisations: schemaCompteur,
    temoignages: schemaCompteur,
    liens: schemaCompteur,
  }),
})
export type VitrineFicheDto = z.infer<typeof schemaVitrineFicheDto>

export const schemaListeVitrinesDto = z.strictObject({
  elements: z.array(schemaVitrineLigneDto).max(ADMIN_LISTE_LIMITE_MAX),
  ...schemaPagination,
})
export type ListeVitrinesDto = z.infer<typeof schemaListeVitrinesDto>

/** `GET /api/admin/recherche` : au plus `ADMIN_RECHERCHE_PAR_GROUPE` éléments par groupe. */
export const schemaRechercheDto = z.strictObject({
  utilisateurs: z.array(schemaUtilisateurLigneDto),
  vitrines: z.array(schemaVitrineLigneDto),
})
export type RechercheDto = z.infer<typeof schemaRechercheDto>

export const schemaListeAssistantsDto = z.strictObject({
  elements: z.array(schemaAssistantDto).max(ADMIN_FICHE_LIGNES_MAX),
})
export type ListeAssistantsDto = z.infer<typeof schemaListeAssistantsDto>

/** Réponse des actions sans résultat propre (suspendre, réactiver, dépublier, republier, supprimer, retirer). */
export const schemaActionAdminReponse = z.strictObject({ effectue: z.literal(true), rejoue: z.boolean() })
export type ActionAdminReponse = z.infer<typeof schemaActionAdminReponse>

export const schemaOffrirJoursReponse = z.strictObject({ expireLe: schemaInstant, rejoue: z.boolean() })
export type OffrirJoursReponse = z.infer<typeof schemaOffrirJoursReponse>

export const schemaChangerPlanReponse = z.strictObject({
  plan: schemaPlan,
  expireLe: schemaInstant.nullable(),
  rejoue: z.boolean(),
})
export type ChangerPlanReponse = z.infer<typeof schemaChangerPlanReponse>

/** Révoquer les sessions ou retirer les assistants d'un compte : nombre d'éléments touchés. */
export const schemaRevocationReponse = z.strictObject({ revoques: schemaCompteur })
export type RevocationReponse = z.infer<typeof schemaRevocationReponse>
