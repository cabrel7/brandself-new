import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REVENUS_MENTION_INCERTITUDE } from '../../../shared/admin-paiements'
import { vues } from '../../../shared/db/schema'
import { schemaVueEnsembleEnrichieDto } from '../../../shared/schemas/admin-paiements'
import { db } from '../../../server/utils/db'
import { insererPaiement, jours, minutes, plus } from '../support/abonnements'
import { creerPro, insererReservation } from '../support/notifications'
import {
  appelerAdmin,
  debutMoisDouala,
  desinstallerAdmin,
  HEURE_MS,
  insererEncaissement,
  installerAdmin,
  poserAbonnementOrigine,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 D-A3-12 et §6 : `GET /api/admin/vue-ensemble` ENRICHI. Remplace la vue d'ensemble d'A1 (qui interdisait tout compteur) :
// compteurs (inscrits, vitrines publiées, abonnés payants), revenus K-PAY du mois courant par devise, indicateur de réussite
// (vitrines publiées avec au moins une vue ou une réservation sur 30 jours / vitrines publiées) et alertes. Aucune donnée
// personnelle hors le nom de l'administrateur lui-même.
//
// DÉCISIONS POSÉES PAR CES TESTS (la spec ne les tranche pas, voir le rapport) :
//   - un compte d'administration n'est pas un « inscrit » ;
//   - un « abonné payant » a un abonnement ACTIF d'origine `paiement` : un abonnement offert ou posé par l'administration
//     (origine `offert` ou `admin`) n'est pas payant et fausserait le chiffre d'affaires attendu.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin({ name: 'Administrateur A3' })
})

afterEach(() => {
  desinstallerAdmin()
})

const lire = async () => {
  const reponse = await appelerAdmin(ROUTES.vueEnsemble, connecte, { chemin: '/api/admin/vue-ensemble' })
  expect(reponse.status).toBe(200)
  return { reponse, dto: schemaVueEnsembleEnrichieDto.parse(reponse.corps) }
}

async function vue(vitrineId: string, ilYaJours: number): Promise<void> {
  const jour = new Date(Date.now() - ilYaJours * 86_400_000).toISOString().slice(0, 10)
  await db.insert(vues).values({ id: randomUUID(), vitrineId, jour, empreinte: 'e'.repeat(64), pageType: 'accueil', source: 'direct', appareil: 'mobile' })
}

describe('vue d\'ensemble enrichie : contenu', () => {
  it('should greet the administrator and answer the exact enriched shape, with the uncertainty notice', async () => {
    const { dto } = await lire()

    expect(dto).toMatchObject({
      admin: { nom: 'Administrateur A3' },
      compteurs: { inscrits: 0, vitrinesPubliees: 0, abonnesPayants: 0 },
      revenus: [],
      indicateurReussite: { vitrinesActives: 0, vitrinesPubliees: 0 },
      mention: REVENUS_MENTION_INCERTITUDE,
      alertes: { paiementsEnAttente: { nombre: 0, ids: [] }, webhooksRefuses1h: 0, encaissementsTardifs: 0 },
      // E1 (D11) : aucun essai accordé, donc pas de taux.
      essais: { jours: 30, accordes: 0, enCours: 0, convertis: 0, tauxPct: null },
    })
    expect(Math.abs(Date.now() - new Date(dto.genereLe).getTime())).toBeLessThan(HEURE_MS)
  })

  it('should count the signed-up users (the administrator is not one) and the published showcases (unpublished ones are not)', async () => {
    await creerPro({ publiee: true })
    await creerPro({ publiee: true })
    await creerPro({ publiee: false })

    const { dto } = await lire()

    expect(dto.compteurs.inscrits).toBe(3)
    expect(dto.compteurs.vitrinesPubliees).toBe(2)
    expect(dto.indicateurReussite.vitrinesPubliees).toBe(2)
  })

  it('should count as payers only the active subscriptions created by a payment (a free trial, origin `essai`, is not one)', async () => {
    const [a, b, c, d, e] = [await creerPro(), await creerPro(), await creerPro(), await creerPro(), await creerPro()]
    await poserAbonnementOrigine(a.user.id, plus(new Date(), jours(20)), { origine: 'paiement' })
    await poserAbonnementOrigine(b.user.id, plus(new Date(), jours(20)), { origine: 'offert' })
    await poserAbonnementOrigine(c.user.id, plus(new Date(), jours(20)), { origine: 'admin' })
    await poserAbonnementOrigine(d.user.id, plus(new Date(), -jours(1)), { origine: 'paiement' })
    await poserAbonnementOrigine(e.user.id, plus(new Date(), jours(10)), { origine: 'essai' })

    const { dto } = await lire()

    expect(dto.compteurs.abonnesPayants).toBe(1)
  })

  it('should give the K-PAY collected amount of the current month per currency, without manual payments nor pending ones', async () => {
    const pro = await creerPro()
    const debut = debutMoisDouala(new Date())
    await insererEncaissement(pro.user.id, plus(debut, HEURE_MS), { montantPlan: 5000, montant: 5000 })
    await insererEncaissement(pro.user.id, plus(debut, 2 * HEURE_MS), { montantPlan: 12_000, montant: 12_000 })
    await insererEncaissement(pro.user.id, plus(debut, 3 * HEURE_MS), { devise: 'EUR', montantPlan: 1500, montant: 1500 })
    await insererEncaissement(pro.user.id, plus(debut, -HEURE_MS), { montantPlan: 40_000, montant: 40_000 })
    await insererPaiement(pro.user.id, { statut: 'en_attente', montantPlan: 9999, montant: 9999 })

    const { dto } = await lire()

    expect([...dto.revenus].sort((x, y) => x.devise.localeCompare(y.devise))).toEqual([
      { devise: 'EUR', encaisseMoisCourant: 1500, nombre: 1 },
      { devise: 'XAF', encaisseMoisCourant: 17_000, nombre: 2 },
    ])
  })
})

