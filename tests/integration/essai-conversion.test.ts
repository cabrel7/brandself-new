import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { abonnements } from '../../shared/db/schema'
import { ESSAI_DEFAUT } from '../../shared/essai'
import { schemaVueEnsembleEnrichieDto } from '../../shared/schemas/admin-paiements'
import { db } from '../../server/utils/db'
import { apercuImpactPlan } from '../../server/services/configuration/impact'
import { getPlanEffectif } from '../../server/services/plans'
import { calculerNouvelleEcheance, choisirBase } from '../../server/services/abonnements-regles'
import { appelerAdmin, desinstallerAdmin, installerAdmin, ROUTES } from './support/admin-a3'
import type { AdminConnecte } from './support/admin-a3'
import { DELAI_CACHE_MS, preparerConfigurationA5 } from './support/admin-a5'
import { ajouterServices, insererPaiement, moduleAbonnements, viderServices } from './support/abonnements'
import {
  accorder, creerCompteEmail, DEBUT_ESSAI, FIN_ESSAI_V1, jours, lireAbonnementDe, lireEssais, lireToutesLesEssais, moduleEssai,
  moduleOffrir, moduleProlongation, plus, poserVersionEssai, supprimerCompte,
} from './support/essai'
import { creerPro } from './support/notifications'

// E1 CA-E1-22, 23, 25, 26, 29 et D11 : conversion d'un essai en abonnement payé, compteur d'administration, revenus, vue du Compte et offre
// publique. VRAIE base ; seule l'horloge est injectée. Les paiements sont des lignes réelles (insertion directe) prolongées par le vrai `prolonger`.

preparerConfigurationA5()

async function prolongerPar(userId: string, now: Date, avecPaiement = true) {
  const { prolonger } = await moduleProlongation()
  const paiement = avecPaiement ? await insererPaiement(userId) : null
  return db.transaction((tx) => prolonger(tx, userId, 1, now, paiement?.id ?? null))
}

describe('paiement pendant l\'essai (CA-E1-22, D11)', () => {
  it('should turn the subscription into a paid one, extend from max(now, end of the trial), and record the conversion once', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)
    const quand = plus(DEBUT_ESSAI, jours(5))

    await prolongerPar(compte.id, quand)

    const abonnement = await lireAbonnementDe(compte.id)
    expect(abonnement?.origine).toBe('paiement')
    expect(abonnement?.expireLe.getTime()).toBe(calculerNouvelleEcheance(choisirBase(quand, FIN_ESSAI_V1), 1, 'Africa/Douala').getTime())
    expect(abonnement?.expireLe.getTime()).toBeGreaterThan(FIN_ESSAI_V1.getTime())
    const [essai] = await lireEssais(compte.id)
    expect(essai?.convertiLe?.getTime()).toBe(quand.getTime())

    await prolongerPar(compte.id, plus(quand, jours(10)))

    expect((await lireEssais(compte.id))[0]?.convertiLe?.getTime()).toBe(quand.getTime())
  })

  it('should extend from NOW when the payment comes after the end of the trial, and still count the conversion', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)
    const quand = plus(FIN_ESSAI_V1, jours(3))

    await prolongerPar(compte.id, quand)

    expect((await lireAbonnementDe(compte.id))?.expireLe.getTime()).toBe(calculerNouvelleEcheance(quand, 1, 'Africa/Douala').getTime())
    expect((await lireEssais(compte.id))[0]?.convertiLe?.getTime()).toBe(quand.getTime())
  })

  it('should NOT convert when no payment is behind the extension (administration): the origin stays `essai`', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)

    await prolongerPar(compte.id, plus(DEBUT_ESSAI, jours(2)), false)

    expect((await lireAbonnementDe(compte.id))?.origine).toBe('essai')
    expect((await lireEssais(compte.id))[0]?.convertiLe).toBeNull()
  })

  it('should touch no essai of another account, and none when the account never had one', async () => {
    const a = await creerCompteEmail()
    const b = await creerCompteEmail()
    await accorder(a.id)

    await prolongerPar(b.id, plus(DEBUT_ESSAI, jours(2)))

    expect((await lireEssais(a.id))[0]?.convertiLe).toBeNull()
    expect(await lireEssais(b.id)).toHaveLength(0)
  })
})

