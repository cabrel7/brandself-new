import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ALERTE_INCOHERENCES_MAX, ADMIN_ALERTE_PAIEMENT_OUVERT_MIN } from '../../../shared/limites'
import { schemaAlertesDto } from '../../../shared/schemas/admin-paiements'
import { db } from '../../../server/utils/db'
import { insererPaiement, jours, minutes, plus, poserAbonnement } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import {
  appelerAdmin,
  desinstallerAdmin,
  HEURE_MS,
  insererEncaissement,
  installerAdmin,
  poserAbonnementOrigine,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA08, CA12 et D-A3-13 : `GET /api/admin/alertes`. Paiements ouverts depuis plus de 60 min, webhooks refusés sur 1 heure,
// incohérences (deux requêtes bornées à 20 identifiants) et encaissements tardifs ignorés (`STATUT_FINAL`) sur 7 jours.
// La route lit l'horloge système : les états sont posés relativement à l'instant réel.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const lire = async () => {
  const reponse = await appelerAdmin(ROUTES.alertes, connecte, { chemin: '/api/admin/alertes' })
  expect(reponse.status).toBe(200)
  return schemaAlertesDto.parse(reponse.corps)
}

describe('alertes : paiements ouverts depuis trop longtemps (CA12)', () => {
  it(`should flag the payments still open after ${ADMIN_ALERTE_PAIEMENT_OUVERT_MIN} minutes, and only those`, async () => {
    const user = await createUser()
    const maintenant = new Date()
    const enAttente = await insererPaiement(user.id, { statut: 'en_attente', createdAt: plus(maintenant, -minutes(ADMIN_ALERTE_PAIEMENT_OUVERT_MIN + 1)) })
    const cree = await insererPaiement(user.id, { statut: 'cree', createdAt: plus(maintenant, -minutes(90)) })
    await insererPaiement(user.id, { statut: 'en_attente', createdAt: plus(maintenant, -minutes(ADMIN_ALERTE_PAIEMENT_OUVERT_MIN - 1)) })
    await insererPaiement(user.id, { statut: 'echoue', createdAt: plus(maintenant, -minutes(300)) })
    await insererEncaissement(user.id, plus(maintenant, -minutes(300)))

    const alertes = await lire()

    expect(alertes.paiementsEnAttente.nombre).toBe(2)
    expect([...alertes.paiementsEnAttente.ids].sort()).toEqual([enAttente.id, cree.id].sort())
  })

  it('should answer a zero count and an empty list when everything is recent', async () => {
    const user = await createUser()
    await insererPaiement(user.id, { statut: 'en_attente', createdAt: new Date() })

    expect((await lire()).paiementsEnAttente).toEqual({ nombre: 0, ids: [] })
  })

  it(`should list at most ${ADMIN_ALERTE_INCOHERENCES_MAX} identifiers but count them all`, async () => {
    const user = await createUser()
    for (let i = 0; i < ADMIN_ALERTE_INCOHERENCES_MAX + 5; i += 1) {
      await insererPaiement(user.id, { statut: 'en_attente', createdAt: plus(new Date(), -minutes(120 + i)), idFournisseur: `tx_ancien_${i}` })
    }

    const { paiementsEnAttente } = await lire()

    expect(paiementsEnAttente.nombre).toBe(ADMIN_ALERTE_INCOHERENCES_MAX + 5)
    expect(paiementsEnAttente.ids).toHaveLength(ADMIN_ALERTE_INCOHERENCES_MAX)
  })
})

describe('alertes : webhooks refusés sur 1 heure (CA12)', () => {
  async function refus(decalageHeures: number, nombre: number, motif = 'SIGNATURE_INVALIDE', fournisseur = 'kpay') {
    await db.execute(sql`
      INSERT INTO webhooks_refuses (heure, fournisseur, motif, nombre)
      VALUES (date_trunc('hour', now()) - make_interval(hours => ${decalageHeures}), ${fournisseur}, ${motif}, ${nombre})`)
  }

  it('should add the counters of the current hour and of the previous one, and ignore older hours', async () => {
    await refus(0, 7)
    await refus(0, 2, 'CORPS_TROP_GROS')
    await refus(1, 5)
    await refus(2, 100)
    await refus(48, 100)

    expect((await lire()).webhooksRefuses1h).toBe(14)
  })

  it('should answer 0 when nothing was refused', async () => {
    expect((await lire()).webhooksRefuses1h).toBe(0)
  })
})

