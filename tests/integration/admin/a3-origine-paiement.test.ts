import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schemaVueEnsembleEnrichieDto } from '../../../shared/schemas/admin-paiements'
import { db } from '../../../server/utils/db'
import { calculerNouvelleEcheance, choisirBase } from '../../../server/services/abonnements-regles'
import { insererPaiement, jours, lireAbonnement, plus } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import {
  appelerAdmin,
  confirmationService,
  desinstallerAdmin,
  installerAdmin,
  poserAbonnementOrigine,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 (revue de sécurité, décision du thread principal) : un VRAI paiement (K-PAY ou manuel) qui prolonge un abonnement d'origine
// `offert` ou `admin` en fait un abonnement d'origine `paiement`, sinon le client n'apparaît jamais comme abonné payant
// (revenus, alertes, vue d'ensemble ne comptent que `origine = 'paiement'`). L'échéance reste celle de `prolonger`.
// Le marquage manuel passe par le même `confirmerPaiement` -> `prolonger` (prouvé de bout en bout dans a3-marquage-manuel).
// Base PostgreSQL RÉELLE, aucun mock de `confirmerPaiement` ni de `prolonger` ; horloge réelle (la vue d'ensemble compte les
// abonnements encore actifs à `now()`).

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin({ name: 'Administrateur A3' })
})

afterEach(() => {
  desinstallerAdmin()
})

async function confirmer(paiementId: string, now: Date) {
  const { confirmerPaiement } = await confirmationService()
  return db.transaction((tx) => confirmerPaiement(tx, paiementId, now, {}))
}

async function abonnesPayants(): Promise<number> {
  const reponse = await appelerAdmin(ROUTES.vueEnsemble, connecte, { chemin: '/api/admin/vue-ensemble' })
  expect(reponse.status).toBe(200)
  return schemaVueEnsembleEnrichieDto.parse(reponse.corps).compteurs.abonnesPayants
}

describe('origine de l\'abonnement après un vrai paiement', () => {
  it.each(['offert', 'admin', 'essai'] as const)('should turn a %s subscription into a paid one when a K-PAY payment extends it, and count the customer as payer', async (origine) => {
    const maintenant = new Date()
    const user = await createUser()
    const echeance = plus(maintenant, jours(10))
    await poserAbonnementOrigine(user.id, echeance, { origine })
    expect(await abonnesPayants()).toBe(0)
    const paiement = await insererPaiement(user.id)

    expect(await confirmer(paiement.id, maintenant)).toBe('applique')

    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.origine).toBe('paiement')
    expect(abonnement?.dernierPaiementId).toBe(paiement.id)
    // L'échéance n'est pas modifiée par ce correctif : prolongation depuis l'échéance en cours.
    expect(abonnement?.expireLe.getTime()).toBe(calculerNouvelleEcheance(choisirBase(maintenant, echeance), 1, 'Africa/Douala').getTime())
    expect(await abonnesPayants()).toBe(1)
  })

  it('should leave an offered subscription offered when no payment is behind the extension', async () => {
    const maintenant = new Date()
    const user = await createUser()
    await poserAbonnementOrigine(user.id, plus(maintenant, jours(10)), { origine: 'offert' })
    const { prolonger } = await import('../../../server/services/paiements/prolongation')

    await db.transaction((tx) => prolonger(tx, user.id, 1, maintenant, null))

    expect((await lireAbonnement(user.id))?.origine).toBe('offert')
    expect(await abonnesPayants()).toBe(0)
  })
})
