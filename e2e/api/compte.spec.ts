import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ACCOUNT_DELETION_PHRASE } from '../../shared/compte'
import { makePng } from '../../tests/support/images'
import { attendreErreur, db, fermerConnexions, libererLimiteurOtp, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// CA30 (appareils : révocation, le contexte révoqué reçoit 401) et CA31 (suppression du compte).
// Deux connexions pour le MÊME compte (deux appareils) : le garde « 1 envoi / 60 s / identifiant »
// est levé explicitement entre les deux (libererLimiteurOtp). Total : 2 envois OTP pour ce fichier.

interface Appareil {
  id: string
  userAgent: string | null
  creeLe: string
  derniereActivite: string
  expireLe: string
  actuel: boolean
}

test.describe.serial('compte : profil, appareils et suppression', () => {
  let appareilA: Session
  let appareilB: Session
  let username: string
  let mediaId: string

  test.beforeAll(async ({ playwright }) => {
    appareilA = await seConnecter(playwright)
    await libererLimiteurOtp(appareilA.email)
    appareilB = await seConnecter(playwright, appareilA.email)
    username = `compte-${randomUUID().slice(0, 8)}`
  })

  test.afterAll(async () => {
    await appareilA.api.dispose()
    await appareilB.api.dispose()
    await fermerConnexions()
  })

  test('CA27 GET /api/studio/moi answers { moi } with the real email and no vitrine yet', async () => {
    const reponse = await appareilA.api.get('/api/studio/moi')

    expect(reponse.status()).toBe(200)
    const { moi } = (await reponse.json()) as { moi: Record<string, unknown> }
    expect(moi).toMatchObject({ id: appareilA.userId, email: appareilA.email, locale: 'fr', aUneVitrine: false, vitrine: null })
    expect(Object.keys(moi).sort()).toEqual(['aUneVitrine', 'devise', 'email', 'fuseau', 'id', 'locale', 'telephone', 'vitrine'])
  })

  test('CA28 PUT /api/studio/moi refuses an unknown timezone, an unknown devise and an empty body (400)', async () => {
    for (const corps of [{ fuseau: 'Mars/Olympus' }, { devise: 'GBP' }, {}]) {
      await attendreErreur(await appareilA.api.put('/api/studio/moi', { data: corps }), 400, 'VALIDATION')
    }
  })

  test('CA28 PUT /api/studio/moi updates the timezone and keeps the other settings', async () => {
    const reponse = await appareilA.api.put('/api/studio/moi', { data: { fuseau: 'Europe/Paris' } })

    expect(reponse.status()).toBe(200)
    expect(((await reponse.json()) as { moi: Record<string, unknown> }).moi).toMatchObject({ fuseau: 'Europe/Paris', locale: 'fr', devise: 'XAF' })
  })

  test('CA29 GET /api/studio/appareils lists both sessions, flags the current one and never exposes a token', async () => {
    const reponse = await appareilA.api.get('/api/studio/appareils')

    expect(reponse.status()).toBe(200)
    const texte = await reponse.text()
    expect(texte).not.toMatch(/token/i)
    const { appareils } = JSON.parse(texte) as { appareils: Appareil[] }
    expect(appareils.length).toBeGreaterThanOrEqual(2)
    expect(appareils.filter((a) => a.actuel).map((a) => a.id)).toEqual([appareilA.sessionId])
    expect(appareils.map((a) => a.id)).toContain(appareilB.sessionId)
    const activites = appareils.map((a) => Date.parse(a.derniereActivite))
    expect(activites).toEqual([...activites].sort((x, y) => y - x))
  })

  test('CA30 revoking the current session answers 422 SESSION_ACTUELLE', async () => {
    await attendreErreur(await appareilA.api.delete(`/api/studio/appareils/${appareilA.sessionId}`), 422, 'SESSION_ACTUELLE')
  })

  test('CA30 revoking an unknown device answers 404 APPAREIL_INTROUVABLE', async () => {
    await attendreErreur(await appareilA.api.delete(`/api/studio/appareils/${randomUUID()}`), 404, 'APPAREIL_INTROUVABLE')
  })

  test('CA30 revoking the other device answers 204 and that context then receives 401', async () => {
    expect((await appareilB.api.get('/api/studio/moi')).status()).toBe(200)

    const revocation = await appareilA.api.delete(`/api/studio/appareils/${appareilB.sessionId}`)

    expect(revocation.status()).toBe(204)
    expect((await appareilB.api.get('/api/studio/moi')).status()).toBe(401)
    expect((await appareilA.api.get('/api/studio/moi')).status()).toBe(200)
    await attendreErreur(await appareilA.api.delete(`/api/studio/appareils/${appareilB.sessionId}`), 404, 'APPAREIL_INTROUVABLE')
  })

  test('CA31 prepares a published vitrine with a photo', async () => {
    const creation = await appareilA.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    const televersement = await appareilA.api.post('/api/studio/medias', {
      multipart: { fichier: { name: 'photo.png', mimeType: 'image/png', buffer: await makePng(300, 200) } },
    })
    expect(televersement.status()).toBe(201)
    mediaId = ((await televersement.json()) as { media: { id: string } }).media.id
    expect((await appareilA.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM', photoMediaId: mediaId } })).status()).toBe(200)
    expect((await appareilA.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    expect((await appareilA.api.get(`/api/public/${username}`)).status()).toBe(200)
    expect((await appareilA.api.get(`/medias/${mediaId}/800.webp`)).status()).toBe(200)
  })

  test('CA31 a wrong confirmation phrase answers 400 CONFIRMATION_INVALIDE and deletes nothing', async () => {
    const reponse = await appareilA.api.delete('/api/studio/moi', { data: { confirmation: 'oui' } })

    await attendreErreur(reponse, 400, 'CONFIRMATION_INVALIDE')
    expect((await appareilA.api.get('/api/studio/moi')).status()).toBe(200)
  })

  test('CA31 a session older than 24 h answers 403 SESSION_TROP_ANCIENNE and deletes nothing', async () => {
    await db().query("UPDATE sessions SET created_at = now() - interval '25 hours' WHERE id = $1", [appareilA.sessionId])

    const reponse = await appareilA.api.delete('/api/studio/moi', { data: { confirmation: ACCOUNT_DELETION_PHRASE } })

    await attendreErreur(reponse, 403, 'SESSION_TROP_ANCIENNE')
    expect((await appareilA.api.get('/api/studio/moi')).status()).toBe(200)
    expect((await appareilA.api.get(`/api/public/${username}`)).status()).toBe(200)
  })

  test('CA31 with a fresh session and the right phrase, the account is deleted (204)', async () => {
    await db().query("UPDATE sessions SET created_at = now() WHERE id = $1", [appareilA.sessionId])

    const reponse = await appareilA.api.delete('/api/studio/moi', { data: { confirmation: ACCOUNT_DELETION_PHRASE } })

    expect(reponse.status()).toBe(204)
  })

  test('CA31 afterwards /api/studio/moi answers 401', async () => {
    expect((await appareilA.api.get('/api/studio/moi')).status()).toBe(401)
  })

  test('CA31 afterwards the public vitrine answers 404 and the photo files are gone', async ({ request }) => {
    await attendreErreur(await request.get(`/api/public/${username}`), 404, 'VITRINE_INTROUVABLE')
    expect((await request.get(`/medias/${mediaId}/800.webp`)).status()).toBe(404)
  })

  test('CA31 afterwards no row of the account remains in the database', async () => {
    for (const table of ['users', 'sessions', 'accounts', 'vitrines', 'medias']) {
      const colonne = table === 'users' ? 'id' : 'user_id'
      const resultat = await db().query(`SELECT 1 FROM ${table} WHERE ${colonne} = $1`, [appareilA.userId])
      expect(resultat.rowCount, `table ${table}`).toBe(0)
    }
  })
})
