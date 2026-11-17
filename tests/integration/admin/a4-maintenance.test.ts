import { beforeEach, describe, expect, it } from 'vitest'
import { MAINTENANCE_RETRY_AFTER_S } from '../../../shared/admin'
import { schemaEtatPublicDto } from '../../../shared/schemas/admin-a4'
import { ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import { appelerA4, ecrireReglage, passerParMaintenance, poserReglage, reinitialiserA4 } from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'

// A4 CA02 et CA03 (D-A4-08) : la maintenance suspend le studio (écritures) et la connexion des PROFESSIONNELS ; les vitrines
// publiques, les webhooks de paiement, la réservation d'un visiteur et l'administration (y compris sa propre connexion :
// sinon plus personne ne pourrait lever la maintenance) restent ouverts. Le middleware est appelé avec un événement h3
// réel ; le réglage est lu dans la VRAIE base (aucun mock du repository).

const suite = preparerSuiteAdmin()
let connecte: AdminA4
const MESSAGE = 'Retour dans 10 minutes.'

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
  await poserReglage('maintenance.message', MESSAGE, connecte.admin.id)
})

const activer = () => poserReglage('maintenance.active', true, connecte.admin.id)

describe('maintenance : ce qui est suspendu et ce qui reste ouvert (CA02)', () => {
  it('should answer 503 MAINTENANCE with Retry-After and the message for a studio write and for the sign-in routes of the public host', async () => {
    await activer()

    for (const [methode, chemin] of [
      ['PUT', '/api/studio/vitrine'],
      ['POST', '/api/studio/services'],
      ['DELETE', '/api/studio/moi'],
      ['POST', '/api/auth/sign-in/email-otp'],
      ['POST', '/api/auth/email-otp/send-verification-otp'],
      ['POST', '/api/auth/phone-number/send-otp'],
    ] as const) {
      const resultat = await passerParMaintenance(methode, chemin)
      expect(resultat, `${methode} ${chemin}`).toMatchObject({ status: 503, code: 'MAINTENANCE', retryAfter: String(MAINTENANCE_RETRY_AFTER_S), laisse: false })
      expect(JSON.stringify(resultat.data), `${methode} ${chemin}`).toContain(MESSAGE)
    }
  })

  it('should leave open a studio read, the public vitrines, a visitor booking, the payment webhook, the state route and the whole administration (even its sign-in)', async () => {
    await activer()

    for (const [methode, chemin, hote] of [
      ['GET', '/api/studio/moi', 'public'],
      ['GET', '/api/public/dr-test', 'public'],
      ['POST', '/api/public/dr-test/reservations', 'public'],
      ['POST', '/api/webhooks/kpay', 'public'],
      ['GET', '/api/public/etat', 'public'],
      ['GET', '/api/admin/session', 'admin'],
      ['PUT', '/api/admin/reglages/maintenance.active', 'admin'],
      ['POST', '/api/auth/email-otp/send-verification-otp', 'admin'],
      ['POST', '/api/auth/sign-in/email-otp', 'admin'],
    ] as const) {
      expect((await passerParMaintenance(methode, chemin, hote)).laisse, `${methode} ${chemin} (${hote})`).toBe(true)
    }
  })

  it('should tell the studio about the maintenance and its message through the public state route, and nothing more', async () => {
    const hors = await appelerA4('etatPublic', { hote: 'public' })
    await activer()
    const en = await appelerA4('etatPublic', { hote: 'public' })

    expect(schemaEtatPublicDto.parse(hors.corps)).toEqual({ maintenance: false, message: null, inscriptions: true })
    expect(schemaEtatPublicDto.parse(en.corps)).toEqual({ maintenance: true, message: MESSAGE, inscriptions: true })
  })
})

describe('fin de maintenance (CA03)', () => {
  it('should restore the studio without any restart as soon as the administrator switches the maintenance off through the API', async () => {
    await activer()
    expect((await passerParMaintenance('PUT', '/api/studio/vitrine')).status).toBe(503)

    const arret = await ecrireReglage(connecte, 'maintenance.active', false)

    expect(arret.status).toBe(200)
    expect((await passerParMaintenance('PUT', '/api/studio/vitrine')).laisse).toBe(true)
    expect((await passerParMaintenance('POST', '/api/auth/sign-in/email-otp')).laisse).toBe(true)
  })
})
