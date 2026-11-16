import { beforeEach, describe, expect, it } from 'vitest'
import {
  compterJournal,
  creerSuperadmin,
  creerUtilisateurOrdinaire,
  ouvrirAdmin,
  ouvrirSession,
  preparerSuiteAdmin,
} from '../support/admin'
import {
  CHARGEURS_A2,
  DESCRIPTIONS_A2,
  MOTIF_A2,
  appelerA2,
  compterEmailsOutbox,
  creerMondeA2,
  lireUtilisateur,
  lireVitrineDe,
} from '../support/admin-a2'
import type { OptionsA2, RouteA2 } from '../support/admin-a2'

// A2 : accès aux 16 routes d'administration (hôte, session, rôle, origine). Toute anomalie = le MÊME 404, avant toute
// lecture du corps ou de la base : aucune cause ne fuit, aucune écriture ne passe (A1 D-A1-05, spec A2 §5 et CA11).
// Handlers, base et Better Auth réels.

const suite = preparerSuiteAdmin()
const ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const ROUTES = Object.keys(CHARGEURS_A2) as RouteA2[]

let cookieAdmin: string

beforeEach(async () => {
  ;({ cookie: cookieAdmin } = await ouvrirAdmin(suite.auth()))
})

/** Requête « valable » : ce que ferait un administrateur légitime (corps conforme, clé et code éventuels factices). */
function requete(route: RouteA2): OptionsA2 {
  const d = DESCRIPTIONS_A2[route]
  const base: OptionsA2 = { ...(d.modele.includes(':id') ? { id: ID } : {}) }
  if (route === 'recherche') return { ...base, query: { q: 'alice' } }
  if (route === 'assistantsListe') return { ...base, query: { utilisateurId: ID } }
  if (d.methode === 'GET') return base
  const corps: Record<string, unknown> = { motif: MOTIF_A2 }
  if (route === 'offrirJours') Object.assign(corps, { jours: 5 })
  if (route === 'changerPlan') Object.assign(corps, { plan: 'payant', jours: 5 })
  if (route === 'supprimer') Object.assign(corps, { emailConfirmation: 'quelquun@exemple.test' })
  return { ...base, corps, cleIdempotence: 'cle-idempotence-9999', reauth: '123456' }
}

const refus = (r: { status: number, code: string | undefined, message: string | undefined, data: unknown }) => ({ status: r.status, code: r.code, message: r.message, data: r.data })

describe.each(ROUTES)('accès à la route %s', (route) => {
  it('should answer the uniform 404 on the PUBLIC host even with a valid administrator session', async () => {
    const reponse = await appelerA2(route, { ...requete(route), cookie: cookieAdmin, hote: 'public' })

    expect(reponse.status).toBe(404)
  })

  it('should answer the uniform 404 without any session, on the administration host', async () => {
    const reponse = await appelerA2(route, requete(route))

    expect(reponse.status).toBe(404)
  })

  it('should answer the uniform 404 to an ordinary account\'s session, and to a superadmin session opened on the PUBLIC host (not an administration session)', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    const { cookie: cookieOrdinaire } = await ouvrirSession(suite.auth(), ordinaire.email, 'public')
    const superadmin = await creerSuperadmin()
    const { cookie: cookieSessionPublique } = await ouvrirSession(suite.auth(), superadmin.email, 'public')

    const a = await appelerA2(route, { ...requete(route), cookie: cookieOrdinaire })
    const b = await appelerA2(route, { ...requete(route), cookie: cookieSessionPublique })

    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
  })

  it('should answer the very same 404 body for every refusal cause (no oracle)', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    const { cookie: cookieOrdinaire } = await ouvrirSession(suite.auth(), ordinaire.email, 'public')

    const reponses = [
      await appelerA2(route, { ...requete(route), cookie: cookieAdmin, hote: 'public' }),
      await appelerA2(route, requete(route)),
      await appelerA2(route, { ...requete(route), cookie: cookieOrdinaire }),
      await appelerA2(route, { ...requete(route), cookie: 'better-auth.session_token=forge.forge' }),
    ]

    for (const reponse of reponses) expect(refus(reponse)).toEqual(refus(reponses[0]!))
    expect(reponses[0]?.status).toBe(404)
  })

  it('should check the guard BEFORE the body, the identifier and the reauthentication: an invalid request without session is a 404, never a 422 or 403', async () => {
    const d = DESCRIPTIONS_A2[route]
    const invalide: OptionsA2 = d.methode === 'GET'
      ? { ...(d.modele.includes(':id') ? { id: 'x'.repeat(200) } : {}), query: { q: '', page: '-5', tri: 'password' } }
      : { id: 'x'.repeat(200), corps: { motif: 1, inconnu: true } }

    const reponse = await appelerA2(route, invalide)

    expect(reponse.status).toBe(404)
  })

  if (DESCRIPTIONS_A2[route].methode === 'POST') {
    it('should refuse a cross-site write (foreign Origin, Sec-Fetch-Site: cross-site) with the same 404, and write nothing', async () => {
      const m = await creerMondeA2()
      const base: OptionsA2 = { ...requete(route), id: DESCRIPTIONS_A2[route].modele.includes('/vitrines/') ? m.vitrine.id : m.user.id, cookie: cookieAdmin }

      const origineEtrangere = await appelerA2(route, { ...base, origine: 'https://evil.example' })
      const fetchSite = await appelerA2(route, { ...base, entetes: { 'sec-fetch-site': 'cross-site' } })

      expect(origineEtrangere.status).toBe(404)
      expect(fetchSite.status).toBe(404)
      expect(await compterJournal()).toBe(0)
      expect(await compterEmailsOutbox()).toBe(0)
      expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
      expect((await lireVitrineDe(m.user.id))?.blocageAdmin).toBe(false)
    })
  }
})

describe('aucune écriture n\'est possible sans passer la garde', () => {
  it('should leave the whole database untouched after every write route was attacked without a session', async () => {
    const m = await creerMondeA2()

    for (const route of ROUTES.filter((r) => DESCRIPTIONS_A2[r].methode === 'POST')) {
      const id = DESCRIPTIONS_A2[route].modele.includes('/vitrines/') ? m.vitrine.id : m.user.id
      await appelerA2(route, { ...requete(route), id })
      await appelerA2(route, { ...requete(route), id, hote: 'public', cookie: cookieAdmin })
    }

    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
    expect(await lireUtilisateur(m.user.id)).toMatchObject({ banned: false })
    expect(await lireVitrineDe(m.user.id)).toMatchObject({ blocageAdmin: false })
  })

  it('should serve the read routes to a legitimate administrator (control: the 404 above is the guard, not a missing route)', async () => {
    const m = await creerMondeA2()

    const reponses = await Promise.all([
      appelerA2('recherche', { cookie: cookieAdmin, query: { q: 'abc' } }),
      appelerA2('utilisateursListe', { cookie: cookieAdmin }),
      appelerA2('utilisateurFiche', { cookie: cookieAdmin, id: m.user.id }),
      appelerA2('vitrinesListe', { cookie: cookieAdmin }),
      appelerA2('vitrineFiche', { cookie: cookieAdmin, id: m.vitrine.id }),
      appelerA2('assistantsListe', { cookie: cookieAdmin, query: { utilisateurId: m.user.id } }),
    ])

    expect(reponses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
  })
})
