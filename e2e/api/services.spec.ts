import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import { attendreErreur, fermerConnexions, lireErreur, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// S3-CA39 (les routes existent), CA40 (forme des réponses, messages intacts), CA41 (parcours API) et
// CA42 (ancienne route publique supprimée). Plus les contrats d'erreur HTTP de la création, de la
// mise à jour, du plafond de vedettes, du réordonnancement et de l'isolation. Les routes sans session
// (CA38) sont dans studio-auth.spec.ts.
// Une session par fichier (limite d'envoi OTP) : describe.serial, un utilisateur, une vitrine.

const CLES_SERVICE_STUDIO = [
  'actif', 'creeLe', 'description', 'dureeMin', 'enVedette', 'id', 'image', 'inclus', 'modifieLe', 'nbSeances',
  'ordre', 'paiementInstructions', 'paiementMode', 'prixDevise', 'prixMontant', 'reservable', 'rythme', 'slug',
  'tarif', 'titre', 'type',
].sort()

const CLES_CARTE_PUBLIQUE = [
  'description', 'dureeMin', 'image', 'nbSeances', 'prixDevise', 'prixMontant', 'reservable', 'rythme', 'slug',
  'tarif', 'titre', 'type',
].sort()

const CLES_DETAIL_PUBLIC = [...CLES_CARTE_PUBLIQUE, 'inclus', 'paiementInstructions', 'paiementMode', 'seo'].sort()

const MESSAGE_ORDRE_INVALIDE = 'L’ordre envoyé ne correspond plus à vos services. Rechargez la page et réessayez.'

interface ServiceStudio {
  id: string
  slug: string
  titre: string
  description: string | null
  image: { id: string, url: string } | null
  type: string
  nbSeances: number | null
  dureeMin: number | null
  tarif: string
  prixMontant: number | null
  prixDevise: string | null
  paiementMode: string | null
  inclus: string[]
  reservable: boolean
  enVedette: boolean
  actif: boolean
  ordre: number
}

interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

interface ReponseService {
  service: ServiceStudio
  compteurs: Compteurs
}

interface ReponseListe {
  services: ServiceStudio[]
  compteurs: Compteurs
}

interface ServicePublic {
  slug: string
  titre: string
  [cle: string]: unknown
}

interface ReponsePublicListe {
  total: number
  aLaUne: ServicePublic[]
  services: ServicePublic[]
}

interface ReponsePublicDetail {
  service: ServicePublic & { seo: { titre: string, description: string }, paiementMode: string | null }
  autres: ServicePublic[]
  total: number
}

const CONSULTATION = { titre: 'Consultation de cardiologie', type: 'rdv', dureeMin: 45, tarif: 'payant', prixMontant: 15000, prixDevise: 'XAF' }

test.describe.serial('services — API studio et publique (S3-CA39 à CA42)', () => {
  let session: Session
  let username: string

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    username = `svc-${randomUUID().slice(0, 8)}`
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await fermerConnexions()
  })

  async function creer(donnees: Record<string, unknown>): Promise<ReponseService> {
    const reponse = await session.api.post('/api/studio/services', { data: donnees })
    expect(reponse.status(), await reponse.text()).toBe(201)
    return (await reponse.json()) as ReponseService
  }

  async function lister(): Promise<ReponseListe> {
    const reponse = await session.api.get('/api/studio/services')
    expect(reponse.status()).toBe(200)
    return (await reponse.json()) as ReponseListe
  }

  async function viderLesServices(): Promise<void> {
    for (const service of (await lister()).services) {
      expect((await session.api.delete(`/api/studio/services/${service.id}`)).status()).toBe(204)
    }
  }

  test('CA39 GET and POST on /api/studio/services answer 404 VITRINE_INTROUVABLE while the user has no vitrine', async () => {
    await attendreErreur(await session.api.get('/api/studio/services'), 404, 'VITRINE_INTROUVABLE')
    await attendreErreur(await session.api.post('/api/studio/services', { data: CONSULTATION }), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA39 the vitrine is created, completed and published (setup of the following tests)', async () => {
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
  })

  test.describe('routes de l’élément (CA39 : elles existent, ce qui était le bug)', () => {
    test('CA39 GET /api/studio/services/<random uuid> answers 404 SERVICE_INTROUVABLE (not a bare route 404)', async () => {
      await attendreErreur(await session.api.get(`/api/studio/services/${randomUUID()}`), 404, 'SERVICE_INTROUVABLE')
    })

    test('CA39 GET /api/studio/services/pas-un-uuid answers 400 VALIDATION', async () => {
      await attendreErreur(await session.api.get('/api/studio/services/pas-un-uuid'), 400, 'VALIDATION')
    })

    test('CA39 PUT and DELETE on an unknown uuid answer 404 SERVICE_INTROUVABLE; on a malformed id 400 VALIDATION', async () => {
      await attendreErreur(await session.api.put(`/api/studio/services/${randomUUID()}`, { data: { titre: 'x' } }), 404, 'SERVICE_INTROUVABLE')
      await attendreErreur(await session.api.delete(`/api/studio/services/${randomUUID()}`), 404, 'SERVICE_INTROUVABLE')
      await attendreErreur(await session.api.put('/api/studio/services/pas-un-uuid', { data: { titre: 'x' } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.delete('/api/studio/services/pas-un-uuid'), 400, 'VALIDATION')
    })

    test('CA39 POST /api/studio/services/reordonner is a route of its own (it is not captured by :id)', async () => {
      const reponse = await session.api.post('/api/studio/services/reordonner', { data: { ids: [randomUUID()] } })

      await attendreErreur(reponse, 422, 'ORDRE_INVALIDE')
    })

    test('CA39 the old slug-based studio paths no longer exist', async () => {
      const reponse = await session.api.get('/api/studio/services/consultation-de-cardiologie')

      await attendreErreur(reponse, 400, 'VALIDATION')
    })
  })

  test.describe('création et forme des réponses (CA40)', () => {
    test.beforeEach(viderLesServices)

    test('CA40 POST answers 201 with the exact ServiceStudioDTO keys, the counters, and no ORM field', async () => {
      const reponse = await session.api.post('/api/studio/services', { data: CONSULTATION })

      expect(reponse.status()).toBe(201)
      const corps = (await reponse.json()) as ReponseService
      expect(Object.keys(corps).sort()).toEqual(['compteurs', 'service'])
      expect(Object.keys(corps.service).sort()).toEqual(CLES_SERVICE_STUDIO)
      for (const interdite of ['vitrineId', 'createdAt', 'updatedAt', 'imageMediaId']) {
        expect(corps.service).not.toHaveProperty(interdite)
      }
      expect(corps.service).toMatchObject({
        slug: 'consultation-de-cardiologie',
        titre: 'Consultation de cardiologie',
        tarif: 'payant',
        prixMontant: 15000,
        prixDevise: 'XAF',
        paiementMode: 'sur_place',
        enVedette: true,
        actif: true,
        reservable: true,
        ordre: 0,
        inclus: [],
        image: null,
      })
      expect(corps.service.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(corps.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    })

    test('CA40 GET /api/studio/services/:id and the list answer the same service', async () => {
      const { service } = await creer(CONSULTATION)

      const unitaire = (await (await session.api.get(`/api/studio/services/${service.id}`)).json()) as ReponseService
      const liste = await lister()

      expect(unitaire.service).toEqual(service)
      expect(liste.services).toEqual([service])
      expect(liste.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    })

    test('CA40 a devis without duration is accepted (201)', async () => {
      const { service } = await creer({ titre: 'Second avis', type: 'devis', tarif: 'devis' })

      expect(service).toMatchObject({ type: 'devis', tarif: 'devis', dureeMin: null, prixMontant: null })
    })

    test('CA40 the French error message keeps its accents and the statusMessage stays ASCII', async () => {
      const reponse = await session.api.post('/api/studio/services/reordonner', { data: { ids: [randomUUID()] } })

      const corps = await attendreErreur(reponse, 422, 'ORDRE_INVALIDE')
      expect(corps.message).toBe(MESSAGE_ORDRE_INVALIDE)
      expect(corps.message).not.toContain('�')
    })

    test('CA40 PUT answers 200 with the updated service and the counters; DELETE answers 204 with an empty body', async () => {
      const { service } = await creer(CONSULTATION)

      const maj = await session.api.put(`/api/studio/services/${service.id}`, { data: { description: 'Un bilan complet.' } })
      expect(maj.status()).toBe(200)
      const corps = (await maj.json()) as ReponseService
      expect(Object.keys(corps.service).sort()).toEqual(CLES_SERVICE_STUDIO)
      expect(corps.service).toMatchObject({ id: service.id, slug: service.slug, description: 'Un bilan complet.' })
      expect(corps.compteurs.total).toBe(1)

      const suppression = await session.api.delete(`/api/studio/services/${service.id}`)
      expect(suppression.status()).toBe(204)
      expect(await suppression.text()).toBe('')
      await attendreErreur(await session.api.get(`/api/studio/services/${service.id}`), 404, 'SERVICE_INTROUVABLE')
    })

    test('CA40 a service image is attached and served as /medias/<id>/1600.webp', async () => {
      const televersement = await session.api.post('/api/studio/medias', {
        multipart: { fichier: { name: 'service.png', mimeType: 'image/png', buffer: await makePng(400, 300) } },
      })
      expect(televersement.status()).toBe(201)
      const mediaId = ((await televersement.json()) as { media: { id: string } }).media.id

      const { service } = await creer({ ...CONSULTATION, imageMediaId: mediaId })

      expect(service.image).toMatchObject({ id: mediaId, url: `/medias/${mediaId}/1600.webp` })
    })
  })

  test.describe('erreurs de validation et de règles métier (HTTP)', () => {
    test.beforeEach(viderLesServices)

    test('CA11 POST with invalid fields answers 400 VALIDATION listing the fields', async () => {
      const reponse = await session.api.post('/api/studio/services', { data: { titre: '', type: 'rdv', tarif: 'payant', dureeMin: 3, prixMontant: 12.5, prixDevise: 'GBP' } })

      const corps = await attendreErreur(reponse, 400, 'VALIDATION')
      expect(Object.keys(corps.data?.champs ?? {}).sort()).toEqual(['dureeMin', 'prixDevise', 'prixMontant', 'titre'])
    })

    test('CA11 POST with an unknown or forbidden key (slug, ordre, vitrineId) answers 400', async () => {
      for (const cle of ['slug', 'ordre', 'vitrineId']) {
        await attendreErreur(await session.api.post('/api/studio/services', { data: { ...CONSULTATION, [cle]: 'x' } }), 400, 'VALIDATION')
      }
      expect((await lister()).services).toHaveLength(0)
    })

    test('CA11 POST that breaks a cross-field rule answers 400 VALIDATION on the targeted field', async () => {
      const casLimites: [Record<string, unknown>, string][] = [
        [{ titre: 'A', type: 'rdv', tarif: 'gratuit' }, 'dureeMin'],
        [{ titre: 'A', type: 'accompagnement', tarif: 'gratuit', dureeMin: 30 }, 'nbSeances'],
        [{ titre: 'A', type: 'devis', tarif: 'payant', prixMontant: 1000, prixDevise: 'XAF' }, 'tarif'],
        [{ titre: 'A', type: 'rdv', tarif: 'payant', dureeMin: 30, prixDevise: 'XAF' }, 'prixMontant'],
        [{ titre: 'A', type: 'rdv', tarif: 'gratuit', dureeMin: 30, actif: false, enVedette: true }, 'enVedette'],
      ]

      for (const [donnees, champ] of casLimites) {
        const corps = await attendreErreur(await session.api.post('/api/studio/services', { data: donnees }), 400, 'VALIDATION')
        expect(Object.keys(corps.data?.champs ?? {}), JSON.stringify(donnees)).toContain(champ)
      }
    })

    test('CA11 a malformed JSON body answers 400, never a 500', async () => {
      const reponse = await session.api.post('/api/studio/services', {
        headers: { 'content-type': 'application/json' },
        data: '{"titre": ',
      })

      expect(reponse.status()).toBe(400)
    })

    test('CA25 PUT with an empty body or a forbidden key answers 400', async () => {
      const { service } = await creer(CONSULTATION)

      await attendreErreur(await session.api.put(`/api/studio/services/${service.id}`, { data: {} }), 400, 'VALIDATION')
      await attendreErreur(await session.api.put(`/api/studio/services/${service.id}`, { data: { slug: 'autre' } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.put(`/api/studio/services/${service.id}`, { data: { ordre: 4 } }), 400, 'VALIDATION')
    })

    test('CA17 PUT that makes the merged state incoherent answers 400 and leaves the service unchanged', async () => {
      const { service } = await creer(CONSULTATION)

      const reponse = await session.api.put(`/api/studio/services/${service.id}`, { data: { type: 'accompagnement' } })

      const corps = await attendreErreur(reponse, 400, 'VALIDATION')
      expect(Object.keys(corps.data?.champs ?? {})).toEqual(['nbSeances'])
      const relu = (await (await session.api.get(`/api/studio/services/${service.id}`)).json()) as ReponseService
      expect(relu.service).toEqual(service)
    })

    test('CA13 POST with au_choix answers 422 PAIEMENT_EN_LIGNE_INDISPONIBLE while online payment is off, and persists nothing', async () => {
      const reponse = await session.api.post('/api/studio/services', { data: { ...CONSULTATION, paiementMode: 'au_choix' } })

      await attendreErreur(reponse, 422, 'PAIEMENT_EN_LIGNE_INDISPONIBLE')
      expect((await lister()).services).toHaveLength(0)
    })

    test('CA14 POST with an image that does not exist answers 422 MEDIA_INVALIDE', async () => {
      const reponse = await session.api.post('/api/studio/services', { data: { ...CONSULTATION, imageMediaId: randomUUID() } })

      await attendreErreur(reponse, 422, 'MEDIA_INVALIDE')
      expect((await lister()).services).toHaveLength(0)
    })

    test('CA08 an explicit fourth vedette answers 409 VEDETTE_COMPLETE with the three current ones in data.enVedette', async () => {
      const crees: ServiceStudio[] = []
      for (const titre of ['S1', 'S2', 'S3']) {
        crees.push((await creer({ titre, type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service)
      }

      const reponse = await session.api.post('/api/studio/services', { data: { titre: 'S4', type: 'rdv', dureeMin: 30, tarif: 'gratuit', enVedette: true } })

      expect(reponse.status()).toBe(409)
      const corps = (await lireErreur(reponse)) as Awaited<ReturnType<typeof lireErreur>> & { data: { enVedette: { id: string, titre: string }[] } }
      expect(corps.data.code).toBe('VEDETTE_COMPLETE')
      expect(corps.data.enVedette).toEqual(crees.map((s) => ({ id: s.id, titre: s.titre })))
      expect(corps.message).toContain('3 services en vedette')
      expect((await lister()).services).toHaveLength(3)
    })

    test('CA19 PUT enVedette true on a fourth service answers 409; once a vedette is withdrawn it answers 200', async () => {
      const [s1, s2, , s4] = [
        (await creer({ titre: 'S1', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service,
        (await creer({ titre: 'S2', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service,
        (await creer({ titre: 'S3', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service,
        (await creer({ titre: 'S4', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service,
      ]
      expect(s4.enVedette).toBe(false)
      expect(s1.enVedette).toBe(true)

      await attendreErreur(await session.api.put(`/api/studio/services/${s4.id}`, { data: { enVedette: true } }), 409, 'VEDETTE_COMPLETE')
      expect((await session.api.put(`/api/studio/services/${s2.id}`, { data: { enVedette: false } })).status()).toBe(200)
      const reponse = await session.api.put(`/api/studio/services/${s4.id}`, { data: { enVedette: true } })

      expect(reponse.status()).toBe(200)
      expect(((await reponse.json()) as ReponseService).compteurs.enVedette).toBe(3)
    })

    test('CA29 reordonner with an incomplete, duplicated or foreign list answers 422 ORDRE_INVALIDE and keeps the order', async () => {
      const a = (await creer({ titre: 'A', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const b = (await creer({ titre: 'B', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service

      await attendreErreur(await session.api.post('/api/studio/services/reordonner', { data: { ids: [b.id] } }), 422, 'ORDRE_INVALIDE')
      await attendreErreur(await session.api.post('/api/studio/services/reordonner', { data: { ids: [a.id, b.id, randomUUID()] } }), 422, 'ORDRE_INVALIDE')
      await attendreErreur(await session.api.post('/api/studio/services/reordonner', { data: { ids: [a.id, a.id] } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.post('/api/studio/services/reordonner', { data: { ids: [] } }), 400, 'VALIDATION')
      expect((await lister()).services.map((s) => s.titre)).toEqual(['A', 'B'])
    })

    test('CA28 reordonner answers 200 with the list in the new order and the counters', async () => {
      const a = (await creer({ titre: 'A', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const b = (await creer({ titre: 'B', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const c = (await creer({ titre: 'C', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service

      const reponse = await session.api.post('/api/studio/services/reordonner', { data: { ids: [c.id, a.id, b.id] } })

      expect(reponse.status()).toBe(200)
      const corps = (await reponse.json()) as ReponseListe
      expect(corps.services.map((s) => [s.titre, s.ordre])).toEqual([['C', 0], ['A', 1], ['B', 2]])
      expect(corps.compteurs).toEqual({ total: 3, visibles: 3, enVedette: 3, vedetteMax: 3 })
    })

    test('CA22 two simultaneous POST of the same title give distinct slugs (bilan, bilan-2)', async () => {
      const donnees = { titre: 'Bilan', type: 'rdv', dureeMin: 30, tarif: 'gratuit' }

      const [r1, r2] = await Promise.all([
        session.api.post('/api/studio/services', { data: donnees }),
        session.api.post('/api/studio/services', { data: donnees }),
      ])

      expect([r1.status(), r2.status()]).toEqual([201, 201])
      const slugs = [r1, r2].map(async (r) => ((await r.json()) as ReponseService).service.slug)
      expect((await Promise.all(slugs)).sort()).toEqual(['bilan', 'bilan-2'])
    })

    test('CA22 two simultaneous vedette updates: exactly one 200 and one 409', async () => {
      await creer({ titre: 'S1', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })
      await creer({ titre: 'S2', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })
      const s3 = (await creer({ titre: 'S3', type: 'rdv', dureeMin: 30, tarif: 'gratuit', enVedette: false })).service
      const s4 = (await creer({ titre: 'S4', type: 'rdv', dureeMin: 30, tarif: 'gratuit', enVedette: false })).service

      const [r3, r4] = await Promise.all([
        session.api.put(`/api/studio/services/${s3.id}`, { data: { enVedette: true } }),
        session.api.put(`/api/studio/services/${s4.id}`, { data: { enVedette: true } }),
      ])

      expect([r3.status(), r4.status()].sort()).toEqual([200, 409])
      expect((await lister()).compteurs.enVedette).toBe(3)
    })
  })

  test.describe('isolation entre utilisateurs (CA24)', () => {
    test('CA24 another user gets 404 SERVICE_INTROUVABLE (never 403) on read, update and delete of a service of the first user', async ({ playwright }) => {
      await viderLesServices()
      const { service } = await creer(CONSULTATION)
      const autre = await seConnecter(playwright)
      try {
        const creation = await autre.api.post('/api/studio/vitrine', {
          data: { titre: null, prenom: 'Autre', nom: 'Utilisateur', metier: 'Médecin', username: `autre-${randomUUID().slice(0, 8)}` },
        })
        expect(creation.status()).toBe(201)

        await attendreErreur(await autre.api.get(`/api/studio/services/${service.id}`), 404, 'SERVICE_INTROUVABLE')
        await attendreErreur(await autre.api.put(`/api/studio/services/${service.id}`, { data: { titre: 'Piraté' } }), 404, 'SERVICE_INTROUVABLE')
        await attendreErreur(await autre.api.delete(`/api/studio/services/${service.id}`), 404, 'SERVICE_INTROUVABLE')
        const liste = (await (await autre.api.get('/api/studio/services')).json()) as ReponseListe
        expect(liste.services).toEqual([])
      } finally {
        await autre.api.dispose()
      }

      const intact = (await (await session.api.get(`/api/studio/services/${service.id}`)).json()) as ReponseService
      expect(intact.service).toEqual(service)
    })
  })

  test.describe('lecture publique et parcours (CA41, CA42)', () => {
    test.beforeEach(viderLesServices)

    test('CA42 GET /api/public/services answers 404 VITRINE_INTROUVABLE (the old route is gone; "services" is a reserved word)', async ({ request }) => {
      await attendreErreur(await request.get('/api/public/services'), 404, 'VITRINE_INTROUVABLE')
    })

    test('CA42 GET /api/public/:username is still served for a normal username (no shadowing by services)', async ({ request }) => {
      const reponse = await request.get(`/api/public/${username}`)

      expect(reponse.status()).toBe(200)
    })

    test('CA34 the public list of an unknown vitrine answers 404 VITRINE_INTROUVABLE, and an empty published vitrine answers 200 with empty lists', async ({ request }) => {
      await attendreErreur(await request.get('/api/public/inconnu-sans-vitrine/services'), 404, 'VITRINE_INTROUVABLE')
      await attendreErreur(await request.get('/api/public/Bad_Name/services'), 404, 'VITRINE_INTROUVABLE')

      const vide = await request.get(`/api/public/${username}/services`)

      expect(vide.status()).toBe(200)
      expect(await vide.json()).toEqual({ total: 0, aLaUne: [], services: [] })
    })

    test('CA41 parcours: 4 creations, aLaUne 3, hide S1 (detail 404), reorder, the public order follows', async ({ request }) => {
      const s1 = (await creer({ titre: 'S1', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const s2 = (await creer({ titre: 'S2', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const s3 = (await creer({ titre: 'S3', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service
      const s4 = (await creer({ titre: 'S4', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })).service

      const publics = (await (await request.get(`/api/public/${username}/services`)).json()) as ReponsePublicListe
      expect(publics.total).toBe(4)
      expect(publics.aLaUne.map((s) => s.titre)).toEqual(['S1', 'S2', 'S3'])
      expect(publics.services.map((s) => s.titre)).toEqual(['S1', 'S2', 'S3', 'S4'])
      expect((await request.get(`/api/public/${username}/services/s1`)).status()).toBe(200)

      expect((await session.api.put(`/api/studio/services/${s1.id}`, { data: { actif: false } })).status()).toBe(200)

      await attendreErreur(await request.get(`/api/public/${username}/services/s1`), 404, 'SERVICE_INTROUVABLE')
      const apresMasquage = (await (await request.get(`/api/public/${username}/services`)).json()) as ReponsePublicListe
      expect(apresMasquage.total).toBe(3)
      expect(apresMasquage.services.map((s) => s.titre)).toEqual(['S2', 'S3', 'S4'])
      expect(apresMasquage.aLaUne.map((s) => s.titre)).toEqual(['S2', 'S3'])

      const reordonne = await session.api.post('/api/studio/services/reordonner', { data: { ids: [s4.id, s3.id, s2.id, s1.id] } })
      expect(reordonne.status()).toBe(200)

      const apresOrdre = (await (await request.get(`/api/public/${username}/services`)).json()) as ReponsePublicListe
      expect(apresOrdre.services.map((s) => s.titre)).toEqual(['S4', 'S3', 'S2'])
      expect(apresOrdre.aLaUne.map((s) => s.titre)).toEqual(['S3', 'S2'])
    })

    test('CA35 the public detail answers the service, at most two others and the total; slug case is ignored', async ({ request }) => {
      await creer(CONSULTATION)
      await creer({ titre: 'Bilan', type: 'rdv', dureeMin: 60, tarif: 'gratuit' })
      await creer({ titre: 'Suivi', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })
      await creer({ titre: 'Écho', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })

      const reponse = await request.get(`/api/public/${username}/services/CONSULTATION-DE-CARDIOLOGIE`)

      expect(reponse.status()).toBe(200)
      const detail = (await reponse.json()) as ReponsePublicDetail
      expect(detail.service.slug).toBe('consultation-de-cardiologie')
      expect(detail.autres.map((s) => s.titre)).toEqual(['Bilan', 'Suivi'])
      expect(detail.total).toBe(4)
    })

    test('CA36 the public DTOs expose exactly the whitelisted keys and never an identifier', async ({ request }) => {
      const { service } = await creer({ ...CONSULTATION, paiementInstructions: 'Espèces.', inclus: ['Examen clinique'] })

      const liste = (await (await request.get(`/api/public/${username}/services`)).json()) as ReponsePublicListe
      const detailBrut = await (await request.get(`/api/public/${username}/services/${service.slug}`)).text()
      const detail = JSON.parse(detailBrut) as ReponsePublicDetail

      expect(Object.keys(liste.services[0]).sort()).toEqual(CLES_CARTE_PUBLIQUE)
      expect(Object.keys(liste.aLaUne[0]).sort()).toEqual(CLES_CARTE_PUBLIQUE)
      expect(Object.keys(detail.service).sort()).toEqual(CLES_DETAIL_PUBLIC)
      expect(Object.keys(detail.service.seo).sort()).toEqual(['description', 'titre'])
      expect(detail.service.paiementMode).toBe('sur_place')
      expect(detail.service.seo.titre).toBe('Consultation de cardiologie — Dr Cabrel Nguesso')
      for (const secret of [service.id, '"ordre"', '"enVedette"', '"actif"', '"vitrineId"', '"creeLe"', '"modifieLe"', '"imageMediaId"']) {
        expect(detailBrut).not.toContain(secret)
      }
    })

    test('CA35 an unknown, masked or malformed slug answers 404 SERVICE_INTROUVABLE', async ({ request }) => {
      const { service } = await creer({ titre: 'Masqué bientôt', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })
      expect((await session.api.put(`/api/studio/services/${service.id}`, { data: { actif: false } })).status()).toBe(200)

      for (const slug of ['inconnu', service.slug, 'bad_slug!', 'a'.repeat(200)]) {
        await attendreErreur(await request.get(`/api/public/${username}/services/${encodeURIComponent(slug)}`), 404, 'SERVICE_INTROUVABLE')
      }
    })

    test('CA34 once the vitrine is unpublished the public routes answer 404 VITRINE_INTROUVABLE; republished they answer again', async ({ request }) => {
      await creer(CONSULTATION)
      expect((await session.api.post('/api/studio/vitrine/depublier')).status()).toBe(200)

      await attendreErreur(await request.get(`/api/public/${username}/services`), 404, 'VITRINE_INTROUVABLE')
      await attendreErreur(await request.get(`/api/public/${username}/services/consultation-de-cardiologie`), 404, 'VITRINE_INTROUVABLE')

      expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
      expect((await request.get(`/api/public/${username}/services`)).status()).toBe(200)
    })
  })
})
