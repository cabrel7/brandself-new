import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import { attendreErreur, fermerConnexions, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// CA13 (vitrine publique : liste blanche, aucune fuite) et CA33 (404 uniforme, message intact).

const CLES_DTO_PUBLIC = [
  'accroche', 'badgeBrandself', 'bio', 'contact', 'fuseau', 'metier', 'modifieLe', 'nom', 'nomAffiche', 'palette', 'pays',
  'paysLibelle', 'photo', 'prenom', 'seo', 'titre', 'username', 'ville',
].sort()

test.describe('CA33 GET /api/public/:username — vitrine introuvable', () => {
  test('CA33 un username inconnu répond 404 VITRINE_INTROUVABLE avec un message français intact', async ({ request }) => {
    const reponse = await request.get('/api/public/inconnu-sans-vitrine')

    const corps = await attendreErreur(reponse, 404, 'VITRINE_INTROUVABLE')
    // Le texte français complet vit dans `message` ; `statusMessage` (ASCII) ne sert qu'à h3.
    expect(corps.message).toMatch(/[A-Za-zÀ-ÿ]{3,}/)
    expect(corps.message).not.toContain('\uFFFD')
  })

  for (const saisie of ['Bad_Name', 'a', 'x'.repeat(200), 'studio', 'medias']) {
    test(`CA33 ${JSON.stringify(saisie.slice(0, 20))} (format invalide ou mot réservé) répond 404 VITRINE_INTROUVABLE`, async ({ request }) => {
      const reponse = await request.get(`/api/public/${encodeURIComponent(saisie)}`)

      await attendreErreur(reponse, 404, 'VITRINE_INTROUVABLE')
    })
  }

  test('CA33 la réponse 404 ne divulgue ni trace d’erreur ni détail SQL', async ({ request }) => {
    const reponse = await request.get('/api/public/inconnu-sans-vitrine')

    const texte = await reponse.text()
    expect(texte).not.toMatch(/select |from "vitrines"|drizzle|node_modules|at .*\.ts:\d+/i)
  })
})

test.describe.serial('CA13 vitrine publiée', () => {
  let session: Session
  let username: string
  let photoId: string
  const EMAIL_CONTACT = 'contact-public@cabinet.cm'

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    username = `pub-${randomUUID().slice(0, 8)}`
    const racine = session.api
    const creation = await racine.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    const png = await makePng(300, 200)
    const televersement = await racine.post('/api/studio/medias', {
      multipart: { fichier: { name: 'portrait.png', mimeType: 'image/png', buffer: png } },
    })
    expect(televersement.status()).toBe(201)
    photoId = ((await televersement.json()) as { media: { id: string } }).media.id
    const miseAJour = await racine.put('/api/studio/vitrine', {
      data: { ville: 'Douala', pays: 'CM', photoMediaId: photoId, emailContact: EMAIL_CONTACT },
    })
    expect(miseAJour.status()).toBe(200)
    expect((await racine.post('/api/studio/vitrine/publier')).status()).toBe(200)
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await fermerConnexions()
  })

  test('CA13 le DTO public contient exactement les clés de la liste blanche', async ({ request }) => {
    const reponse = await request.get(`/api/public/${username}`)

    expect(reponse.status()).toBe(200)
    const { vitrine } = (await reponse.json()) as { vitrine: Record<string, unknown> }
    expect(Object.keys(vitrine).sort()).toEqual(CLES_DTO_PUBLIC)
    expect(vitrine).toMatchObject({
      username,
      nomAffiche: 'Dr Cabrel Nguesso',
      ville: 'Douala',
      pays: 'CM',
      paysLibelle: 'Cameroun',
      contact: { email: EMAIL_CONTACT, telephone: null, whatsapp: null },
      seo: { titre: 'Dr Cabrel Nguesso — Cardiologue à Douala', description: 'Dr Cabrel Nguesso, Cardiologue à Douala (Cameroun).' },
    })
  })

  test('CA13 la photo est servie par son URL publique 1600', async ({ request }) => {
    const { vitrine } = (await (await request.get(`/api/public/${username}`)).json()) as { vitrine: { photo: { id: string, url: string } } }

    expect(vitrine.photo.id).toBe(photoId)
    expect(vitrine.photo.url).toBe(`/medias/${photoId}/1600.webp`)
    const image = await request.get(vitrine.photo.url)
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toContain('image/webp')
  })

  test('CA13 aucune donnée privée ne fuit (email du compte, identifiants, chemin disque)', async ({ request }) => {
    const reponse = await request.get(`/api/public/${username}`)

    const texte = await reponse.text()
    for (const secret of [session.email, session.userId, session.sessionId, `${session.userId}/${photoId}`, 'userId', 'chemin', 'disk', 'sectionsMasquees', 'preavisHeures', 'password', 'token']) {
      expect(texte, `la réponse ne doit pas contenir « ${secret} »`).not.toContain(secret)
    }
  })

  test('CA13 le username est normalisé (la casse et les espaces ne changent pas la vitrine)', async ({ request }) => {
    const reponse = await request.get(`/api/public/${encodeURIComponent(`  ${username.toUpperCase()} `)}`)

    expect(reponse.status()).toBe(200)
    expect(((await reponse.json()) as { vitrine: { username: string } }).vitrine.username).toBe(username)
  })

  test('CA13 une vitrine dépubliée répond 404 VITRINE_INTROUVABLE', async ({ request }) => {
    const depublication = await session.api.post('/api/studio/vitrine/depublier')
    expect(depublication.status()).toBe(200)

    const reponse = await request.get(`/api/public/${username}`)

    await attendreErreur(reponse, 404, 'VITRINE_INTROUVABLE')
  })
})
