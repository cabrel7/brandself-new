import { describe, expect, it } from 'vitest'
import type { PrixPeriodeDTO } from '../../shared/dto'
import {
  MESSAGE_ACTUALISER_PAGE, MESSAGE_PRIX_CHANGE, corpsInitiationPaiement, detailPeriode, montantParMoisPaye, montantPaye,
} from '../../app/utils/abonnement'

const PRIX_BASE: PrixPeriodeDTO = { periodeMois: 3, montant: 12000, montantParMois: 4000, remisePct: 0, miseEnAvant: false }
/** Barème à la charge du client : le TTC dépasse le prix du plan. */
const PRIX_TTC: PrixPeriodeDTO = { ...PRIX_BASE, montantAffiche: 12360 }
/** Barème à la charge du marchand : le TTC égale le prix du plan. */
const PRIX_MARCHAND: PrixPeriodeDTO = { ...PRIX_BASE, montantAffiche: 12000 }
const SAISIE = { devise: 'XAF', moyen: 'kpay:MTN', telephone: '6 70 00 00 00' }

describe('prix réellement payé', () => {
  it('prend le TTC quand le barème est à la charge du client', () => {
    expect(montantPaye(PRIX_TTC)).toBe(12360)
    expect(montantParMoisPaye(PRIX_TTC)).toBe(4120)
  })

  it('reste au prix du plan quand le barème est à la charge du marchand ou absent', () => {
    expect(montantPaye(PRIX_MARCHAND)).toBe(12000)
    expect(montantPaye(PRIX_BASE)).toBe(12000)
    expect(montantParMoisPaye(PRIX_BASE)).toBe(4000)
  })

  it('affiche le prix payé dans le choix de durée', () => {
    expect(detailPeriode(PRIX_TTC, 'XAF', 0).replace(/\s/g, ' ')).toBe('12 360 XAF')
  })
})

describe('corps d\'initiation du paiement', () => {
  it('envoie prixAffiche = montantAffiche quand le client supporte les frais', () => {
    expect(corpsInitiationPaiement({ ...SAISIE, prix: PRIX_TTC })).toEqual({
      periodeMois: 3, devise: 'XAF', moyen: 'kpay:MTN', telephone: '670000000', prixAffiche: 12360,
    })
  })

  it('envoie prixAffiche = montant quand les frais sont à la charge du marchand', () => {
    expect(corpsInitiationPaiement({ ...SAISIE, prix: PRIX_BASE }).prixAffiche).toBe(12000)
    expect(corpsInitiationPaiement({ ...SAISIE, prix: PRIX_MARCHAND }).prixAffiche).toBe(12000)
  })
})

describe('messages de refus', () => {
  it('PRIX_CHANGE : un message unique, en vouvoiement, sans montant', () => {
    expect(MESSAGE_PRIX_CHANGE).toBe('Le prix a changé. Veuillez vérifier le nouveau montant avant de payer.')
  })

  it('page périmée : demande d\'actualiser', () => {
    expect(MESSAGE_ACTUALISER_PAGE).toBe('Veuillez actualiser la page.')
  })
})

/** Deux moyens aux frais différents, tous deux à la charge du client. */
const PRIX_PAR_MOYEN: PrixPeriodeDTO = {
  ...PRIX_BASE,
  montantAffiche: 12360,
  montantAfficheParMoyen: { 'kpay:MTN': 12360, 'kpay:ORANGE': 12480 },
}

describe('prix selon le moyen choisi', () => {
  it('suit le moyen sélectionné', () => {
    expect(montantPaye(PRIX_PAR_MOYEN, 'kpay:MTN')).toBe(12360)
    expect(montantPaye(PRIX_PAR_MOYEN, 'kpay:ORANGE')).toBe(12480)
    expect(montantParMoisPaye(PRIX_PAR_MOYEN, 'kpay:ORANGE')).toBe(4160)
    expect(detailPeriode(PRIX_PAR_MOYEN, 'XAF', 0, 'kpay:ORANGE').replace(/\s/g, ' ')).toBe('12 480 XAF')
  })

  it('retombe sur le premier moyen sans moyen choisi ou inconnu', () => {
    expect(montantPaye(PRIX_PAR_MOYEN)).toBe(12360)
    expect(montantPaye(PRIX_PAR_MOYEN, '')).toBe(12360)
    expect(montantPaye(PRIX_PAR_MOYEN, 'kpay:INCONNU')).toBe(12360)
  })

  it('envoie en prixAffiche le montant du moyen choisi', () => {
    expect(corpsInitiationPaiement({ ...SAISIE, moyen: 'kpay:ORANGE', prix: PRIX_PAR_MOYEN }).prixAffiche).toBe(12480)
    expect(corpsInitiationPaiement({ ...SAISIE, moyen: 'kpay:MTN', prix: PRIX_PAR_MOYEN }).prixAffiche).toBe(12360)
  })
})
