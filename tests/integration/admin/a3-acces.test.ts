import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hoteDe } from '../support/admin'
import { insererPaiement, lireAbonnement, lirePaiement, poserAbonnement, plus, jours } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { lireOutbox } from '../support/notifications'
import {
  appelerAdmin,
  appelerRoute,
  compterEvenements,
  desinstallerAdmin,
  installerAdmin,
  journalDe,
  MOTIF,
  ROUTES,
  sessionOrdinaire,
} from '../support/admin-a3'
import type { AdminConnecte, AppelRoute } from '../support/admin-a3'

// A3 CA13 (accès) : CHAQUE route d'administration de ce sprint répond 404 uniforme (même corps, aucune cause qui fuit) sans
// session, avec la session d'un compte ordinaire, sur l'hôte public, et pour une écriture venue d'une autre origine, même avec
// la session d'un administrateur. Garde RÉELLE (`requireSuperadmin`, instance Better Auth réelle) ; aucune écriture n'a lieu.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const ID = randomUUID()
const CLE = 'cle-idempotence-0001'

const CAS: ReadonlyArray<{ nom: string, charger: Parameters<typeof appelerRoute>[0], appel: Omit<AppelRoute, 'cookie'> }> = [
  { nom: 'GET /abonnements', charger: ROUTES.abonnements, appel: { chemin: '/api/admin/abonnements?onglet=grace' } },
  { nom: 'POST /abonnements/[id]/rappel', charger: ROUTES.abonnementRappel, appel: { chemin: `/api/admin/abonnements/${ID}/rappel`, methode: 'POST', params: { id: ID }, corps: { motif: MOTIF } } },
  { nom: 'GET /paiements', charger: ROUTES.paiements, appel: { chemin: '/api/admin/paiements' } },
  { nom: 'GET /paiements/[id]', charger: ROUTES.paiementDetail, appel: { chemin: `/api/admin/paiements/${ID}`, params: { id: ID } } },
  { nom: 'POST /paiements/[id]/reverifier', charger: ROUTES.paiementReverifier, appel: { chemin: `/api/admin/paiements/${ID}/reverifier`, methode: 'POST', params: { id: ID }, corps: { motif: MOTIF, cleIdempotence: CLE } } },
  { nom: 'POST /paiements/[id]/marquer-paye', charger: ROUTES.paiementMarquerPaye, appel: { chemin: `/api/admin/paiements/${ID}/marquer-paye`, methode: 'POST', params: { id: ID }, corps: { motif: MOTIF, cleIdempotence: CLE }, reauth: '123456' } },
  { nom: 'GET /revenus', charger: ROUTES.revenus, appel: { chemin: '/api/admin/revenus' } },
  { nom: 'GET /alertes', charger: ROUTES.alertes, appel: { chemin: '/api/admin/alertes' } },
  { nom: 'POST /export/paiements', charger: ROUTES.exportPaiements, appel: { chemin: '/api/admin/export/paiements', methode: 'POST', corps: { motif: MOTIF } } },
  { nom: 'GET /vue-ensemble', charger: ROUTES.vueEnsemble, appel: { chemin: '/api/admin/vue-ensemble' } },
]

describe('accès aux routes d\'administration de A3 (CA13)', () => {
  it.each(CAS)('should answer 404 to $nom without a session', async ({ charger, appel }) => {
    const reponse = await appelerRoute(charger, appel)

    expect(reponse.status).toBe(404)
    expect(reponse.corps).toBeUndefined()
  })

  it.each(CAS)('should answer 404 to $nom for an ordinary account', async ({ charger, appel }) => {
    const { cookie } = await sessionOrdinaire()

    const reponse = await appelerRoute(charger, { ...appel, cookie })

    expect(reponse.status).toBe(404)
    expect(reponse.corps).toBeUndefined()
  })

  it.each(CAS)('should answer 404 to $nom on the PUBLIC host, even with an administrator session', async ({ charger, appel }) => {
    const reponse = await appelerAdmin(charger, connecte, { ...appel, entetes: { host: hoteDe('public') } })

    expect(reponse.status).toBe(404)
    expect(reponse.corps).toBeUndefined()
  })

  it.each(CAS.filter((c) => c.appel.methode === 'POST'))('should answer 404 to $nom for a write coming from another origin', async ({ charger, appel }) => {
    const reponse = await appelerAdmin(charger, connecte, { ...appel, entetes: { origin: 'https://autre-site.example' } })

    expect(reponse.status).toBe(404)
    expect(reponse.corps).toBeUndefined()
  })

  it('should give the SAME 404 answer on every route and every refusal cause (no oracle)', async () => {
    const { cookie } = await sessionOrdinaire()
    const reponses = []
    for (const { charger, appel } of CAS) {
      reponses.push(await appelerRoute(charger, appel))
      reponses.push(await appelerRoute(charger, { ...appel, cookie }))
    }

    expect(new Set(reponses.map((r) => `${r.status}|${r.code}|${JSON.stringify(r.data)}`)).size).toBe(1)
  })

  it('should write nothing when a write is refused: no payment change, no reminder, no journal line, no K-PAY call', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id, { statut: 'echoue', idFournisseur: null })
    const abonnement = await poserAbonnement(user.id, plus(new Date(), jours(10)))
    const { cookie } = await sessionOrdinaire()
    for (const nom of ['POST /abonnements/[id]/rappel', 'POST /paiements/[id]/reverifier', 'POST /paiements/[id]/marquer-paye', 'POST /export/paiements']) {
      const cas = CAS.find((c) => c.nom === nom)
      if (cas === undefined) throw new Error(nom)
      await appelerRoute(cas.charger, { ...cas.appel, cookie })
      await appelerRoute(cas.charger, cas.appel)
    }

    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'echoue' })
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(abonnement.expireLe)
    expect(await lireOutbox({ type: 'abonnement_rappel' })).toHaveLength(0)
    expect(await compterEvenements()).toBe(0)
    for (const action of ['paiement.reverifier', 'paiement.marquer_paye', 'abonnement.rappeler', 'export.paiements']) expect(await journalDe(action)).toHaveLength(0)
  })
})
