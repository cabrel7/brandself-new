// A3 : contrat FIGÉ des routes d'administration des abonnements, paiements, revenus et alertes. Zod strict en
// entrée ET en sortie ; les réponses sont construites champ par champ puis validées. Jamais exposés : téléphone ou
// numéro du payeur (D-A3-10), contenu brut des événements, champ de visiteur. Le seul champ personnel est l'e-mail
// du titulaire du compte (`utilisateur.email`, `null` si le compte est supprimé).
import { z } from 'zod'
import {
  ABONNEMENT_ONGLETS,
  PAIEMENT_SOURCES,
  REVERIFICATION_RESULTATS,
  EXPORT_PAIEMENTS_COLONNES,
} from '../admin-paiements'
import { ADMIN_CIBLE_ID_MAX, ADMIN_LISTE_LIMITE_MAX } from '../admin'
import { ADMIN_ALERTE_INCOHERENCES_MAX } from '../limites'
import { ABONNEMENT_ORIGINES } from '../admin-a2'
import {
  CODE_ECHEC_FORMAT,
  DEVISE_FORMAT,
  EVENEMENT_SOURCES,
  FOURNISSEUR_FORMAT,
  METHODE_FORMAT,
  PAIEMENT_STATUTS,
  TRAITEMENTS_EVENEMENT,
} from '../paiements'
import { ETATS_ABONNEMENT, PERIODES_MOIS, PLAN_IDS } from '../plans'
import { schemaMotifAdmin } from './admin'
import { schemaCleIdempotence, schemaPaginationAdmin } from './admin-a2'

const schemaInstant = z.iso.datetime()
const schemaDateJour = z.iso.date()
const schemaCompteur = z.number().int().nonnegative()
const schemaMontant = z.number().int().nonnegative()
const schemaDevise = z.string().regex(DEVISE_FORMAT)
const schemaPeriodeMois = z.literal([...PERIODES_MOIS])
const schemaIdCourt = z.string().min(1).max(ADMIN_CIBLE_ID_MAX)

// --- Entrées ---

/** Filtres communs à la liste des paiements et à l'export. */
export const schemaFiltresPaiements = z.strictObject({
  statut: z.enum(PAIEMENT_STATUTS).optional(),
  source: z.enum(PAIEMENT_SOURCES).optional(),
  devise: schemaDevise.optional(),
  du: schemaDateJour.optional(),
  au: schemaDateJour.optional(),
})
export type FiltresPaiements = z.infer<typeof schemaFiltresPaiements>

/** `GET /api/admin/paiements?statut&source&devise&du&au&page&limite`. */
export const schemaListePaiementsQuery = schemaPaginationAdmin.extend(schemaFiltresPaiements.shape)
export type ListePaiementsQuery = z.infer<typeof schemaListePaiementsQuery>

/** `GET /api/admin/abonnements?onglet&page&limite`. */
export const schemaListeAbonnementsQuery = schemaPaginationAdmin.extend({
  onglet: z.enum(ABONNEMENT_ONGLETS),
})
export type ListeAbonnementsQuery = z.infer<typeof schemaListeAbonnementsQuery>

/** `POST /api/admin/abonnements/[id]/rappel`. */
export const schemaRappelAbonnement = z.strictObject({ motif: schemaMotifAdmin })
export type RappelAbonnement = z.infer<typeof schemaRappelAbonnement>

/** `POST /api/admin/paiements/[id]/reverifier` et `…/marquer-paye` (ce dernier exige aussi l'en-tête `x-admin-reauth`). */
export const schemaActionPaiement = z.strictObject({
  motif: schemaMotifAdmin,
  cleIdempotence: schemaCleIdempotence,
})
export type ActionPaiement = z.infer<typeof schemaActionPaiement>

/** `POST /api/admin/export/paiements` : motif dans le corps (jamais dans l'URL). */
export const schemaExportPaiements = z.strictObject({
  motif: schemaMotifAdmin,
  filtres: schemaFiltresPaiements.default({}),
})
export type ExportPaiements = z.infer<typeof schemaExportPaiements>

/** Colonnes de l'export CSV (documentation exécutable : l'en-tête du fichier). */
export const schemaExportColonne = z.enum(EXPORT_PAIEMENTS_COLONNES)

// --- Sorties ---

const schemaTitulaire = z.strictObject({ id: schemaIdCourt, email: z.string() })

