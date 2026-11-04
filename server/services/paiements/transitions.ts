import type { CodeAnomalie, PaiementStatut } from '../../../shared/paiements'
import type { EvenementNormalise } from './types'

// S10 (docs/specs/S10-abonnements.md §1 #111, #115) : machine d'états d'un paiement. Fonction PURE : elle décide,
// l'appelant écrit (sous `SELECT … FOR UPDATE` du paiement).
//
//   cree       -> en_attente | echoue | expire | reussi | annule
//   en_attente -> reussi | echoue | annule | expire | anomalie
//   expire | echoue | annule -> reussi | anomalie     (un `payment.completed` tardif est TOUJOURS appliqué : l'argent a été pris)
//   reussi, anomalie : finaux
//
// `failed` et `cancelled` ne s'appliquent qu'à `cree`, `en_attente` et `expire`. (`cree -> reussi` s'ajoute à la
// spec : le webhook peut devancer notre propre mise à jour `cree -> en_attente` après l'appel au fournisseur.)

/** Motif journalisé quand l'événement arrive sur un paiement déjà dans un état final ou déjà traité. */
export const MOTIF_STATUT_FINAL = 'STATUT_FINAL'

export type DecisionTransition =
  /** Le paiement est réussi : activer l'abonnement. */
  | { type: 'succes' }
  /** Le paiement a échoué ou a été annulé : aucune prolongation. */
  | { type: 'echec', statut: 'echoue' | 'annule', codeEchec: string | null }
  /** Rien à changer : l'événement est journalisé `ignore` avec ce motif. */
  | { type: 'ignorer', motif: CodeAnomalie | typeof MOTIF_STATUT_FINAL }
  /** Résultat non terminal : ni écriture, ni journal. */
  | { type: 'attente' }

const STATUTS_FINAUX: readonly PaiementStatut[] = ['reussi', 'anomalie']
const STATUTS_ECHEC_APPLICABLES: readonly PaiementStatut[] = ['cree', 'en_attente', 'expire']

export function transitionPaiement(
  statut: PaiementStatut,
  evenement: Pick<EvenementNormalise, 'statut' | 'codeEchec'>,
): DecisionTransition {
  switch (evenement.statut) {
    case 'en_attente':
      return { type: 'attente' }
    case 'rembourse':
      return { type: 'ignorer', motif: 'REMBOURSE' }
    case 'autre':
      return { type: 'ignorer', motif: 'EVENEMENT_NON_GERE' }
    case 'reussi':
      return STATUTS_FINAUX.includes(statut) ? { type: 'ignorer', motif: MOTIF_STATUT_FINAL } : { type: 'succes' }
    case 'echoue':
    case 'annule':
      return STATUTS_ECHEC_APPLICABLES.includes(statut)
        ? { type: 'echec', statut: evenement.statut, codeEchec: evenement.codeEchec }
        : { type: 'ignorer', motif: MOTIF_STATUT_FINAL }
  }
}
