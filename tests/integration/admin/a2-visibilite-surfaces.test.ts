import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/utils/db'
import { fakeEvent } from '../../support/h3'
import { REFERENCE_AGENDA } from '../support/agenda'
import { creerPro, lireOutbox, utc, viderOutbox, insererReservation } from '../support/notifications'
import { modulesPlanification, poserRappelVisiteur, traiter } from '../support/planification'
import { creerFournisseurSeo, creerVitrineSeo, depsSeo, lireGenerationsSeo, lireVitrineSeo, seoService } from '../support/seo-ia'
import {
  CANARIS_VISITEUR,
  MAINTENANT_A2,
  MOTIF_DEPUBLICATION,
  VISITEUR_RESERVATION,
  bloquerEnBase,
  compterEcritures,
  creerMondeA2,
  creneau,
  debloquerEnBase,
  depublierParLePro,
  issue,
  reactiverEnBase,
  suspendreEnBase,
} from '../support/admin-a2'
import type { Ecritures, MondeA2 } from '../support/admin-a2'

// A2 CA02, CA04 (volet visiteur), CA05 (page publique), D-A2-03, D-A2-09, D-A2-10 : le prédicat unique de visibilité
// (publiée ET non bloquée ET titulaire non suspendu) est appliqué sur CHAQUE surface de la spec §4. Aucun mock : base
// PostgreSQL réelle, services publics réels. Les états sont posés directement en base (le prédicat est prouvé SANS
// passer par les actions d'administration, qui ont leurs propres fichiers de test).
//
// Pour chaque surface : (1) TÉMOIN visible = succès (sinon le 404 suivant pourrait venir d'une fixture cassée) ;
// (2) BASE DE COMPARAISON : la même surface sur une vitrine simplement non publiée par le professionnel ; (3) masquée
// = 404 de même code (le visiteur ne voit jamais la raison) et AUCUNE ligne écrite ; (4) état levé = tout revient.

const vitrinesService = () => import('../../../server/services/vitrines')
const servicesService = () => import('../../../server/services/services')
const realisationsService = () => import('../../../server/services/realisations')
const temoignagesService = () => import('../../../server/services/temoignages')
const liensService = () => import('../../../server/services/liens')
const creneauxService = () => import('../../../server/services/creneaux')
const reservationsService = () => import('../../../server/services/reservations')
const demandesService = () => import('../../../server/services/demandes')
const messagesService = () => import('../../../server/services/messages')
const statistiquesService = () => import('../../../server/services/statistiques')
const mediasService = () => import('../../../server/services/medias')
const sitemapService = () => import('../../../server/services/seo-sitemap')

const UA_NAVIGATEUR = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit'
const NOT_FOUND = 404

interface Surface {
  nom: string
  /** Colonne de `compterEcritures` qui doit augmenter de 1 quand l'appel réussit ; `null` pour une lecture. */
  ecrit: keyof Ecritures | null
  /** `true` : un succès est attendu sur une vitrine non publiée par le professionnel (lecture de confirmation). */
  appeler: (m: MondeA2, tour: number) => Promise<unknown>
}

const ip = (tour: number): string => `203.0.113.${100 + tour}`