describe('vue d\'ensemble enrichie : indicateur de réussite (D-A3-12)', () => {
  it('should count the published showcases with a view or a booking in the last 30 days, and give the denominator', async () => {
    const avecVue = await creerPro()
    const avecReservation = await creerPro()
    await creerPro()
    const activiteTropAncienne = await creerPro()
    const nonPubliee = await creerPro({ publiee: false })
    await vue(avecVue.vitrine.id, 1)
    await insererReservation(avecReservation.vitrine.id, avecReservation.service.id, { debut: plus(new Date(), jours(3)), createdAt: plus(new Date(), -jours(10)) })
    await vue(activiteTropAncienne.vitrine.id, 40)
    await insererReservation(activiteTropAncienne.vitrine.id, activiteTropAncienne.service.id, { debut: plus(new Date(), jours(3)), createdAt: plus(new Date(), -jours(45)) })
    await vue(nonPubliee.vitrine.id, 1)

    const { dto } = await lire()

    expect(dto.indicateurReussite).toEqual({ vitrinesActives: 2, vitrinesPubliees: 4 })
  })

  it('should count a showcase once even when it has several views and several bookings', async () => {
    const pro = await creerPro()
    for (let i = 0; i < 3; i += 1) await vue(pro.vitrine.id, i)
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: plus(new Date(), jours(3)), createdAt: plus(new Date(), -minutes(5)) })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: plus(new Date(), jours(4)), createdAt: plus(new Date(), -minutes(6)) })

    const { dto } = await lire()

    expect(dto.indicateurReussite).toEqual({ vitrinesActives: 1, vitrinesPubliees: 1 })
  })
})

describe('vue d\'ensemble enrichie : alertes et confidentialité', () => {
  it('should embed the same alerts as GET /api/admin/alertes', async () => {
    const pro = await creerPro()
    const ouvert = await insererPaiement(pro.user.id, { statut: 'en_attente', createdAt: plus(new Date(), -minutes(90)) })

    const { dto } = await lire()
    const separees = await appelerAdmin(ROUTES.alertes, connecte, { chemin: '/api/admin/alertes' })

    expect(dto.alertes.paiementsEnAttente).toEqual({ nombre: 1, ids: [ouvert.id] })
    expect(dto.alertes.incoherences).toEqual((separees.corps as { incoherences: unknown }).incoherences)
  })

  it('should expose no e-mail, phone number, name of a user or of a visitor, nor any identifier of a payment holder', async () => {
    const pro = await creerPro({ email: 'pro-confidentiel@exemple.test', prenom: 'Prenomsecret', nom: 'Nomsecret' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: plus(new Date(), jours(3)), createdAt: new Date(), nom: 'Visiteur Secret', email: 'visiteur-secret@exemple.test', telephone: '+237699000099' })
    await insererEncaissement(pro.user.id, new Date())

    const { reponse } = await lire()

    const brut = JSON.stringify(reponse.corps)
    for (const interdit of ['pro-confidentiel@exemple.test', 'Prenomsecret', 'Nomsecret', 'Visiteur Secret', 'visiteur-secret@exemple.test', '+237699000099', pro.user.id, pro.vitrine.username, connecte.admin.email]) {
      expect(brut, interdit).not.toContain(interdit)
    }
  })

  it('should not keep the A1 overview shape: the enriched answer is the only one (no extra key, strict schema)', async () => {
    const { reponse } = await lire()

    expect(Object.keys(reponse.corps as object).sort()).toEqual(['admin', 'alertes', 'compteurs', 'essais', 'genereLe', 'indicateurReussite', 'mention', 'revenus'])
  })
})