/** Un paiement. N'expose ni téléphone, ni numéro, ni empreinte, ni `telephone_*`. `utilisateur` est `null` si le compte est supprimé. */
export const schemaPaiementDto = z.strictObject({
  id: schemaIdCourt,
  reference: z.string(),
  fournisseur: z.string().regex(FOURNISSEUR_FORMAT),
  source: z.enum(PAIEMENT_SOURCES),
  methode: z.string().regex(METHODE_FORMAT),
  operateur: z.string().nullable(),
  statut: z.enum(PAIEMENT_STATUTS),
  plan: z.enum(PLAN_IDS),
  periodeMois: schemaPeriodeMois,
  devise: schemaDevise,
  montant: schemaMontant,
  fraisReels: schemaMontant.nullable(),
  netReel: schemaMontant.nullable(),
  codeEchec: z.string().regex(CODE_ECHEC_FORMAT).nullable(),
  creeLe: schemaInstant,
  appliqueLe: schemaInstant.nullable(),
  termineLe: schemaInstant.nullable(),
  utilisateur: schemaTitulaire.nullable(),
})
export type PaiementDto = z.infer<typeof schemaPaiementDto>

export const schemaListePaiementsDto = z.strictObject({
  elements: z.array(schemaPaiementDto).max(ADMIN_LISTE_LIMITE_MAX),
  total: schemaCompteur,
  page: z.number().int().min(1),
  limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
})
export type ListePaiementsDto = z.infer<typeof schemaListePaiementsDto>

/** Événement du fournisseur : seuls ces champs sortent (jamais le corps reçu). `motif` est un code technique. */
export const schemaEvenementPaiementDto = z.strictObject({
  evenement: z.string(),
  source: z.enum(EVENEMENT_SOURCES),
  traitement: z.enum(TRAITEMENTS_EVENEMENT),
  motif: z.string().nullable(),
  recuLe: schemaInstant,
})
export type EvenementPaiementDto = z.infer<typeof schemaEvenementPaiementDto>

/** `GET /api/admin/paiements/[id]`. `reverifieNonReussiLe` : dernière revérification « non réussi » (D-A3-03), sinon `null`. */
export const schemaPaiementDetailDto = z.strictObject({
  paiement: schemaPaiementDto,
  evenements: z.array(schemaEvenementPaiementDto),
  reverifieNonReussiLe: schemaInstant.nullable(),
})
export type PaiementDetailDto = z.infer<typeof schemaPaiementDetailDto>

const schemaDernierPaiement = z.strictObject({
  id: schemaIdCourt,
  statut: z.enum(PAIEMENT_STATUTS),
  montant: schemaMontant,
  devise: schemaDevise,
  creeLe: schemaInstant,
})

export const schemaAbonnementAdminDto = z.strictObject({
  id: schemaIdCourt,
  utilisateur: z.strictObject({ id: schemaIdCourt, email: z.string() }),
  plan: z.enum(PLAN_IDS),
  devise: schemaDevise,
  expireLe: schemaInstant,
  etat: z.enum(ETATS_ABONNEMENT),
  origine: z.enum(ABONNEMENT_ORIGINES),
  dernierPaiement: schemaDernierPaiement.nullable(),
})
export type AbonnementAdminDto = z.infer<typeof schemaAbonnementAdminDto>

export const schemaListeAbonnementsDto = z.strictObject({
  onglet: z.enum(ABONNEMENT_ONGLETS),
  elements: z.array(schemaAbonnementAdminDto).max(ADMIN_LISTE_LIMITE_MAX),
  total: schemaCompteur,
  page: z.number().int().min(1),
  limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
})
export type ListeAbonnementsDto = z.infer<typeof schemaListeAbonnementsDto>

/** Agrégat d'une source sur un mois : montants bruts appliqués, frais réels connus et nombre de paiements sans frais connus. */
const schemaAgregatRevenu = z.strictObject({
  brut: schemaMontant,
  nombre: schemaCompteur,
  fraisReels: schemaMontant,
  nombreSansFrais: schemaCompteur,
})
export type AgregatRevenuDto = z.infer<typeof schemaAgregatRevenu>

const schemaPeriodeRevenu = z.strictObject({
  debut: schemaInstant,
  fin: schemaInstant,
  kpay: schemaAgregatRevenu,
  manuel: schemaAgregatRevenu,
})

/** Une carte de revenus : une devise, jamais d'addition entre devises (D-A3-01). */
export const schemaRevenuDeviseDto = z.strictObject({
  devise: schemaDevise,
  mois: z.strictObject({ courant: schemaPeriodeRevenu, precedent: schemaPeriodeRevenu }),
  abonnesActifs: schemaCompteur,
  repartition: z.array(z.strictObject({ periodeMois: schemaPeriodeMois, nombre: schemaCompteur, brut: schemaMontant })),
})
export type RevenuDeviseDto = z.infer<typeof schemaRevenuDeviseDto>