const SURFACES: readonly Surface[] = [
  { nom: 'page publique', ecrit: null, appeler: async (m) => (await vitrinesService()).getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2) },
  { nom: 'liste des services', ecrit: null, appeler: async (m) => (await servicesService()).getPublicServices(m.vitrine.username, MAINTENANT_A2) },
  { nom: 'détail d\'un service', ecrit: null, appeler: async (m) => (await servicesService()).getPublicService(m.vitrine.username, m.service.slug, MAINTENANT_A2) },
  { nom: 'liste des réalisations', ecrit: null, appeler: async (m) => (await realisationsService()).getPublicRealisations(m.vitrine.username, MAINTENANT_A2) },
  { nom: 'détail d\'une réalisation', ecrit: null, appeler: async (m) => (await realisationsService()).getPublicRealisation(m.vitrine.username, m.realisationSlug, MAINTENANT_A2) },
  { nom: 'témoignages', ecrit: null, appeler: async (m) => (await temoignagesService()).getPublicTemoignages(m.vitrine.username, MAINTENANT_A2) },
  { nom: 'liens', ecrit: null, appeler: async (m) => (await liensService()).getPublicLiens(m.vitrine.username) },
  {
    nom: 'créneaux',
    ecrit: null,
    appeler: async (m) => {
      const resultat = await (await creneauxService()).listCreneaux({ username: m.vitrine.username, serviceSlug: m.service.slug, du: '2026-11-02', au: '2026-11-02', maintenant: MAINTENANT_A2 })
      if (resultat.creneaux.length === 0) throw new Error('Fixture sans créneau : le témoin ne prouve rien.')
    },
  },
  { nom: 'photo servie', ecrit: null, appeler: async (m) => (await mediasService()).getPartageVariant(m.mediaId, m.vitrine.id) },
  {
    nom: 'confirmation de réservation',
    ecrit: null,
    appeler: async (m) => (await reservationsService()).getReservationConfirmation(m.confirmationToken, MAINTENANT_A2, m.vitrine.username),
  },
  {
    nom: 'réservation (écriture)',
    ecrit: 'reservations',
    appeler: async (m, tour) => (await reservationsService()).createReservation(m.vitrine.username, { serviceSlug: m.service.slug, debut: creneau(tour), ...VISITEUR_RESERVATION }, MAINTENANT_A2),
  },
  {
    nom: 'demande (écriture)',
    ecrit: 'demandes',
    appeler: async (m) => (await demandesService()).createDemande(m.vitrine.username, {
      serviceSlug: m.serviceDevis.slug,
      nom: CANARIS_VISITEUR.nom,
      email: CANARIS_VISITEUR.email,
      telephone: CANARIS_VISITEUR.telephone,
      message: CANARIS_VISITEUR.message,
    }),
  },
  {
    nom: 'message (écriture)',
    ecrit: 'messages',
    appeler: async (m) => (await messagesService()).createMessage(m.vitrine.username, {
      nom: CANARIS_VISITEUR.nom,
      email: CANARIS_VISITEUR.email,
      telephone: CANARIS_VISITEUR.telephone,
      sujet: 'question_avant_reservation',
      message: CANARIS_VISITEUR.message,
    }),
  },
  { nom: 'clic sur un lien (écriture)', ecrit: 'clics', appeler: async (m, tour) => (await liensService()).recordLienClic(m.vitrine.username, m.lienSlug, ip(tour)) },
  {
    nom: 'vue (écriture)',
    ecrit: 'vues',
    appeler: async (m, tour) => (await statistiquesService()).enregistrerVue({
      username: m.vitrine.username,
      chemin: `/${m.vitrine.username}`,
      origine: null,
      ip: ip(tour),
      userAgent: UA_NAVIGATEUR,
      headers: {},
      now: MAINTENANT_A2,
    }),
  },
]

interface EtatMasquant {
  nom: string
  poser: (m: MondeA2) => Promise<void>
  lever: (m: MondeA2) => Promise<void>
}

const ETATS: readonly EtatMasquant[] = [
  { nom: 'titulaire suspendu', poser: (m) => suspendreEnBase(m.user.id), lever: (m) => reactiverEnBase(m.user.id) },
  { nom: 'vitrine bloquée par l\'administration', poser: (m) => bloquerEnBase(m.vitrine.id), lever: (m) => debloquerEnBase(m.vitrine.id) },
  {
    nom: 'titulaire suspendu ET vitrine bloquée',
    poser: async (m) => {
      await suspendreEnBase(m.user.id)
      await bloquerEnBase(m.vitrine.id)
    },
    lever: async (m) => {
      await reactiverEnBase(m.user.id)
      await debloquerEnBase(m.vitrine.id)
    },
  },
]

const CAS = ETATS.flatMap((etat) => SURFACES.map((surface) => [etat.nom, surface.nom, etat, surface] as const))

async function republierParLePro(m: MondeA2): Promise<void> {
  await db.execute(sql`UPDATE vitrines SET publiee_le = now() WHERE id = ${m.vitrine.id}`)
}

