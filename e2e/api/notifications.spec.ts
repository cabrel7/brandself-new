import { createHmac, hkdfSync, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import { DESABONNEMENT_LIMIT } from '../../shared/limites'
import {
  DESABONNEMENT_HKDF_INFO,
  DESABONNEMENT_JETON_VALIDITE_JOURS,
  DESABONNEMENT_JETON_VERSION,
} from '../../shared/notifications'
import type { PreferenceEmail } from '../../shared/notifications'
import { attendreErreur, db, fermerConnexions, lireEnv, reinitialiserLimites, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// S9 §6 : contrats HTTP des routes de notifications (serveur réel, session Better Auth réelle, PostgreSQL et Redis réels).
// Critères : CA39 à CA44, CA47 à CA49, CA50 à CA55 (CA56 : e2e/api/studio-auth.spec.ts).
// Le jeton de désabonnement est signé ici avec l'algorithme documenté (spec #89 : HKDF-SHA256 du secret
// d'authentification, info `brandself-desabonnement-v1`, HMAC-SHA256) : le test échoue si le serveur en dérive autrement.
// Écarts à la spec constatés : la validation Zod répond 400 VALIDATION dans tout le dépôt (la spec écrit 422).

const PREFIXE_LIMITE = 'desabonnement:'
const ONE_CLICK = { 'List-Unsubscribe': 'One-Click' }
const JOUR_S = 86_400
const CLES_MOI = ['aUneVitrine', 'devise', 'email', 'emailHebdo', 'emailRappelJour', 'fuseau', 'id', 'locale', 'telephone', 'vitrine']

function signer(userId: string, preference: PreferenceEmail, emisIlYaJours = 0): string {
  const cle = Buffer.from(hkdfSync('sha256', lireEnv('NUXT_BETTER_AUTH_SECRET'), Buffer.alloc(0), DESABONNEMENT_HKDF_INFO, 32))
  const expiration = Math.floor(Date.now() / 1000) - emisIlYaJours * JOUR_S + DESABONNEMENT_JETON_VALIDITE_JOURS * JOUR_S
  const charge = Buffer.from(JSON.stringify({ u: userId, p: preference, e: expiration }), 'utf8').toString('base64url')
  const entree = `${DESABONNEMENT_JETON_VERSION}.${charge}`
  return `${entree}.${createHmac('sha256', cle).update(entree).digest('base64url')}`
}

function falsifier(jeton: string): string {
  const [v, p, s] = jeton.split('.') as [string, string, string]
  return `${v}.${p}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`
}

async function preferencesEnBase(userId: string): Promise<{ email_hebdo: boolean, email_rappel_jour: boolean, fuseau: string }> {
  const r = await db().query<{ email_hebdo: boolean, email_rappel_jour: boolean, fuseau: string }>(
    'SELECT email_hebdo, email_rappel_jour, fuseau FROM users WHERE id = $1', [userId])
  return r.rows[0]
}

test.describe.serial('notifications : préférences, désabonnement, prochaine étape, partage', () => {
  let session: Session
  let autre: Session
  let mediaId: string
  const username = `s9-${randomUUID().slice(0, 8)}`

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    autre = await seConnecter(playwright)
    await reinitialiserLimites(PREFIXE_LIMITE)
  })

  test.afterAll(async () => {
    await reinitialiserLimites(PREFIXE_LIMITE)
    await session.api.dispose()
    await autre.api.dispose()
    await fermerConnexions()
  })

  test('CA47 GET /api/studio/moi exposes emailHebdo and emailRappelJour, both true by default', async () => {
    const reponse = await session.api.get('/api/studio/moi')

    expect(reponse.status()).toBe(200)
    const { moi } = (await reponse.json()) as { moi: Record<string, unknown> }
    expect(moi).toMatchObject({ emailHebdo: true, emailRappelJour: true })
    expect(Object.keys(moi).sort()).toEqual(CLES_MOI)
  })

  test('CA47 PUT /api/studio/moi { emailHebdo: false } answers 200, persists it, and leaves emailRappelJour alone', async () => {
    const reponse = await session.api.put('/api/studio/moi', { data: { emailHebdo: false } })

    expect(reponse.status()).toBe(200)
    expect(((await reponse.json()) as { moi: Record<string, unknown> }).moi).toMatchObject({ emailHebdo: false, emailRappelJour: true })
    expect(await preferencesEnBase(session.userId)).toMatchObject({ email_hebdo: false, email_rappel_jour: true })
    expect(((await (await session.api.get('/api/studio/moi')).json()) as { moi: Record<string, unknown> }).moi).toMatchObject({ emailHebdo: false })
  })

  test('CA48 PUT /api/studio/moi refuses a non-boolean preference and an unknown key (400 VALIDATION)', async () => {
    for (const corps of [{ emailHebdo: 'non' }, { emailRappelJour: 1 }, { emailHebdo: false, newsletter: true }, { email_hebdo: true }]) {
      await attendreErreur(await session.api.put('/api/studio/moi', { data: corps }), 400, 'VALIDATION')
    }
    expect(await preferencesEnBase(session.userId)).toMatchObject({ email_hebdo: false, email_rappel_jour: true })
  })

  test('CA49 POST /api/auth/update-user cannot change the timezone nor the preferences', async () => {
    const avant = await preferencesEnBase(session.userId)

    await session.api.post('/api/auth/update-user', { data: { fuseau: 'Mars/Olympus', email_hebdo: true, email_rappel_jour: false } })

    expect(await preferencesEnBase(session.userId)).toEqual(avant)
  })

  test('CA39 GET /api/public/desabonnement answers 200 { preference } with no effect and forbids caching and indexing', async ({ request }) => {
    const jeton = signer(session.userId, 'email_rappel_jour')

    const reponse = await request.get(`/api/public/desabonnement?jeton=${jeton}`)

    expect(reponse.status()).toBe(200)
    expect(await reponse.json()).toEqual({ preference: 'email_rappel_jour' })
    expect(reponse.headers()['cache-control']).toContain('no-store')
    expect(reponse.headers()['referrer-policy']).toBe('no-referrer')
    expect(reponse.headers()['x-robots-tag']).toContain('noindex')
    expect((await preferencesEnBase(session.userId)).email_rappel_jour).toBe(true)
  })

  test('CA40 POST one-click (form-urlencoded, no session, no Origin) unsubscribes, and the second POST answers the same 200', async ({ request }) => {
    const jeton = signer(session.userId, 'email_rappel_jour')

    const premier = await request.post(`/api/public/desabonnement?jeton=${jeton}`, { form: ONE_CLICK })
    const second = await request.post(`/api/public/desabonnement?jeton=${jeton}`, { form: ONE_CLICK })

    for (const reponse of [premier, second]) {
      expect(reponse.status()).toBe(200)
      expect(await reponse.json()).toEqual({ preference: 'email_rappel_jour', desabonne: true })
    }
    expect(await preferencesEnBase(session.userId)).toMatchObject({ email_rappel_jour: false, email_hebdo: false })
  })

  test('CA41 a forged signature or a tampered payload answers 404 JETON_INVALIDE and changes nothing', async ({ request }) => {
    const jeton = signer(autre.userId, 'email_hebdo')
    const [v, p, s] = jeton.split('.') as [string, string, string]
    const charge = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>
    const modifie = `${v}.${Buffer.from(JSON.stringify({ ...charge, p: 'email_rappel_jour' })).toString('base64url')}.${s}`

    for (const mauvais of [falsifier(jeton), modifie, 'abc', `v2.${p}.${s}`]) {
      await attendreErreur(await request.post(`/api/public/desabonnement?jeton=${mauvais}`, { form: ONE_CLICK }), 404, 'JETON_INVALIDE')
      await attendreErreur(await request.get(`/api/public/desabonnement?jeton=${mauvais}`), 404, 'JETON_INVALIDE')
    }
    expect(await preferencesEnBase(autre.userId)).toMatchObject({ email_hebdo: true, email_rappel_jour: true })
  })

  test('CA42 a token issued 91 days ago answers 410 JETON_EXPIRE on GET and POST', async ({ request }) => {
    const jeton = signer(autre.userId, 'email_hebdo', DESABONNEMENT_JETON_VALIDITE_JOURS + 1)

    await attendreErreur(await request.get(`/api/public/desabonnement?jeton=${jeton}`), 410, 'JETON_EXPIRE')
    await attendreErreur(await request.post(`/api/public/desabonnement?jeton=${jeton}`, { form: ONE_CLICK }), 410, 'JETON_EXPIRE')
    expect((await preferencesEnBase(autre.userId)).email_hebdo).toBe(true)
  })

  test('CA43 a valid token of an unknown account still answers 200 (no existence oracle)', async ({ request }) => {
    const reponse = await request.post(`/api/public/desabonnement?jeton=${signer(randomUUID(), 'email_hebdo')}`, { form: ONE_CLICK })

    expect(reponse.status()).toBe(200)
    expect(await reponse.json()).toEqual({ preference: 'email_hebdo', desabonne: true })
  })

  test('CA44 the 21st unsubscription request of a minute from the same address answers 429 with Retry-After', async ({ request }) => {
    await reinitialiserLimites(PREFIXE_LIMITE)
    const jeton = signer(autre.userId, 'email_rappel_jour')
    // Le jeton ci-dessus désabonne `autre` : la préférence n'a plus d'importance pour la suite du fichier.

    for (let i = 1; i <= DESABONNEMENT_LIMIT.limit; i += 1) {
      expect((await request.post(`/api/public/desabonnement?jeton=${jeton}`, { form: ONE_CLICK })).status(), `appel ${i}`).toBe(200)
    }
    const refus = await request.post(`/api/public/desabonnement?jeton=${jeton}`, { form: ONE_CLICK })

    await attendreErreur(refus, 429, 'TROP_DE_REQUETES')
    expect(Number(refus.headers()['retry-after'])).toBeGreaterThan(0)
    await reinitialiserLimites(PREFIXE_LIMITE)
  })

  test('CA50 GET /api/studio/prochaine-etape without vitrine answers 404 VITRINE_INTROUVABLE', async () => {
    await attendreErreur(await session.api.get('/api/studio/prochaine-etape'), 404, 'VITRINE_INTROUVABLE')
    await attendreErreur(await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape: 'photo' } }), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA50 a fresh vitrine gets the bare DTO { etape: "photo" } (no envelope) with no-store', async () => {
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)

    const reponse = await session.api.get('/api/studio/prochaine-etape')

    expect(reponse.status()).toBe(200)
    expect(await reponse.json()).toEqual({ etape: 'photo' })
    expect(reponse.headers()['cache-control']).toContain('no-store')
  })

  test('CA55 ignoring an unknown step answers 400 VALIDATION (the spec says 422: Zod errors are 400 across the repository)', async () => {
    for (const corps of [{ etape: 'temoignage' }, {}, { etape: 'photo', en_plus: 1 }]) {
      await attendreErreur(await session.api.post('/api/studio/prochaine-etape/ignorer', { data: corps }), 400, 'VALIDATION')
    }
  })

  test('CA54 sharing an unpublished vitrine answers 422 VITRINE_NON_PUBLIEE', async () => {
    await attendreErreur(await session.api.post('/api/studio/vitrine/partage'), 422, 'VITRINE_NON_PUBLIEE')
  })

  test('CA52 once photo is set and the vitrine published, the next step is "service"; an unpublished vitrine never gets "partager"', async () => {
    const televersement = await session.api.post('/api/studio/medias', {
      multipart: { fichier: { name: 'photo.png', mimeType: 'image/png', buffer: await makePng(300, 200) } },
    })
    expect(televersement.status()).toBe(201)
    mediaId = ((await televersement.json()) as { media: { id: string } }).media.id
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM', photoMediaId: mediaId } })).status()).toBe(200)
    expect(await (await session.api.get('/api/studio/prochaine-etape')).json()).toEqual({ etape: 'service' })

    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    expect(await (await session.api.get('/api/studio/prochaine-etape')).json()).toEqual({ etape: 'service' })
  })

  test('CA51 ignoring a step answers the following one, is idempotent, and is remembered for good', async () => {
    const premiere = await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape: 'service' } })
    expect(premiere.status()).toBe(200)
    expect(await premiere.json()).toEqual({ etape: 'disponibilites' })

    const rejeu = await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape: 'service' } })
    expect(await rejeu.json()).toEqual({ etape: 'disponibilites' })
    expect(await (await session.api.get('/api/studio/prochaine-etape')).json()).toEqual({ etape: 'disponibilites' })

    const suivante = await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape: 'disponibilites' } })
    expect(await suivante.json()).toEqual({ etape: 'realisation' })
    const derniere = await session.api.post('/api/studio/prochaine-etape/ignorer', { data: { etape: 'realisation' } })
    expect(await derniere.json()).toEqual({ etape: 'partager' })

    const ligne = await db().query<{ etapes_ignorees: string[] }>('SELECT etapes_ignorees FROM vitrines WHERE user_id = $1', [session.userId])
    expect([...ligne.rows[0].etapes_ignorees].sort()).toEqual(['disponibilites', 'realisation', 'service'])
  })

  test('CA53 POST /api/studio/vitrine/partage answers { partageeLe } and keeps the first date; the next step becomes null', async () => {
    const premier = await session.api.post('/api/studio/vitrine/partage')
    expect(premier.status()).toBe(200)
    const { partageeLe } = (await premier.json()) as { partageeLe: string }
    expect(new Date(partageeLe).toISOString()).toBe(partageeLe)

    const second = await session.api.post('/api/studio/vitrine/partage')
    expect(second.status()).toBe(200)
    expect(await second.json()).toEqual({ partageeLe })
    expect(await (await session.api.get('/api/studio/prochaine-etape')).json()).toEqual({ etape: null })
  })

  test('isolation: another account neither sees nor changes the steps of this vitrine', async () => {
    await attendreErreur(await autre.api.get('/api/studio/prochaine-etape'), 404, 'VITRINE_INTROUVABLE')
    await attendreErreur(await autre.api.post('/api/studio/vitrine/partage'), 404, 'VITRINE_INTROUVABLE')
    const ligne = await db().query<{ partagee_le: Date | null }>('SELECT partagee_le FROM vitrines WHERE user_id = $1', [session.userId])
    expect(ligne.rows[0].partagee_le).not.toBeNull()
  })
})