describe('alertes : incohérences (CA08)', () => {
  it('should detect a succeeded payment whose subscription was never extended (no subscription at all)', async () => {
    const user = await createUser()
    const sansAbonnement = await insererEncaissement(user.id, new Date(), { abonnementExpireApres: plus(new Date(), jours(30)) })

    const { incoherences } = await lire()

    expect(incoherences.paiementsSansProlongation).toEqual([sansAbonnement.id])
  })

  it('should detect a succeeded payment whose subscription expires BEFORE the expiry the payment announced', async () => {
    const user = await createUser()
    await poserAbonnement(user.id, plus(new Date(), jours(5)))
    const trop = await insererEncaissement(user.id, new Date(), { abonnementExpireApres: plus(new Date(), jours(30)) })

    expect((await lire()).incoherences.paiementsSansProlongation).toEqual([trop.id])
  })

  it('should detect an active paying subscription without any succeeded payment, and NOT an offered one, an admin one, a trial one (E1), an expired one', async () => {
    const [u1, u2, u3, u4, u5] = [await createUser(), await createUser(), await createUser(), await createUser(), await createUser()]
    const payant = await poserAbonnementOrigine(u1.id, plus(new Date(), jours(30)), { origine: 'paiement' })
    await poserAbonnementOrigine(u2.id, plus(new Date(), jours(30)), { origine: 'offert' })
    await poserAbonnementOrigine(u3.id, plus(new Date(), jours(30)), { origine: 'admin' })
    await poserAbonnementOrigine(u4.id, plus(new Date(), -jours(3)), { origine: 'paiement' })
    await poserAbonnementOrigine(u5.id, plus(new Date(), jours(10)), { origine: 'essai' })

    const { incoherences } = await lire()

    expect(incoherences.abonnementsSansPaiement).toEqual([payant.id])
  })

  it('should report both inconsistencies of the fabricated scenario at once', async () => {
    const [u1, u2] = [await createUser(), await createUser()]
    const paiementSansProlongation = await insererEncaissement(u1.id, new Date(), { abonnementExpireApres: plus(new Date(), jours(30)) })
    const abonnement = await poserAbonnementOrigine(u2.id, plus(new Date(), jours(30)), { origine: 'paiement' })

    const { incoherences } = await lire()

    expect(incoherences).toEqual({ paiementsSansProlongation: [paiementSansProlongation.id], abonnementsSansPaiement: [abonnement.id] })
  })

  it('should stay silent for a healthy account (payment applied, subscription at or after the announced expiry) and for a deleted account', async () => {
    const user = await createUser()
    const echeance = plus(new Date(), jours(30))
    const paiement = await insererEncaissement(user.id, new Date(), { abonnementExpireApres: echeance })
    await poserAbonnement(user.id, echeance, { dernierPaiementId: paiement.id })
    await insererEncaissement(null, new Date(), { abonnementExpireApres: null })

    expect((await lire()).incoherences).toEqual({ paiementsSansProlongation: [], abonnementsSansPaiement: [] })
  })

  it(`should bound each list to ${ADMIN_ALERTE_INCOHERENCES_MAX} identifiers`, async () => {
    for (let i = 0; i < ADMIN_ALERTE_INCOHERENCES_MAX + 5; i += 1) {
      const user = await createUser()
      await poserAbonnementOrigine(user.id, plus(new Date(), jours(30)), { origine: 'paiement' })
      await insererEncaissement(await createUser().then((u) => u.id), new Date(), { abonnementExpireApres: plus(new Date(), jours(30)) })
    }

    const { incoherences } = await lire()

    expect(incoherences.abonnementsSansPaiement).toHaveLength(ADMIN_ALERTE_INCOHERENCES_MAX)
    expect(incoherences.paiementsSansProlongation).toHaveLength(ADMIN_ALERTE_INCOHERENCES_MAX)
  })
})

describe('alertes : encaissements tardifs ignorés (D-A3-13)', () => {
  async function evenement(options: { ilYaJours: number, traitement?: string, motif?: string | null }) {
    await db.execute(sql`
      INSERT INTO evenements_paiement (id, fournisseur, evenement, source, id_transaction, traitement, motif, recu_le)
      VALUES (${randomUUID()}, 'kpay', 'payment.completed', 'webhook', ${`tx_${randomUUID()}`}, ${options.traitement ?? 'ignore'}, ${options.motif === undefined ? 'STATUT_FINAL' : options.motif},
        now() - make_interval(secs => ${options.ilYaJours * 86_400}))`)
  }

  it('should count the STATUT_FINAL ignored events of the last 7 days and nothing else', async () => {
    await evenement({ ilYaJours: 1 })
    await evenement({ ilYaJours: 6.9 })
    await evenement({ ilYaJours: 8 })
    await evenement({ ilYaJours: 1, motif: 'REMBOURSE' })
    await evenement({ ilYaJours: 1, motif: 'PAIEMENT_INCONNU' })
    await evenement({ ilYaJours: 1, traitement: 'applique', motif: null })
    await evenement({ ilYaJours: 1, traitement: 'anomalie', motif: 'MONTANT_INCOHERENT' })

    expect((await lire()).encaissementsTardifs).toBe(2)
  })

  it('should answer 0 on an empty journal and carry a generation date', async () => {
    const alertes = await lire()

    expect(alertes.encaissementsTardifs).toBe(0)
    expect(Math.abs(Date.now() - new Date(alertes.genereLe).getTime())).toBeLessThan(HEURE_MS)
  })
})