describe('prédicat de visibilité sur chaque surface (CA02, CA04, CA05, D-A2-10)', () => {
  it.each(CAS)('should hide the %s from visitors on « %s » with a 404 and write nothing, then bring it back when lifted', async (_etat, _surface, etat, surface) => {
    const m = await creerMondeA2()
    // (1) Témoin visible : l'appel réussit, et une écriture augmente bien son compteur de 1.
    const avantTemoin = await compterEcritures(m.vitrine.id)
    expect(await issue(surface.appeler(m, 0)), 'témoin visible').toEqual({ ok: true })
    if (surface.ecrit !== null) expect((await compterEcritures(m.vitrine.id))[surface.ecrit]).toBe(avantTemoin[surface.ecrit] + 1)

    // (2) Base de comparaison : la même surface quand le PROFESSIONNEL a dépublié sa vitrine (comportement historique).
    await depublierParLePro(m.vitrine.id)
    const nonPubliee = await issue(surface.appeler(m, 1))
    await republierParLePro(m)

    // (3) Masquée par l'administration : 404 indistinguable, aucune écriture.
    await etat.poser(m)
    const avant = await compterEcritures(m.vitrine.id)
    const masque = await issue(surface.appeler(m, 2))

    expect(masque).toMatchObject({ ok: false, status: NOT_FOUND })
    if (!nonPubliee.ok) expect(masque).toEqual(nonPubliee)
    expect(await compterEcritures(m.vitrine.id)).toEqual(avant)

    // (4) Levée : tout revient sans autre action (CA04).
    await etat.lever(m)
    expect(await issue(surface.appeler(m, 3)), 'après levée').toEqual({ ok: true })
  })

  it('should answer VITRINE_INTROUVABLE (not a confirmation-specific code) for a confirmation read on a suspended account (D-A2-10)', async () => {
    const m = await creerMondeA2()
    await suspendreEnBase(m.user.id)

    const resultat = await issue((await reservationsService()).getReservationConfirmation(m.confirmationToken, MAINTENANT_A2, m.vitrine.username))

    expect(resultat).toEqual({ ok: false, status: NOT_FOUND, code: 'VITRINE_INTROUVABLE' })
  })

  it('should answer the same 404 for a username that never existed and for a suspended one (no oracle on the cause)', async () => {
    const m = await creerMondeA2()
    await suspendreEnBase(m.user.id)
    const { getPublicVitrinePage } = await vitrinesService()

    const suspendu = await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))
    const inconnu = await issue(getPublicVitrinePage('nexiste-pas-du-tout', MAINTENANT_A2))

    expect(suspendu).toEqual(inconnu)
    expect(suspendu).toMatchObject({ ok: false, status: NOT_FOUND, code: 'VITRINE_INTROUVABLE' })
  })

  it('should read the suspension at EVERY call: a vitrine hidden then restored without any cache in between', async () => {
    const m = await creerMondeA2()
    const { getPublicVitrinePage } = await vitrinesService()

    for (const cycle of [1, 2, 3]) {
      await suspendreEnBase(m.user.id)
      expect((await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).ok, `cycle ${cycle} suspendu`).toBe(false)
      await reactiverEnBase(m.user.id)
      expect((await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).ok, `cycle ${cycle} réactivé`).toBe(true)
    }
  })

  it('should NOT expose the vitrine of one suspended account on the vitrine of another one (isolation)', async () => {
    const a = await creerMondeA2()
    const b = await creerMondeA2()
    await suspendreEnBase(a.user.id)
    const { getPublicVitrinePage } = await vitrinesService()

    expect((await issue(getPublicVitrinePage(a.vitrine.username, MAINTENANT_A2))).ok).toBe(false)
    expect((await issue(getPublicVitrinePage(b.vitrine.username, MAINTENANT_A2))).ok).toBe(true)
  })

  it('should keep an account that was suspended AND has an expired suspension end hidden until the flag is lifted (the flag decides, not a date)', async () => {
    const m = await creerMondeA2()
    await db.execute(sql`UPDATE users SET suspendu = true, suspension_fin = now() - interval '1 day' WHERE id = ${m.user.id}`)
    const { getPublicVitrinePage } = await vitrinesService()

    expect(await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).toMatchObject({ ok: false, status: NOT_FOUND })
  })
})

