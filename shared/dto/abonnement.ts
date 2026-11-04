import type { MethodePaiement, PaiementStatut } from '../paiements'
import type { EtatAbonnement, PeriodeMois, PlanId, RessourceQuota } from '../plans'

// S10 (docs/specs/S10-abonnements.md §3.6). Aucune donnée du compte K-PAY, aucun identifiant du fournisseur,
// aucune empreinte de numéro, aucun numéro en clair ne figure dans un DTO.

/** Usage d'une ressource au regard de la limite du plan effectif (`limite: null` = illimité). */
export interface QuotaDTO {
  ressource: RessourceQuota
  utilise: number
  limite: number | null
}

/** Ajouté aux compteurs studio des services, réalisations et témoignages. */
export interface LimitePlanDTO {
  limite: number | null
  utilise: number
  atteinte: boolean
}

export interface PrixPeriodeDTO {
  periodeMois: PeriodeMois
  /** Unité mineure de la devise. */
  montant: number
  montantParMois: number
  /** Pourcentage entier, 0 sans remise. */
  remisePct: number
  miseEnAvant: boolean
}

export interface DeviseOffreDTO {
  devise: string
  /** Décimales de l'unité mineure (0 pour XAF). */
  exposant: number
  prix: PrixPeriodeDTO[]
}

export interface MoyenPaiementDTO {
  /** `fournisseur:OPERATEUR`, à renvoyer tel quel à l'initiation. */
  id: string
  libelle: string
  methode: MethodePaiement
  devise: string
  indicatif: string
  /** Exemple de numéro national, pour l'aide à la saisie. */
  exemple: string
}

export interface OffreDTO {
  paiementDisponible: boolean
  devises: DeviseOffreDTO[]
  deviseParDefaut: string | null
  moyens: MoyenPaiementDTO[]
}

export interface PaiementDTO {
  id: string
  statut: PaiementStatut
  periodeMois: number
  montant: number
  devise: string
  moyenLibelle: string
  /** `+237 6•• ••• •89` : jamais le numéro complet. */
  telephoneMasque: string | null
  /** Message au payeur, seulement pour un échec, une annulation ou une expiration. */
  messageEchec: string | null
  creeLe: string
  termineLe: string | null
  /** Instant ISO à partir duquel une nouvelle initiation est acceptée. */
  relanceDisponibleLe: string
  /** Nouvelle échéance, une fois le paiement appliqué. */
  abonnementExpireLe: string | null
}

export interface AbonnementDTO {
  plan: PlanId
  etat: EtatAbonnement
  expireLe: string | null
  /** Date locale (AAAA-MM-JJ) du dernier jour payé. */
  dernierJourInclus: string | null
  graceJusquau: string | null
  joursRestants: number | null
  /** Toujours faux : le Mobile Money exige une validation sur le téléphone à chaque période. */
  renouvellementAutomatique: false
  quotas: QuotaDTO[]
  paiementEnCours: PaiementDTO | null
  offre: OffreDTO
}

export interface PlanTarifDTO {
  id: PlanId
  limites: Record<RessourceQuota, number | null>
  badge: boolean
  statistiquesJours: number
}

/** `GET /api/public/tarifs` : plans, limites et prix issus de la configuration serveur. */
export interface TarifsDTO {
  plans: PlanTarifDTO[]
  offre: OffreDTO
  graceJours: number
  renouvellementAutomatique: false
}

/** `POST /api/studio/abonnement/paiements` et `GET …/paiements/:id`. */
export interface PaiementReponse {
  paiement: PaiementDTO
}
