import { beforeEach, describe, expect, it } from 'vitest'
import { PLANS } from '../../server/config/plans'
import type { TarifsDTO } from '../../shared/dto/abonnement'
import { REGLAGE_CLES } from '../../shared/reglages'
import { fenetreOnglet, listerAbonnements } from '../../server/services/admin/abonnements'
import { listerUtilisateurs } from '../../server/services/admin/utilisateurs'
import { apercuImpactPlan } from '../../server/services/configuration/impact'
import { buildAbonnementRappelEmail } from '../../server/services/emails/notifications-contenus'
import { lireGraceJours } from '../../server/services/plans'
import { listerUrlsSitemap } from '../../server/services/seo-sitemap'
import { avecTableReglagesIllisible, poserReglage, reinitialiserA4 } from './support/admin-a4'
import { ajouterServices, jours, plus, poserAbonnement, routeTarifs, viderServices } from './support/abonnements'
import { appeler, creerPro, evenement } from './support/notifications'

// Correctif R2 : `abonnement.grace_jours` est la source UNIQUE de la durée de grâce. Chaque lecteur (tarifs, sitemap,
// filtres et onglets d'administration, aperçu d'impact, e-mail de rappel) suit le réglage, sans exception levée.
// VRAIE base ; le réglage est posé directement (état de départ).

const GRACE_REGLEE = 3
const ECHU_DEPUIS_JOURS = 5

let auteur: string

beforeEach(async () => {
  await reinitialiserA4()
  auteur = (await creerPro()).user.id
})

const regler = (valeur: number) => poserReglage(REGLAGE_CLES.abonnementGraceJours, valeur, auteur)

/** Compte publié dont l'abonnement est échu depuis 5 jours : en grâce à 7 jours, gratuit à 3. */
async function compteEchuDepuisCinqJours(nombreServices: number) {
  const pro = await creerPro()
  const abonnement = await poserAbonnement(pro.user.id, plus(new Date(), -jours(ECHU_DEPUIS_JOURS)))
  await viderServices(pro.vitrine.id)
  await ajouterServices(pro.vitrine.id, nombreServices)
  return { pro, abonnement }
}

describe('lireGraceJours : lecture unique', () => {
  it('should return the code default (7) without any setting, then the configured value, within the 5 s cache of the settings', async () => {
    expect(await lireGraceJours()).toBe(7)

    await regler(GRACE_REGLEE)

    expect(await lireGraceJours()).toBe(GRACE_REGLEE)
  })

  it('should fall back on the code constant and never throw when the settings table is unreadable', async () => {
    await regler(GRACE_REGLEE)

    const lue = await avecTableReglagesIllisible(() => lireGraceJours())

    expect(lue).toBe(7)
  })
})

describe('/tarifs et studio : graceJours affiché', () => {
  it('should expose the configured grace on GET /api/public/tarifs', async () => {
    await regler(GRACE_REGLEE)
    const { default: handler } = await routeTarifs()

    const reponse = await appeler(handler, evenement({ chemin: '/api/public/tarifs', ip: '198.51.100.9' }))

    expect((reponse.corps as TarifsDTO).graceJours).toBe(GRACE_REGLEE)
  })

  it('should keep the trial mention of E1 independent of the grace setting (a trial never has a grace period)', async () => {
    await regler(GRACE_REGLEE)
    const { default: handler } = await routeTarifs()

    const reponse = await appeler(handler, evenement({ chemin: '/api/public/tarifs', ip: '198.51.100.9' }))

    expect((reponse.corps as TarifsDTO).essai).toEqual({ actif: true, dureeJours: 14 })
  })
})

describe('sitemap : plan effectif au regard de la grâce réglée', () => {
  it('should keep the payant limits during a 7-day grace, and fall back to the free limits once the setting shortens it', async () => {
    const { pro } = await compteEchuDepuisCinqJours(PLANS.gratuit.services! + 2)
    const servicesDe = async () => (await listerUrlsSitemap()).filter((u) => u.loc.startsWith(`/${pro.vitrine.username}/services/`)).length

    expect(await servicesDe()).toBe(PLANS.gratuit.services! + 2)

    await regler(GRACE_REGLEE)

    expect(await servicesDe()).toBe(PLANS.gratuit.services)
  })
})

describe('administration : filtres SQL et onglets', () => {
  it('should filter the users in grace with the configured duration', async () => {
    const { pro } = await compteEchuDepuisCinqJours(1)
    const idsEnGrace = async () => (await listerUtilisateurs({ etat: 'grace', limite: 100 })).elements.map((u) => u.id)

    expect(await idsEnGrace()).toContain(pro.user.id)

    await regler(GRACE_REGLEE)

    expect(await idsEnGrace()).not.toContain(pro.user.id)
  })

  it('should show the displayed state of a user as gratuit once the configured grace is over (same source as the SQL filter)', async () => {
    const { pro } = await compteEchuDepuisCinqJours(1)
    await regler(GRACE_REGLEE)

    const ligne = (await listerUtilisateurs({ limite: 100 })).elements.find((u) => u.id === pro.user.id)

    expect(ligne).toMatchObject({ etat: 'gratuit', plan: 'gratuit' })
  })

  it('should move an expired subscription between the grace and expired tabs according to the setting', async () => {
    const { abonnement } = await compteEchuDepuisCinqJours(1)
    const ids = async (onglet: 'grace' | 'expires') => (await listerAbonnements({ onglet, page: 1, limite: 100 })).elements.map((a) => a.id)

    expect(await ids('grace')).toContain(abonnement.id)
    expect(await ids('expires')).not.toContain(abonnement.id)

    await regler(GRACE_REGLEE)

    expect(await ids('grace')).not.toContain(abonnement.id)
    expect(await ids('expires')).toContain(abonnement.id)
  })

  it('should compute the tab windows from the given grace (pure function)', () => {
    const now = new Date('2026-11-03T13:00:00.000Z')

    const fenetre = fenetreOnglet('grace', now, GRACE_REGLEE)

    expect(fenetre.apres.getTime()).toBe(now.getTime() - jours(GRACE_REGLEE))
  })
})

describe('aperçu d\'impact : comptes gratuits = grâce écoulée', () => {
  it('should count an account whose configured grace is over among the free accounts', async () => {
    await compteEchuDepuisCinqJours(5)
    const valeurs = { services: 3, realisations: null, temoignages: null, reservationsParMois: null, generationsIaParMois: null }
    const avant = await apercuImpactPlan('gratuit', valeurs)

    await regler(GRACE_REGLEE)
    const apres = await apercuImpactPlan('gratuit', valeurs)

    expect(apres.services.comptes).toBe(avant.services.comptes + 1)
    expect(apres.services.elementsMasques).toBe(avant.services.elementsMasques + 2)
  })
})

describe('e-mail de rappel : texte de la grâce', () => {
  it('should state the configured grace duration', () => {
    const message = buildAbonnementRappelEmail({
      type: 'abonnement_rappel',
      outboxId: 'outbox-1',
      generatedAt: new Date('2026-11-03T13:00:00.000Z'),
      destinataire: 'pro@exemple.test',
      prenom: 'Cabrel',
      fuseau: 'Africa/Douala',
      siteUrl: 'https://exemple.test',
      jours: 3,
      expireLe: new Date('2026-11-06T23:00:00.000Z'),
      periodeMois: 1,
      graceJours: GRACE_REGLEE,
    })

    expect(message.text).toContain(`période de grâce de ${GRACE_REGLEE} jours`)
  })
})