describe('visibilité : un état masquant ne détruit rien (CA04)', () => {
  it('should keep publiee_le, the content and the visitor data while hidden, and restore the page with the same content', async () => {
    const m = await creerMondeA2()
    const { getPublicVitrinePage } = await vitrinesService()
    const avant = await getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)

    await suspendreEnBase(m.user.id)
    await bloquerEnBase(m.vitrine.id)
    const ligne = await db.execute<{ publiee: boolean, services: string, reservations: string }>(sql`
      SELECT publiee_le IS NOT NULL AS publiee,
        (SELECT count(*) FROM services WHERE vitrine_id = ${m.vitrine.id})::text AS services,
        (SELECT count(*) FROM reservations WHERE vitrine_id = ${m.vitrine.id})::text AS reservations
      FROM vitrines WHERE id = ${m.vitrine.id}`)
    await reactiverEnBase(m.user.id)
    await debloquerEnBase(m.vitrine.id)
    const apres = await getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)

    expect(ligne.rows[0]).toEqual({ publiee: true, services: '2', reservations: '1' })
    expect(apres.vitrine.id).toBe(avant.vitrine.id)
    expect(apres.contenus).toEqual(avant.contenus)
    expect(apres.contenus.services).toBe(2)
  })
})

describe('sitemap (CA02 : absente du sitemap)', () => {
  beforeEach(async () => {
    await viderOutbox()
  })

  it.each(ETATS.map((e) => [e.nom, e] as const))('should list a visible vitrine, drop it while %s, and list it again once lifted', async (_nom, etat) => {
    const m = await creerMondeA2()
    const { listerUrlsSitemap } = await sitemapService()
    const locs = async (): Promise<string[]> => (await listerUrlsSitemap(MAINTENANT_A2)).map((u) => u.loc)

    expect(await locs()).toContain(`/${m.vitrine.username}`)

    await etat.poser(m)
    const masque = await locs()
    expect(masque.some((loc) => loc.startsWith(`/${m.vitrine.username}`)), 'aucune URL de cette vitrine').toBe(false)

    await etat.lever(m)
    expect(await locs()).toContain(`/${m.vitrine.username}`)
  })

  it('should drop the vitrine from the sitemap ROUTE answer too, including its services and realisations', async () => {
    const m = await creerMondeA2()
    await suspendreEnBase(m.user.id)
    const { default: route } = await import('../../../server/api/__sitemap__/vitrines/get')

    const corps = (await route(fakeEvent({ url: '/api/__sitemap__/vitrines' }))) as { urls: Array<{ loc: string }> }

    expect(corps.urls.filter((u) => u.loc.includes(m.vitrine.username))).toEqual([])
  })
})

describe('génération SEO par IA : rien pour une vitrine masquée (spec §4, ia/seo.ts)', () => {
  it.each([
    ['suspendu', async (userId: string, _vitrineId: string) => suspendreEnBase(userId)],
    ['bloquée', async (_userId: string, vitrineId: string) => bloquerEnBase(vitrineId)],
  ] as const)('should call no provider, write no proposal and keep no generation row when the vitrine is %s', async (_nom, masquer) => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'aucun' })
    await masquer(user.id, vitrine.id)
    const provider = creerFournisseurSeo()
    const { regenererSeoVitrine } = await seoService()

    const resultat = await regenererSeoVitrine(vitrine.id, depsSeo(provider))

    expect(resultat).toMatchObject({ ecrit: false })
    expect(provider.appels).toHaveLength(0)
    expect(await lireGenerationsSeo(user.id)).toHaveLength(0)
    expect((await lireVitrineSeo(vitrine.id))?.seoIaTitre).toBeNull()
  })

  it('should generate normally for the same vitrine when it is visible (control)', async () => {
    const { vitrine } = await creerVitrineSeo({ ia: 'aucun' })
    const provider = creerFournisseurSeo()
    const { regenererSeoVitrine } = await seoService()

    const resultat = await regenererSeoVitrine(vitrine.id, depsSeo(provider))

    expect(resultat).toMatchObject({ ecrit: true })
    expect(provider.appels).toHaveLength(1)
  })
})