describe('compte converti puis supprimé (CA-E1-23) et indicateur (D11)', () => {
  it('should keep the essai row detached with its conversion date, and count it in statistiquesEssais', async () => {
    const { statistiquesEssais } = await moduleEssai()
    const compte = await creerCompteEmail()
    await accorder(compte.id)
    const quand = plus(DEBUT_ESSAI, jours(4))
    await prolongerPar(compte.id, quand)

    await supprimerCompte(compte.id)

    const [essai] = await lireToutesLesEssais()
    expect(essai?.userId).toBeNull()
    expect(essai?.convertiLe?.getTime()).toBe(quand.getTime())
    expect(await statistiquesEssais(plus(DEBUT_ESSAI, jours(6)))).toEqual({ jours: 30, accordes: 1, enCours: 0, convertis: 1, tauxPct: 100 })
  })

  it('should count the window, the running, the converted and the rate (rounded, null without any essai)', async () => {
    const { statistiquesEssais } = await moduleEssai()
    const maintenant = plus(DEBUT_ESSAI, jours(40))
    expect(await statistiquesEssais(maintenant)).toEqual({ jours: 30, accordes: 0, enCours: 0, convertis: 0, tauxPct: null })

    const horsFenetre = await creerCompteEmail()
    const convertie = await creerCompteEmail()
    const expiree = await creerCompteEmail()
    const enCours = await creerCompteEmail()
    await accorder(horsFenetre.id, plus(maintenant, -jours(45)))
    await accorder(convertie.id, plus(maintenant, -jours(20)))
    await prolongerPar(convertie.id, plus(maintenant, -jours(15)))
    await accorder(expiree.id, plus(maintenant, -jours(25)))
    await accorder(enCours.id, plus(maintenant, -jours(2)))

    expect(await statistiquesEssais(maintenant)).toEqual({ jours: 30, accordes: 3, enCours: 1, convertis: 1, tauxPct: 33 })
    expect(await statistiquesEssais(maintenant, 60)).toMatchObject({ jours: 60, accordes: 4 })
  })
})

describe('vue du Compte : `essai` (CA-E1-22)', () => {
  it('should be non-null only while the essai runs: null after the end and after a payment', async () => {
    const { getAbonnementView } = await moduleAbonnements()
    const compte = await creerCompteEmail()
    await accorder(compte.id)

    const pendant = await getAbonnementView(compte.id, plus(DEBUT_ESSAI, jours(3)))
    const apresFin = await getAbonnementView(compte.id, plus(FIN_ESSAI_V1, 1000))
    await prolongerPar(compte.id, plus(DEBUT_ESSAI, jours(3)))
    const paye = await getAbonnementView(compte.id, plus(DEBUT_ESSAI, jours(4)))

    expect(pendant.essai?.finLe.getTime()).toBe(FIN_ESSAI_V1.getTime())
    expect(pendant.etat.etat).toBe('actif')
    expect(apresFin.essai).toBeNull()
    expect(apresFin.etat.etat).toBe('gratuit')
    expect(apresFin.etat.graceJusquau).toBeNull()
    expect(paye.essai).toBeNull()
  })
})

describe('administration (CA-E1-25, 26)', () => {
  let connecte: AdminConnecte
  beforeEach(async () => {
    connecte = await installerAdmin({ name: 'Administrateur E1' })
  })
  afterEach(() => {
    desinstallerAdmin()
  })

  it('should answer 200 with origin `essai` on the subscriptions list and the overview, never a 500', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id, new Date())

    for (const onglet of ['renouvellement', 'grace', 'expires']) {
      const liste = await appelerAdmin(ROUTES.abonnements, connecte, { chemin: `/api/admin/abonnements?onglet=${onglet}` })
      expect(liste.status, onglet).toBe(200)
    }
    const vue = await appelerAdmin(ROUTES.vueEnsemble, connecte, { chemin: '/api/admin/vue-ensemble' })
    expect(vue.status).toBe(200)
    expect(schemaVueEnsembleEnrichieDto.parse(vue.corps).essais).toMatchObject({ jours: 30, accordes: 1, enCours: 1, convertis: 0, tauxPct: 0 })
  })

  it('should list a running essai with its origin, and never in the grace tab once it is over (no grace for a trial)', async () => {
    const maintenant = new Date()
    const enFin = await creerCompteEmail()
    const echu = await creerCompteEmail()
    await accorder(enFin.id, plus(maintenant, -jours(10)))
    await accorder(echu.id, plus(maintenant, -jours(16)))

    const renouvellement = await appelerAdmin(ROUTES.abonnements, connecte, { chemin: '/api/admin/abonnements?onglet=renouvellement' })
    const grace = await appelerAdmin(ROUTES.abonnements, connecte, { chemin: '/api/admin/abonnements?onglet=grace' })

    const lignes = (reponse: { corps: unknown }) => ((reponse.corps as { elements: Array<{ utilisateurId?: string, origine: string, etat: string }> }).elements)
    expect(lignes(renouvellement).map((l) => l.origine)).toContain('essai')
    for (const ligne of lignes(grace)) expect(ligne.etat).not.toBe('grace')
    expect(lignes(grace).filter((l) => l.origine === 'essai')).toEqual([])
  })

  it('should count a trial neither in the payers, nor in the revenues, nor in the « paying without payment » alert (CA-26)', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id, new Date())

    const vue = schemaVueEnsembleEnrichieDto.parse((await appelerAdmin(ROUTES.vueEnsemble, connecte, { chemin: '/api/admin/vue-ensemble' })).corps)
    const alertes = (await appelerAdmin(ROUTES.alertes, connecte, { chemin: '/api/admin/alertes' })).corps as { incoherences: { abonnementsSansPaiement: string[] } }

    expect(vue.compteurs.abonnesPayants).toBe(0)
    expect(vue.revenus).toEqual([])
    expect(alertes.incoherences.abonnementsSansPaiement).toEqual([])
  })
})