/** `GET /api/admin/revenus`. Les jours offerts n'ont pas de devise : ils sont au niveau de la réponse. */
export const schemaRevenusDto = z.strictObject({
  devises: z.array(schemaRevenuDeviseDto),
  offerts: z.strictObject({ jours: schemaCompteur, nombre: schemaCompteur }),
  mention: z.string().min(1),
  genereLe: schemaInstant,
})
export type RevenusDto = z.infer<typeof schemaRevenusDto>

/** `GET /api/admin/alertes` (D-A3-13). Identifiants d'incohérence bornés à `ADMIN_ALERTE_INCOHERENCES_MAX`. */
export const schemaAlertesDto = z.strictObject({
  paiementsEnAttente: z.strictObject({
    nombre: schemaCompteur,
    ids: z.array(schemaIdCourt).max(ADMIN_ALERTE_INCOHERENCES_MAX),
  }),
  webhooksRefuses1h: schemaCompteur,
  incoherences: z.strictObject({
    paiementsSansProlongation: z.array(schemaIdCourt).max(ADMIN_ALERTE_INCOHERENCES_MAX),
    abonnementsSansPaiement: z.array(schemaIdCourt).max(ADMIN_ALERTE_INCOHERENCES_MAX),
  }),
  encaissementsTardifs: schemaCompteur,
  genereLe: schemaInstant,
})
export type AlertesDto = z.infer<typeof schemaAlertesDto>

/** E1 D11 : indicateur de conversions des essais. `tauxPct` : entier de 0 à 100, `null` si aucun essai accordé. */
export const schemaEssaisStatistiquesDto = z.strictObject({
  jours: z.number().int().min(1),
  accordes: schemaCompteur,
  enCours: schemaCompteur,
  convertis: schemaCompteur,
  tauxPct: z.number().int().min(0).max(100).nullable(),
})
export type EssaisStatistiquesDto = z.infer<typeof schemaEssaisStatistiquesDto>

/**
 * `GET /api/admin/vue-ensemble` enrichi (A3). REMPLACE `schemaVueEnsembleDto` d'A1 (qui interdit tout compteur) :
 * l'entrée de CONTRAT et le test d'A1 « sans compteur » doivent être mis à jour ensemble.
 */
export const schemaVueEnsembleEnrichieDto = z.strictObject({
  admin: z.strictObject({ nom: z.string() }),
  compteurs: z.strictObject({
    inscrits: schemaCompteur,
    vitrinesPubliees: schemaCompteur,
    abonnesPayants: schemaCompteur,
  }),
  /** Encaissé K-PAY du mois courant par devise (D-A3-01), brut présumé (`mention`). */
  revenus: z.array(z.strictObject({ devise: schemaDevise, encaisseMoisCourant: schemaMontant, nombre: schemaCompteur })),
  /** D-A3-12 : vitrines publiées avec au moins une vue ou une réservation sur 30 jours, et dénominateur. */
  indicateurReussite: z.strictObject({ vitrinesActives: schemaCompteur, vitrinesPubliees: schemaCompteur }),
  mention: z.string().min(1),
  alertes: schemaAlertesDto,
  /** E1 D11 : essais gratuits sur `jours` jours glissants (accordés, en cours, convertis ; taux = convertis / accordés). */
  essais: schemaEssaisStatistiquesDto,
  genereLe: schemaInstant,
})
export type VueEnsembleEnrichieDto = z.infer<typeof schemaVueEnsembleEnrichieDto>

/** `POST …/reverifier`. `rejoue` : réponse relue du journal (aucun appel K-PAY). */
export const schemaReverificationReponse = z.strictObject({
  resultat: z.enum(REVERIFICATION_RESULTATS),
  statut: z.enum(PAIEMENT_STATUTS),
  rejoue: z.boolean(),
})
export type ReverificationReponse = z.infer<typeof schemaReverificationReponse>

/** `POST …/marquer-paye` : identifiant du paiement manuel créé et nouvelle échéance. */
export const schemaMarquagePaiementReponse = z.strictObject({
  paiementId: schemaIdCourt,
  expireLe: schemaInstant,
  rejoue: z.boolean(),
})
export type MarquagePaiementReponse = z.infer<typeof schemaMarquagePaiementReponse>

/** `POST …/rappel` (202). */
export const schemaRappelAbonnementReponse = z.strictObject({ planifie: z.literal(true) })
export type RappelAbonnementReponse = z.infer<typeof schemaRappelAbonnementReponse>