describe('rappels et résumés (D-A2-09)', () => {
  // Mardi 2026-11-10, 07 h locale à Douala (UTC+1) : fenêtre du « rendez-vous du jour ».
  const RDV = utc('2026-11-10T13:00:00.000Z')
  const NOW = utc('2026-11-10T06:00:00.000Z')
  // Lundi 2026-11-02, 08 h locale : fenêtre du résumé hebdomadaire.
  const NOW_RESUME = utc('2026-11-02T07:00:00.000Z')

  beforeEach(async () => {
    await viderOutbox()
  })

  it('should plan the « rendez-vous du jour » of an active account (control) and NONE for a suspended account', async () => {
    const { planifierNotifications } = await modulesPlanification()
    const actif = await creerPro()
    const suspendu = await creerPro()
    for (const pro of [actif, suspendu]) await insererReservation(pro.vitrine.id, pro.service.id, { debut: RDV, statut: 'confirmee' })
    await suspendreEnBase(suspendu.user.id)

    const resultat = await planifierNotifications(NOW)

    expect(resultat.rappelsJour).toBe(1)
    expect(await lireOutbox({ entiteId: actif.user.id, type: 'utilisateur_rappel_journee' })).toHaveLength(1)
    expect(await lireOutbox({ entiteId: suspendu.user.id })).toHaveLength(0)
  })

  it('should plan the weekly summary of an active account (control) and NONE for a suspended account', async () => {
    const { planifierNotifications } = await modulesPlanification()
    const actif = await creerPro()
    const suspendu = await creerPro()
    await suspendreEnBase(suspendu.user.id)

    const resultat = await planifierNotifications(NOW_RESUME)

    expect(resultat.resumes).toBe(1)
    expect(await lireOutbox({ entiteId: actif.user.id, type: 'utilisateur_resume_hebdo' })).toHaveLength(1)
    expect(await lireOutbox({ entiteId: suspendu.user.id, type: 'utilisateur_resume_hebdo' })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: suspendu.user.id })).toHaveLength(0)
  })

  it('should STILL send the reminder of a confirmed visitor appointment already planned when the account is suspended (D-A2-09, first half)', async () => {
    const pro = await creerPro()
    const debut = utc('2026-11-12T09:00:00.000Z')
    const { ligne } = await poserRappelVisiteur(pro, { debut })
    await suspendreEnBase(pro.user.id)

    const traitement = await traiter(ligne.id, utc('2026-11-11T09:30:00.000Z'))

    expect(traitement.resultat.statut).toBe('envoye')
    expect(traitement.transport.sends).toHaveLength(1)
  })

  it('should keep the planification idempotent and not plan again after reactivation for an already planned day', async () => {
    const { planifierNotifications } = await modulesPlanification()
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: RDV, statut: 'confirmee' })
    await planifierNotifications(NOW)
    await suspendreEnBase(pro.user.id)
    await reactiverEnBase(pro.user.id)

    await planifierNotifications(NOW)

    expect(await lireOutbox({ entiteId: pro.user.id, type: 'utilisateur_rappel_journee' })).toHaveLength(1)
  })
})

describe('référence : la dépublication par le professionnel garde son comportement (non-régression)', () => {
  it('should still hide a vitrine unpublished by its owner, with no administration flag involved', async () => {
    const m = await creerMondeA2()
    await depublierParLePro(m.vitrine.id)
    const { getPublicVitrinePage } = await vitrinesService()

    expect(await issue(getPublicVitrinePage(m.vitrine.username, REFERENCE_AGENDA))).toMatchObject({ ok: false, status: NOT_FOUND })
    expect(MOTIF_DEPUBLICATION.length).toBeGreaterThan(4)
  })
})
