import type { PrixPeriodeDTO } from './dto/abonnement'
import { PRIX_MAX_MINOR } from './devises'
import { FRAIS_TAUX_PB_MAX, POINTS_BASE_TOTAL } from './paiements'
import type { FraisSupporteur } from './paiements'
import { PERIODE_MISE_EN_AVANT, PERIODES_MOIS } from './plans'
import type { PeriodeMois } from './plans'

// S10 (docs/specs/S10-abonnements.md §1 #107, #106) : calculs purs en ENTIERS, jamais de flottant.
// Ils vivent dans shared/ (et non server/services/paiements/montants.ts comme l'écrit la spec §5.2) pour
// rester testables sans base ni Nitro ; le service peut les ré-exporter.

const POURCENT = 100

export interface MontantsPaiement {
  /** Montant demandé au payeur (= prix du plan, ou prix majoré des frais si le client les supporte). */
  montant: number
  /** Frais estimés, arrondis au supérieur. */
  frais: number
  /** Net estimé encaissé par Brandself : `montant − frais`. */
  net: number
}

/** Division entière arrondie au supérieur, pour des entiers positifs. */
export function ceilDiv(numerateur: number, denominateur: number): number {
  if (!Number.isSafeInteger(numerateur) || !Number.isSafeInteger(denominateur) || numerateur < 0 || denominateur <= 0) {
    throw new RangeError('ceilDiv attend des entiers positifs')
  }
  return Math.floor((numerateur + denominateur - 1) / denominateur)
}

/**
 * Montant à encaisser, frais et net estimés (#107).
 * - `marchand` : le payeur paie le prix du plan ; les frais sont absorbés par Brandself.
 * - `client` : montant majoré `⌈prix × 10000 / (10000 − taux)⌉`, de sorte que le net soit au moins le prix.
 * Frais estimés `⌈montant × taux / 10000⌉` (au supérieur : estimation prudente du coût).
 */
export function calculerMontants(entree: { prixPlan: number, tauxPb: number, supporteur: FraisSupporteur }): MontantsPaiement {
  const { prixPlan, tauxPb, supporteur } = entree
  if (!Number.isSafeInteger(prixPlan) || prixPlan <= 0 || prixPlan > PRIX_MAX_MINOR) {
    throw new RangeError('prixPlan doit être un entier strictement positif')
  }
  if (!Number.isSafeInteger(tauxPb) || tauxPb < 0 || tauxPb > FRAIS_TAUX_PB_MAX) {
    throw new RangeError('tauxPb doit être un entier entre 0 et le taux maximal')
  }
  const montant = supporteur === 'client'
    ? ceilDiv(prixPlan * POINTS_BASE_TOTAL, POINTS_BASE_TOTAL - tauxPb)
    : prixPlan
  if (montant > PRIX_MAX_MINOR) throw new RangeError('le montant dépasse le maximum autorisé')
  const frais = ceilDiv(montant * tauxPb, POINTS_BASE_TOTAL)
  return { montant, frais, net: montant - frais }
}

/**
 * Prix des périodes proposées, avec le prix mensuel et la remise (calcul pur depuis le prix de 1 mois).
 * `remisePct` : écart arrondi à l'entier entre `prix(1 mois) × n` et le prix de la période.
 * Les périodes sans prix sont omises.
 */
export function prixPeriodes(prixParPeriode: Partial<Record<PeriodeMois, number>>): PrixPeriodeDTO[] {
  const prixMensuel = prixParPeriode[1]
  const resultat: PrixPeriodeDTO[] = []
  for (const periodeMois of PERIODES_MOIS) {
    const montant = prixParPeriode[periodeMois]
    if (montant === undefined) continue
    const plein = prixMensuel === undefined ? montant : prixMensuel * periodeMois
    const remisePct = plein > 0 ? Math.max(0, Math.round(((plein - montant) * POURCENT) / plein)) : 0
    resultat.push({
      periodeMois,
      montant,
      montantParMois: Math.round(montant / periodeMois),
      remisePct,
      miseEnAvant: periodeMois === PERIODE_MISE_EN_AVANT,
    })
  }
  return resultat
}
