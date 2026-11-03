// S10 (docs/specs/S10-abonnements.md §5.2) : les calculs de montants vivent dans shared/ (purs, testables sans
// base ni Nitro). Ce module les expose à la couche services sous le chemin prévu par la spec.
export { calculerMontants, ceilDiv, prixPeriodes } from '../../../shared/paiements-montants'
export type { MontantsPaiement } from '../../../shared/paiements-montants'