describe('offre publique : `essai` suit la version active (CA-E1-29, au niveau du service)', () => {
  it('should follow `actif` and the duration within the 5 s read cache', async () => {
    const { getTarifs } = await moduleAbonnements()
    await poserVersionEssai({ actif: false, dureeJours: 30, relanceServicesJour: 2, relanceStatistiquesJour: 7 })
    await vi.waitFor(() => expect(getTarifs(undefined).essai).toEqual({ actif: false, dureeJours: 30 }), { timeout: DELAI_CACHE_MS, interval: 400 })

    await poserVersionEssai({ ...ESSAI_DEFAUT })
    await vi.waitFor(() => expect(getTarifs(undefined).essai).toEqual({ actif: true, dureeJours: 14 }), { timeout: DELAI_CACHE_MS, interval: 400 })
  })
})

describe('offre de jours sur un essai (correction de revue : l\'essai redevient un abonnement normal)', () => {
  it('should turn an essai extended by an offer into an `offert` subscription: the days add up and the grace applies again', async () => {
    const { offrirJours } = await moduleOffrir()
    const compte = await creerCompteEmail()
    await accorder(compte.id)

    const resultat = await db.transaction((tx) => offrirJours(tx, compte.id, 7, plus(DEBUT_ESSAI, jours(2))))

    const abonnement = (await lireAbonnementDe(compte.id))!
    expect(resultat.avant?.origine).toBe('essai')
    expect(resultat.apres.origine).toBe('offert')
    expect(abonnement.origine).toBe('offert')
    expect(abonnement.expireLe.toISOString()).toBe(plus(FIN_ESSAI_V1, jours(7)).toISOString())
    expect(abonnement.dernierPaiementId).toBeNull()
    const apresEcheance = plus(abonnement.expireLe, 1000)
    expect((await getPlanEffectif(compte.id, apresEcheance)).etat).toBe('grace')
  })

  it('should keep the origin of a non-essai subscription untouched (non-regression)', async () => {
    const { offrirJours } = await moduleOffrir()
    const compte = await creerCompteEmail()
    await accorder(compte.id)
    await db.update(abonnements).set({ origine: 'paiement' }).where(eq(abonnements.userId, compte.id))

    const resultat = await db.transaction((tx) => offrirJours(tx, compte.id, 3, DEBUT_ESSAI))

    expect(resultat.apres.origine).toBe('paiement')
    expect((await lireAbonnementDe(compte.id))?.origine).toBe('paiement')
  })

  it('should keep a plain essai without grace as long as no offer touched it', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)

    expect((await getPlanEffectif(compte.id, plus(FIN_ESSAI_V1, 1000))).etat).toBe('gratuit')
  })
})

describe('aperçu d\'impact d\'un plan et essai (D9 : aucune grâce)', () => {
  const VALEURS = { services: 3, realisations: null, temoignages: null, reservationsParMois: null, generationsIaParMois: null }

  async function proAvecCinqServices() {
    const pro = await creerPro()
    await viderServices(pro.vitrine.id)
    await ajouterServices(pro.vitrine.id, 5)
    return pro
  }

  it('should count an essai ended since one day among the FREE accounts (not in a grace it does not have), and not among the paying ones', async () => {
    const gratuitAvant = await apercuImpactPlan('gratuit', VALEURS)
    const payantAvant = await apercuImpactPlan('payant', VALEURS)
    const pro = await proAvecCinqServices()
    await accorder(pro.user.id, plus(new Date(), -jours(15)))

    const gratuitApres = await apercuImpactPlan('gratuit', VALEURS)
    const payantApres = await apercuImpactPlan('payant', VALEURS)

    expect(gratuitApres.services.comptes).toBe(gratuitAvant.services.comptes + 1)
    expect(gratuitApres.services.elementsMasques).toBe(gratuitAvant.services.elementsMasques + 2)
    expect(payantApres.services.comptes).toBe(payantAvant.services.comptes)
  })

  it('should count a RUNNING essai among the paying accounts, and a paid subscription ended one day ago among them too (grace kept)', async () => {
    const payantAvant = await apercuImpactPlan('payant', VALEURS)
    const gratuitAvant = await apercuImpactPlan('gratuit', VALEURS)
    const enCours = await proAvecCinqServices()
    await accorder(enCours.user.id, new Date())
    const payeEchu = await proAvecCinqServices()
    await accorder(payeEchu.user.id, plus(new Date(), -jours(15)))
    await db.update(abonnements).set({ origine: 'paiement' }).where(eq(abonnements.userId, payeEchu.user.id))

    const payantApres = await apercuImpactPlan('payant', VALEURS)
    const gratuitApres = await apercuImpactPlan('gratuit', VALEURS)

    expect(payantApres.services.comptes).toBe(payantAvant.services.comptes + 2)
    expect(gratuitApres.services.comptes).toBe(gratuitAvant.services.comptes)
  })
})
