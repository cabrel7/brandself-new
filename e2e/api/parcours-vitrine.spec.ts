import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import { attendreErreur, fermerConnexions, lireErreur, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// CA35 — parcours complet : POST vitrine -> upload -> PUT -> publier -> GET public -> GET photo
// -> dépublier -> 404 ; CA36 — /studio et /onboarding ne sont pas rendus côté serveur (ssr:false).
// Plus les contrats d'erreur de la création (VALIDATION, VITRINE_EXISTE) et la limite CA15.

interface VitrineStudio {
  username: string
  titre: string | null
  nomAffiche: string
  ville: string | null
  pays: string | null
  accroche: string | null
  photo: { id: string, url: string } | null
  publiee: boolean
  publieeLe: string | null
}

interface Resume {
  compteurs: { services: number, realisations: number, temoignages: number, liens: number }
  prochaineEtape: string | null
  manquantsPourPublier: string[]
  statistiques7j: { visites: number, clics: number, reservations: number }
}

test.describe.serial('parcours d’une vitrine (CA35)', () => {
  let session: Session
  let username: string
  let photoId: string
  let premierePublication: string | null

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    username = `parcours-${randomUUID().slice(0, 8)}`
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await fermerConnexions()
  })

  test('CA35 GET /api/studio/vitrine before creation answers 404 VITRINE_INTROUVABLE', async () => {
    await attendreErreur(await session.api.get('/api/studio/vitrine'), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA35 POST with invalid data answers 400 VALIDATION listing the fields', async () => {
    const reponse = await session.api.post('/api/studio/vitrine', { data: { prenom: '', nom: 'Nguesso', metier: 'Cardiologue', username: 'Bad_Name' } })

    const corps = await attendreErreur(reponse, 400, 'VALIDATION')
    expect(Object.keys(corps.data?.champs ?? {}).sort()).toEqual(['prenom', 'username'])
  })

  test('CA35 POST with an unknown key (mass-assignment attempt) answers 400', async () => {
    const reponse = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username, userId: 'autre', publieeLe: '2020-01-01T00:00:00Z' },
    })

    await attendreErreur(reponse, 400, 'VALIDATION')
  })

  test('CA35 POST creates the vitrine (201) with its summary', async () => {
    const reponse = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })

    expect(reponse.status()).toBe(201)
    const { vitrine, resume } = (await reponse.json()) as { vitrine: VitrineStudio, resume: Resume }
    expect(vitrine).toMatchObject({ username, titre: 'dr', nomAffiche: 'Dr Cabrel Nguesso', ville: null, pays: null, photo: null, publiee: false, publieeLe: null })
    expect(resume).toMatchObject({
      compteurs: { services: 0, realisations: 0, temoignages: 0, liens: 0 },
      prochaineEtape: 'photo',
      manquantsPourPublier: ['ville', 'pays'],
      statistiques7j: { visites: 0, clics: 0, reservations: 0 },
    })
  })

  test('CA35 a second POST answers 409 VITRINE_EXISTE', async () => {
    const reponse = await session.api.post('/api/studio/vitrine', {
      data: { titre: null, prenom: 'Autre', nom: 'Nom', metier: 'Métier', username: `${username}-bis` },
    })

    await attendreErreur(reponse, 409, 'VITRINE_EXISTE')
  })

  test('CA35 publishing an incomplete vitrine answers 422 PUBLICATION_INCOMPLETE with the missing fields', async () => {
    const reponse = await session.api.post('/api/studio/vitrine/publier')

    const corps = await attendreErreur(reponse, 422, 'PUBLICATION_INCOMPLETE')
    expect(corps.data?.manquants).toEqual(['ville', 'pays'])
  })

  test('CA35 the vitrine is not public while unpublished', async ({ request }) => {
    await attendreErreur(await request.get(`/api/public/${username}`), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA35 POST /api/studio/medias uploads the photo (201)', async () => {
    const reponse = await session.api.post('/api/studio/medias', {
      multipart: { fichier: { name: 'portrait.png', mimeType: 'image/png', buffer: await makePng(800, 600) } },
    })

    expect(reponse.status()).toBe(201)
    photoId = ((await reponse.json()) as { media: { id: string } }).media.id
  })

  test('CA35 PUT with a photo that does not exist answers 422 MEDIA_INVALIDE', async () => {
    const reponse = await session.api.put('/api/studio/vitrine', { data: { photoMediaId: randomUUID() } })

    await attendreErreur(reponse, 422, 'MEDIA_INVALIDE')
  })

  test('CA35 PUT with an empty body or a forbidden key answers 400', async () => {
    await attendreErreur(await session.api.put('/api/studio/vitrine', { data: {} }), 400, 'VALIDATION')
    await attendreErreur(await session.api.put('/api/studio/vitrine', { data: { username: 'autre-nom', ville: 'Douala' } }), 400, 'VALIDATION')
  })

  test('CA35 PUT completes the vitrine and turns "" into null', async () => {
    const reponse = await session.api.put('/api/studio/vitrine', {
      data: { ville: 'Douala', pays: 'CM', photoMediaId: photoId, accroche: '' },
    })

    expect(reponse.status()).toBe(200)
    // Le corps de la réponse du PUT n'est pas fixé par la spec : on relit la vitrine.
    const relue = await session.api.get('/api/studio/vitrine')
    const { vitrine, resume } = (await relue.json()) as { vitrine: VitrineStudio, resume: Resume }
    expect(vitrine).toMatchObject({ ville: 'Douala', pays: 'CM', accroche: null, titre: 'dr' })
    expect(vitrine.photo).toMatchObject({ id: photoId, url: `/medias/${photoId}/1600.webp` })
    expect(resume).toMatchObject({ prochaineEtape: 'service', manquantsPourPublier: [] })
  })

  test('CA35 username availability answers actuel / reserve / format / libre', async () => {
    const lire = async (valeur: string) =>
      (await (await session.api.get(`/api/studio/username-disponible?username=${encodeURIComponent(valeur)}`)).json()) as { username: string, disponible: boolean, raison: string }

    expect(await lire(username)).toMatchObject({ username, raison: 'actuel' })
    expect(await lire('admin')).toMatchObject({ disponible: false, raison: 'reserve' })
    expect(await lire('Bad_Name')).toMatchObject({ disponible: false, raison: 'format' })
    expect(await lire(`libre-${randomUUID().slice(0, 8)}`)).toMatchObject({ disponible: true, raison: 'libre' })
  })

  test('CA35 PUT /api/studio/vitrine/username refuses a reserved word (400) and accepts a free one', async () => {
    await attendreErreur(await session.api.put('/api/studio/vitrine/username', { data: { username: 'medias' } }), 400, 'VALIDATION')

    const nouveau = `${username}-v2`
    const reponse = await session.api.put('/api/studio/vitrine/username', { data: { username: nouveau } })

    expect(reponse.status()).toBe(200)
    username = nouveau
  })

  test('CA35 publishing succeeds (200) and is idempotent: publieeLe does not move', async () => {
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    premierePublication = ((await (await session.api.get('/api/studio/vitrine')).json()) as { vitrine: VitrineStudio }).vitrine.publieeLe
    expect(premierePublication).not.toBeNull()

    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)

    const apres = ((await (await session.api.get('/api/studio/vitrine')).json()) as { vitrine: VitrineStudio }).vitrine
    expect(apres.publieeLe).toBe(premierePublication)
    expect(apres.publiee).toBe(true)
  })

  test('CA35 GET /api/public/:username answers 200 with the computed seo and the photo', async ({ request }) => {
    const reponse = await request.get(`/api/public/${username}`)

    expect(reponse.status()).toBe(200)
    const { vitrine } = (await reponse.json()) as { vitrine: { seo: { titre: string }, photo: { url: string } } }
    expect(vitrine.seo.titre).toBe('Dr Cabrel Nguesso — Cardiologue à Douala')
    expect(vitrine.photo.url).toBe(`/medias/${photoId}/1600.webp`)
  })

  test('CA35 the photo is served publicly as image/webp', async ({ request }) => {
    const reponse = await request.get(`/medias/${photoId}/1600.webp`)

    expect(reponse.status()).toBe(200)
    expect(reponse.headers()['content-type']).toContain('image/webp')
  })

  test('CA35 the previous username no longer resolves after the change', async ({ request }) => {
    await attendreErreur(await request.get(`/api/public/${username.replace(/-v2$/, '')}`), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA35 unpublishing answers 200 and the public URL answers 404', async ({ request }) => {
    expect((await session.api.post('/api/studio/vitrine/depublier')).status()).toBe(200)

    await attendreErreur(await request.get(`/api/public/${username}`), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA36 /studio and /onboarding are not rendered on the server (ssr:false)', async () => {
    for (const chemin of ['/studio', '/onboarding']) {
      const reponse = await session.api.get(chemin)

      expect(reponse.status(), chemin).toBe(200)
      const html = await reponse.text()
      expect(html, `${chemin} doit être servi en mode SPA`).toContain('data-ssr="false"')
      expect(html, `${chemin} ne doit pas être rendu côté serveur`).not.toContain('data-ssr="true"')
      expect(html).not.toMatch(/<h1[\s>]/)
    }
  })

  test('CA15 username availability is rate limited: a 429 with Retry-After arrives within 40 calls', async () => {
    const TENTATIVES_MAX = 40
    let refus: Awaited<ReturnType<typeof session.api.get>> | undefined

    for (let i = 0; i < TENTATIVES_MAX && !refus; i += 1) {
      const reponse = await session.api.get('/api/studio/username-disponible?username=libre-nom')
      if (reponse.status() === 429) refus = reponse
      else expect(reponse.status()).toBe(200)
    }

    expect(refus, 'aucun 429 reçu après 40 appels').toBeDefined()
    if (!refus) return
    expect((await lireErreur(refus)).data).toMatchObject({ code: 'TROP_DE_REQUETES' })
    expect(Number(refus.headers()['retry-after'])).toBeGreaterThan(0)
  })
})
