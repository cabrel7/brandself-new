import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { MEDIA_FORM_FIELD, MEDIA_MAX_BYTES } from '../../shared/medias'
import { makeJpegWithGarbage, makeMzBytes, makePng } from '../../tests/support/images'
import { BASE_URL, attendreErreur, fermerConnexions, lireErreur, requeteBrute, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// CA21 (taille : Content-Length vérifié avant lecture), CA25 (service HTTP des variantes),
// CA34 (la route DELETE existe), plus le contrat d'erreurs de l'upload et la limite CA26.

const MEGA_OCTET = 1024 * 1024
const TAILLE_ANNONCEE_TROP_GRANDE = 12 * MEGA_OCTET
const CACHE_IMMUABLE = 'public, max-age=31536000, immutable'

function multipart(nom: string, mimeType: string, buffer: Buffer) {
  return { [MEDIA_FORM_FIELD]: { name: nom, mimeType, buffer } }
}

test.describe.serial('médias (HTTP)', () => {
  let session: Session
  let mediaId: string

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await fermerConnexions()
  })

  test('CA34 DELETE /api/studio/medias/<uuid aléatoire> répond 404 MEDIA_INTROUVABLE (la route existe)', async () => {
    const reponse = await session.api.delete(`/api/studio/medias/${randomUUID()}`)

    await attendreErreur(reponse, 404, 'MEDIA_INTROUVABLE')
  })

  test('CA34 un identifiant qui n’est pas un uuid est refusé proprement (400 ou 404, jamais 500)', async () => {
    const reponse = await session.api.delete('/api/studio/medias/pas-un-uuid')

    expect([400, 404]).toContain(reponse.status())
  })

  test('should upload a PNG and answer 201 with the MediaDTO', async () => {
    const reponse = await session.api.post('/api/studio/medias', { multipart: multipart('portrait.png', 'image/png', await makePng(2000, 1000)) })

    expect(reponse.status()).toBe(201)
    const { media } = (await reponse.json()) as { media: Record<string, unknown> }
    expect(Object.keys(media).sort()).toEqual(['hauteur', 'id', 'largeur', 'srcset', 'url'])
    mediaId = media.id as string
    expect(media).toMatchObject({ url: `/medias/${mediaId}/1600.webp`, largeur: 1600, hauteur: 800 })
    expect(media.srcset).toBe(`/medias/${mediaId}/400.webp 400w, /medias/${mediaId}/800.webp 800w, /medias/${mediaId}/1600.webp 1600w`)
  })

  test('CA25 GET /medias/:id/800.webp is public and answers 200 with the immutable cache headers', async ({ request }) => {
    const reponse = await request.get(`/medias/${mediaId}/800.webp`)

    expect(reponse.status()).toBe(200)
    expect(reponse.headers()['content-type']).toContain('image/webp')
    expect(reponse.headers()['cache-control']).toBe(CACHE_IMMUABLE)
    expect(reponse.headers()['x-content-type-options']).toBe('nosniff')
    expect(reponse.headers().etag).toBe(`"${mediaId}-800"`)
    const meta = await sharp(await reponse.body()).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 800 })
  })

  test('CA25 GET with If-None-Match answers 304 without a body', async ({ request }) => {
    const reponse = await request.get(`/medias/${mediaId}/800.webp`, { headers: { 'If-None-Match': `"${mediaId}-800"` } })

    expect(reponse.status()).toBe(304)
    expect((await reponse.body()).length).toBe(0)
  })

  test('CA25 an ETag of another variant does not validate the cache', async ({ request }) => {
    const reponse = await request.get(`/medias/${mediaId}/800.webp`, { headers: { 'If-None-Match': `"${mediaId}-400"` } })

    expect(reponse.status()).toBe(200)
  })

  for (const [libelle, chemin] of [
    ['une largeur non publiée (500)', (id: string) => `/medias/${id}/500.webp`],
    ['une extension différente', (id: string) => `/medias/${id}/800.png`],
    ['un identifiant inconnu', () => `/medias/${randomUUID()}/800.webp`],
    ['un identifiant qui n’est pas un uuid', () => '/medias/pas-un-uuid/800.webp'],
    ['une tentative de traversée de dossier', () => '/medias/..%2f..%2fetc%2fpasswd/800.webp'],
  ] as const) {
    test(`CA25 ${libelle} répond 404`, async ({ request }) => {
      const reponse = await request.get(chemin(mediaId))

      expect(reponse.status()).toBe(404)
    })
  }

  test('CA25 after deletion the variant answers 404 and the DELETE answers 204', async ({ request }) => {
    const suppression = await session.api.delete(`/api/studio/medias/${mediaId}`)
    expect(suppression.status()).toBe(204)

    const reponse = await request.get(`/medias/${mediaId}/800.webp`)

    expect(reponse.status()).toBe(404)
    await attendreErreur(await session.api.delete(`/api/studio/medias/${mediaId}`), 404, 'MEDIA_INTROUVABLE')
  })

  test('CA21 a Content-Length of 12 MiB is refused with 413 BEFORE the body is read', async () => {
    const reponse = await requeteBrute({
      method: 'POST',
      path: '/api/studio/medias',
      headers: { cookie: session.cookie, origin: BASE_URL, 'content-type': 'multipart/form-data; boundary=limite', 'content-length': String(TAILLE_ANNONCEE_TROP_GRANDE) },
      corps: null,
    })

    expect(reponse.status).toBe(413)
    expect(JSON.parse(reponse.corps)).toMatchObject({ data: { code: 'FICHIER_TROP_LOURD' } })
  })

  test('CA21 a request without Content-Length (chunked) is refused with 411 TAILLE_REQUISE', async () => {
    const reponse = await requeteBrute({
      method: 'POST',
      path: '/api/studio/medias',
      headers: { cookie: session.cookie, origin: BASE_URL, 'content-type': 'multipart/form-data; boundary=limite', 'transfer-encoding': 'chunked' },
      corps: Buffer.from('--limite--\r\n'),
    })

    expect(reponse.status).toBe(411)
    expect(JSON.parse(reponse.corps)).toMatchObject({ data: { code: 'TAILLE_REQUISE' } })
  })

  test('CA21 a file of MEDIA_MAX_BYTES + 1 sent with an honest Content-Length is refused with 413', async () => {
    const trop = Buffer.alloc(MEDIA_MAX_BYTES + 1)
    trop.set([0xff, 0xd8, 0xff])

    const reponse = await session.api.post('/api/studio/medias', { multipart: multipart('lourd.jpg', 'image/jpeg', trop) })

    await attendreErreur(reponse, 413, 'FICHIER_TROP_LOURD')
  })

  test('CA20 an executable renamed .jpg is refused with 415 TYPE_NON_SUPPORTE', async () => {
    const reponse = await session.api.post('/api/studio/medias', { multipart: multipart('faux.jpg', 'image/jpeg', makeMzBytes()) })

    await attendreErreur(reponse, 415, 'TYPE_NON_SUPPORTE')
  })

  test('CA22 a JPEG signature followed by garbage is refused with 422 IMAGE_ILLISIBLE', async () => {
    const reponse = await session.api.post('/api/studio/medias', { multipart: multipart('casse.jpg', 'image/jpeg', makeJpegWithGarbage()) })

    await attendreErreur(reponse, 422, 'IMAGE_ILLISIBLE')
  })

  test('a multipart request without the "fichier" part is refused with 400 FICHIER_MANQUANT', async () => {
    const reponse = await session.api.post('/api/studio/medias', { multipart: { autre: 'valeur' } })

    await attendreErreur(reponse, 400, 'FICHIER_MANQUANT')
  })

  test('a non-multipart body is refused with a 4xx error (never a 500)', async () => {
    const reponse = await session.api.post('/api/studio/medias', { data: { fichier: 'pas un fichier' } })

    expect(reponse.status()).toBeGreaterThanOrEqual(400)
    expect(reponse.status()).toBeLessThan(500)
  })

  test('CA26 uploads are limited per user: a 429 with Retry-After arrives within 40 attempts', async () => {
    const png = await makePng(40, 40)
    const TENTATIVES_MAX = 40
    let refus: Awaited<ReturnType<typeof session.api.post>> | undefined

    for (let i = 0; i < TENTATIVES_MAX && !refus; i += 1) {
      const reponse = await session.api.post('/api/studio/medias', { multipart: multipart(`p${i}.png`, 'image/png', png) })
      if (reponse.status() === 429) refus = reponse
      else expect(reponse.status()).toBe(201)
    }

    expect(refus, 'aucun 429 reçu après 40 envois').toBeDefined()
    if (!refus) return
    const corps = await lireErreur(refus)
    expect(corps.data).toMatchObject({ code: 'TROP_DE_REQUETES' })
    expect(corps.data?.retryAfter).toBeGreaterThan(0)
    expect(Number(refus.headers()['retry-after'])).toBeGreaterThan(0)
  })
})
