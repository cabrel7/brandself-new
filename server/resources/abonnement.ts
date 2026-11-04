import type { Paiement } from '../../shared/db/schema'
import type { AbonnementDTO, PaiementDTO, PlanTarifDTO, TarifsDTO } from '../../shared/dto/abonnement'
import { CODE_ECHEC_EXPIRE, PAIEMENT_RELANCE_APRES_S, PAIEMENT_STATUTS, messageEchec } from '../../shared/paiements'
import type { PaiementStatut } from '../../shared/paiements'
import { ABONNEMENT_GRACE_JOURS } from '../../shared/plans'
import type { RessourceQuota } from '../../shared/plans'
import type { ConfigPlan } from '../config/plans'
import { getMoyenPaiement } from '../config/paiements'
import { limiteConfig } from '../services/abonnements'
import type { AbonnementView, getTarifs } from '../services/abonnements'

// S10 (docs/specs/S10-abonnements.md §3.6) : liste blanche explicite, on ne spread jamais une ligne. Aucun
// identifiant du fournisseur, aucune empreinte, aucun numéro complet, aucune donnée du compte K-PAY.

const MS_PAR_SECONDE = 1_000
const STATUTS_AVEC_MESSAGE: readonly PaiementStatut[] = ['echoue', 'annule', 'expire']
const STATUT_PAR_DEFAUT: PaiementStatut = 'anomalie'

function asStatut(valeur: string): PaiementStatut {
  return PAIEMENT_STATUTS.find((statut) => statut === valeur) ?? STATUT_PAR_DEFAUT
}

export function toPaiementResource(ligne: Paiement): PaiementDTO {
  const statut = asStatut(ligne.statut)
  const ouvert = statut === 'cree' || statut === 'en_attente'
  const relance = new Date(ligne.createdAt.getTime() + PAIEMENT_RELANCE_APRES_S * MS_PAR_SECONDE)
  const code = statut === 'expire' ? (ligne.codeEchec ?? CODE_ECHEC_EXPIRE) : ligne.codeEchec
  return {
    id: ligne.id,
    statut,
    periodeMois: ligne.periodeMois,
    montant: ligne.montant,
    devise: ligne.devise,
    moyenLibelle: getMoyenPaiement(`${ligne.fournisseur}:${ligne.operateur ?? ''}`)?.libelle ?? ligne.operateur ?? ligne.fournisseur,
    telephoneMasque: ligne.telephoneMasque,
    messageEchec: STATUTS_AVEC_MESSAGE.includes(statut) ? messageEchec(code) : null,
    creeLe: ligne.createdAt.toISOString(),
    termineLe: ligne.termineLe?.toISOString() ?? null,
    relanceDisponibleLe: (ouvert ? relance : (ligne.termineLe ?? ligne.createdAt)).toISOString(),
    abonnementExpireLe: statut === 'reussi' ? (ligne.abonnementExpireApres?.toISOString() ?? null) : null,
  }
}

export function toAbonnementResource(vue: AbonnementView): AbonnementDTO {
  const { etat } = vue
  return {
    plan: vue.plan,
    etat: etat.etat,
    expireLe: etat.expireLe?.toISOString() ?? null,
    dernierJourInclus: etat.dernierJourInclus,
    graceJusquau: etat.graceJusquau?.toISOString() ?? null,
    joursRestants: etat.joursRestants,
    renouvellementAutomatique: false,
    quotas: vue.quotas.map((quota) => ({ ressource: quota.ressource, utilise: quota.utilise, limite: quota.limite })),
    paiementEnCours: vue.paiementEnCours ? toPaiementResource(vue.paiementEnCours) : null,
    offre: vue.offre,
  }
}

function limitesDe(config: ConfigPlan): Record<RessourceQuota, number | null> {
  return {
    services: limiteConfig(config, 'services'),
    realisations: limiteConfig(config, 'realisations'),
    temoignages: limiteConfig(config, 'temoignages'),
    reservations_mois: limiteConfig(config, 'reservations_mois'),
    generations_ia_mois: limiteConfig(config, 'generations_ia_mois'),
  }
}

export function toTarifsResource(tarifs: ReturnType<typeof getTarifs>): TarifsDTO {
  const plans: PlanTarifDTO[] = tarifs.plans.map(({ id, config }) => ({
    id,
    limites: limitesDe(config),
    badge: config.badge,
    statistiquesJours: config.statistiquesJours,
  }))
  return { plans, offre: tarifs.offre, graceJours: ABONNEMENT_GRACE_JOURS, renouvellementAutomatique: false }
}
