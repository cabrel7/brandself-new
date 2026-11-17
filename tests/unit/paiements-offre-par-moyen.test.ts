import { describe, expect, it } from 'vitest'
import { MOYENS_PAIEMENT } from '../../server/config/paiements'
import type { MoyenPaiementConfig, TableFrais } from '../../server/config/paiements'
import { PRIX_PLANS } from '../../server/config/plans'
import { construireOffre } from '../../server/services/paiements/offre'
import { calculerMontants } from '../../shared/paiements-montants'

// Correctif : le montant TTC affiché dépend du MOYEN choisi (frais par fournisseur et méthode). Une devise payable par
// deux moyens aux frais différents (à la charge du client) ne peut pas afficher le prix du premier moyen pour tous.

const MTN = MOYENS_PAIEMENT.find((m) => m.id === 'kpay:MTN_MOMO_CMR') as MoyenPaiementConfig
const CARTE_XAF: MoyenPaiementConfig = { ...MTN, id: 'kpay:CARTE_XAF', methode: 'carte', operateur: 'CARTE_XAF', libelle: 'Carte bancaire' }
const PRIX_12 = PRIX_PLANS.payant.XAF[12]

const FRAIS_DIFFERENTS: TableFrais = {
  kpay: {
    mobile_money: { tauxPointsBase: 500, supporteur: 'marchand' },
    carte: { tauxPointsBase: 300, supporteur: 'client' },
  },
}

function offreXaf(frais: TableFrais, moyens: readonly MoyenPaiementConfig[]) {
  const offre = construireOffre('XAF', { moyens, prix: PRIX_PLANS.payant, frais, fournisseurs: ['kpay'], verrouille: false })
  const periode = offre.devises[0]?.prix.find((p) => p.periodeMois === 12)
  if (!periode) throw new Error('période 12 mois absente')
  return periode
}

describe('construireOffre : montant affiché par moyen', () => {
  it('should give each payment method of a currency its own displayed amount when their fees differ', () => {
    const periode = offreXaf(FRAIS_DIFFERENTS, [MTN, CARTE_XAF])

    const attenduCarte = calculerMontants({ prixPlan: PRIX_12, tauxPb: 300, supporteur: 'client' }).montant
    expect(attenduCarte).toBeGreaterThan(PRIX_12)
    expect(periode.montantAfficheParMoyen).toEqual({ [MTN.id]: PRIX_12, [CARTE_XAF.id]: attenduCarte })
  })

  it('should keep montantAffiche as the amount of the first method of the currency (public contract unchanged)', () => {
    const periode = offreXaf(FRAIS_DIFFERENTS, [MTN, CARTE_XAF])

    expect(periode.montantAffiche).toBe(PRIX_12)
    expect(periode.montant).toBe(PRIX_12)
  })

  it('should fall back on the plan price for a method without a fee scale, and never throw', () => {
    const periode = offreXaf({ kpay: { carte: { tauxPointsBase: 300, supporteur: 'client' } } }, [MTN, CARTE_XAF])

    expect(periode.montantAfficheParMoyen?.[MTN.id]).toBe(PRIX_12)
  })
})
