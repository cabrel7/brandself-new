import { describe, expect, it } from 'vitest'
import { PLANS, PRIX_PLANS } from '../../server/config/plans'
import type { TarifsDTO } from '../../shared/dto/abonnement'
import { KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK } from '../support/faux-kpay'
import { creerAbonne, ECHEANCE_1_MOIS_DEPUIS_NOW, insererPaiement, jours, moduleAbonnements, plus, routeTarifs, viderServices, ajouterServices, NOW, poserAbonnement } from './support/abonnements'
import { createUser } from './support/fabriques'
import { appeler, evenement } from './support/notifications'
import { creer as creerService } from './support/services'

// S10 §6 CA16, CA64, CA68, CA96 : l'offre publique (`GET /api/public/tarifs`, handler réel) et la vue d'abonnement du Compte
// (`getAbonnementView`), contre la VRAIE base. EUR et USD ne sont ni affichés ni proposés tant qu'aucun moyen ne les accepte.

async function tarifs(requete = '') {
  const { default: handler } = await routeTarifs()
  return appeler(handler, evenement({ chemin: `/api/public/tarifs${requete}`, ip: '198.51.100.9' }))
}

describe('GET /api/public/tarifs (CA96, CA16)', () => {
  it('should list the plans with the limits of the configuration and the XAF offer only, with the three periods', async () => {
    const reponse = await tarifs()
    const dto = reponse.corps as TarifsDTO

    expect(reponse.status).toBe(200)
    expect(dto.plans.map((p) => p.id)).toEqual(['gratuit', 'payant'])
    expect(dto.plans[0]?.limites).toEqual({
      services: PLANS.gratuit.services,
      realisations: PLANS.gratuit.realisations,
      temoignages: PLANS.gratuit.temoignages,
      reservations_mois: PLANS.gratuit.reservationsParMois,
      generations_ia_mois: PLANS.gratuit.generationsIaParMois,
    })
    expect(dto.plans[1]?.limites).toEqual({ services: null, realisations: null, temoignages: null, reservations_mois: null, generations_ia_mois: null })
    expect(dto.plans.map((p) => p.badge)).toEqual([true, false])
    expect(dto.offre.paiementDisponible).toBe(true)
    expect(dto.offre.devises.map((d) => d.devise)).toEqual(['XAF'])
    expect(dto.offre.devises[0]?.prix.map((p) => [p.periodeMois, p.montant])).toEqual([[1, PRIX_PLANS.payant.XAF[1]], [3, PRIX_PLANS.payant.XAF[3]], [12, PRIX_PLANS.payant.XAF[12]]])
    expect(dto.offre.devises[0]?.prix.filter((p) => p.miseEnAvant).map((p) => p.periodeMois)).toEqual([12])
    expect(dto.offre.moyens.map((m) => m.id).sort()).toEqual(['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
    expect(dto.graceJours).toBe(7)
    expect(dto.renouvellementAutomatique).toBe(false)
    expect(reponse.entetes['cache-control']).toBe('public, max-age=300')
  })

  it.each(['EUR', 'USD'])('should keep the default currency XAF when %s is requested : it cannot be paid yet', async (devise) => {
    const dto = (await tarifs(`?devise=${devise}`)).corps as TarifsDTO

    expect(dto.offre.deviseParDefaut).toBe('XAF')
    expect(dto.offre.devises.map((d) => d.devise)).not.toContain(devise)
  })

  it('should expose no key, no secret and no provider identifier', async () => {
    const texte = JSON.stringify((await tarifs()).corps)

    for (const interdit of [KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK, 'kpay_test', 'webhook', 'X-API-Key', '127.0.0.1']) expect(texte).not.toContain(interdit)
  })

  it('should offer no payment and no price when no provider is configured, but still show the plans (CA16)', async () => {
    const { construireOffre } = await import('../../server/services/paiements/offre')

    const offre = construireOffre(null, { fournisseurs: [] })

    expect(offre).toMatchObject({ paiementDisponible: false, devises: [], moyens: [], deviseParDefaut: null })
    expect(((await tarifs()).corps as TarifsDTO).plans).toHaveLength(2)
  })

  it.each(['?devise=eur', '?devise=EURO', '?inconnu=1', '?devise=XAF&devise=EUR'])('should refuse the invalid query %s with 400 VALIDATION', async (requete) => {
    const reponse = await tarifs(requete)

    expect(reponse).toMatchObject({ status: 400, code: 'VALIDATION' })
  })

  it('should never reveal anything about users : same answer whoever calls, no cookie needed', async () => {
    const { default: handler } = await routeTarifs()

    const reponse = await appeler(handler, evenement({ chemin: '/api/public/tarifs', entetes: { cookie: 'x=y' }, ip: '198.51.100.10' }))

    expect(reponse.status).toBe(200)
  })
})

describe('getAbonnementView : vue du Compte (CA68, CA64)', () => {
  async function vue(userId: string, now: Date) {
    const { getAbonnementView } = await moduleAbonnements()
    return getAbonnementView(userId, now)
  }

  it('should describe a free account with its quotas and the offer', async () => {
    const pro = await creerAbonne('gratuit')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, 2)

    const v = await vue(pro.user.id, new Date())

    expect(v.plan).toBe('gratuit')
    expect(v.etat.etat).toBe('gratuit')
    expect(v.paiementEnCours).toBeNull()
    expect(v.quotas.find((q) => q.ressource === 'services')).toEqual({ ressource: 'services', utilise: 2, limite: 3 })
    expect(v.offre.paiementDisponible).toBe(true)
  })

  it('should describe the grace period : payer plan kept, end of grace, no ongoing payment (CA68)', async () => {
    const now = new Date()
    const user = await createUser()
    await poserAbonnement(user.id, plus(now, -jours(3)))

    const v = await vue(user.id, now)

    expect(v.plan).toBe('payant')
    expect(v.etat.etat).toBe('grace')
    expect(v.etat.graceJusquau?.getTime()).toBe(plus(plus(now, -jours(3)), jours(7)).getTime())
    expect(v.paiementEnCours).toBeNull()
    expect(v.quotas.every((q) => q.limite === null)).toBe(true)
  })

  it('should describe an active subscription with the remaining days and the last included day', async () => {
    const user = await createUser()
    await poserAbonnement(user.id, ECHEANCE_1_MOIS_DEPUIS_NOW)

    const v = await vue(user.id, NOW)

    expect(v.etat).toMatchObject({ etat: 'actif', dernierJourInclus: '2026-12-03' })
    expect(v.etat.joursRestants).toBe(31)
  })

  it('should return the ongoing payment so that a reload of the Compte resumes the waiting screen (CA103 server side)', async () => {
    const user = await createUser()
    const ouvert = await insererPaiement(user.id)
    await insererPaiement(user.id, { statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND' })

    const v = await vue(user.id, NOW)

    expect(v.paiementEnCours?.id).toBe(ouvert.id)
  })

  it('should create the 6th service for a user in grace through the real service (CA64)', async () => {
    const pro = await creerAbonne('grace')
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, 5)

    const cree = await creerService(pro.user.id, { titre: 'Sixième' })

    expect(cree.item.service.titre).toBe('Sixième')
  })
})
