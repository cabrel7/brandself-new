import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { accounts, medias, sessions, users, vitrines } from '../../shared/db/schema'
import { ACCOUNT_DELETION_PHRASE, FRESH_SESSION_MAX_AGE_S, TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import { schemaMoiUpdate } from '../../shared/schemas/moi'
import { schemaVitrineUpdate } from '../../shared/schemas/vitrine'
import { makePng } from '../support/images'
import { fichiersDeLUtilisateur, fichiersDuMedia, mediasDir } from './support/disque'
import { rejet } from './support/erreurs'
import { createSession, createUser, insertVitrineRow } from './support/fabriques'
import { mediasService, ressourceUtilisateur, utilisateursService, vitrinesService } from './support/modules'

// Vrai PostgreSQL, vrai disque, vrai Redis. Les sessions sont de vraies lignes `sessions`.

const MAX_USER_AGENT = 256

async function ligneUser(id: string) {
  const [ligne] = await db.select().from(users).where(eq(users.id, id))
  return ligne
}

async function ligneVitrine(userId: string) {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.userId, userId))
  return ligne
}

describe('utilisateurs — profil (CA27, CA28)', () => {
  it('CA27 should hide the temporary email, expose the phone and report that the user has no vitrine', async () => {
    const { getMe } = await utilisateursService()
    const { toMoiResource } = await ressourceUtilisateur()
    const telephone = '+237600000000'
    const user = await createUser({ email: `${telephone}@${TEMP_EMAIL_DOMAIN}`, phoneNumber: telephone, phoneNumberVerified: true })

    const moi = toMoiResource(await getMe(user.id))

    expect(moi).toEqual({
      id: user.id,
      email: null,
      telephone,
      locale: 'fr',
      devise: 'XAF',
      fuseau: 'Africa/Douala',
      aUneVitrine: false,
      vitrine: null,
    })
  })

  it('CA27 should report the real vitrine state (aUneVitrine, username, publiee) instead of a hard-coded false', async () => {
    const { getMe } = await utilisateursService()
    const { toMoiResource } = await ressourceUtilisateur()
    const brouillon = await createUser()
    const publie = await createUser()
    await insertVitrineRow(brouillon.id, { username: 'mon-brouillon' })
    await insertVitrineRow(publie.id, { username: 'ma-vitrine', publiee: true })

    const moiBrouillon = toMoiResource(await getMe(brouillon.id))
    const moiPublie = toMoiResource(await getMe(publie.id))

    expect(moiBrouillon).toMatchObject({ aUneVitrine: true, vitrine: { username: 'mon-brouillon', publiee: false } })
    expect(moiPublie).toMatchObject({ aUneVitrine: true, vitrine: { username: 'ma-vitrine', publiee: true } })
  })

  it('CA27 should keep a real email and expose exactly the MoiDTO keys', async () => {
    const { getMe } = await utilisateursService()
    const { toMoiResource } = await ressourceUtilisateur()
    const user = await createUser({ email: 'cabrel@exemple.com' })

    const moi = toMoiResource(await getMe(user.id))

    expect(moi.email).toBe('cabrel@exemple.com')
    expect(moi.telephone).toBeNull()
    expect(Object.keys(moi).sort()).toEqual(['aUneVitrine', 'devise', 'email', 'fuseau', 'id', 'locale', 'telephone', 'vitrine'])
  })

  it('CA27 should only hide the email of the exact temporary domain (look-alike domains stay visible)', async () => {
    const { getMe } = await utilisateursService()
    const { toMoiResource } = await ressourceUtilisateur()
    const intrus = await createUser({ email: `jean@${TEMP_EMAIL_DOMAIN}.exemple.com` })
    const sosie = await createUser({ email: `jean@xx${TEMP_EMAIL_DOMAIN}` })

    expect(toMoiResource(await getMe(intrus.id)).email).toBe(`jean@${TEMP_EMAIL_DOMAIN}.exemple.com`)
    expect(toMoiResource(await getMe(sosie.id)).email).toBe(`jean@xx${TEMP_EMAIL_DOMAIN}`)
  })

  it('CA27 should read the user from the database on every call (no stale session data)', async () => {
    const { getMe } = await utilisateursService()
    const { toMoiResource } = await ressourceUtilisateur()
    const user = await createUser()
    await getMe(user.id)

    await db.update(users).set({ devise: 'EUR' }).where(eq(users.id, user.id))

    expect(toMoiResource(await getMe(user.id)).devise).toBe('EUR')
  })

  it('CA28 should update the timezone on the user AND on the vitrine, leaving locale and devise untouched', async () => {
    const { updateMe } = await utilisateursService()
    const user = await createUser({ devise: 'EUR' })
    await insertVitrineRow(user.id)

    await updateMe(user.id, schemaMoiUpdate.parse({ fuseau: 'Europe/Paris' }))

    expect(await ligneUser(user.id)).toMatchObject({ fuseau: 'Europe/Paris', locale: 'fr', devise: 'EUR' })
    expect((await ligneVitrine(user.id)).fuseau).toBe('Europe/Paris')
  })

  it('CA28 should not touch the vitrine timezone when only the devise changes', async () => {
    const { updateMe } = await utilisateursService()
    const user = await createUser({ fuseau: 'Africa/Douala' })
    await insertVitrineRow(user.id)

    await updateMe(user.id, schemaMoiUpdate.parse({ devise: 'USD' }))

    expect(await ligneUser(user.id)).toMatchObject({ devise: 'USD', fuseau: 'Africa/Douala' })
    expect((await ligneVitrine(user.id)).fuseau).toBe('Africa/Douala')
  })

  it('CA28 should not modify the vitrine of another user', async () => {
    const { updateMe } = await utilisateursService()
    const a = await createUser()
    const b = await createUser()
    await insertVitrineRow(a.id)
    await insertVitrineRow(b.id)

    await updateMe(a.id, schemaMoiUpdate.parse({ fuseau: 'America/Montreal' }))

    expect((await ligneVitrine(b.id)).fuseau).toBe('Africa/Douala')
    expect((await ligneUser(b.id)).fuseau).toBe('Africa/Douala')
  })

  it('CA28 should update the user timezone when the user has no vitrine yet', async () => {
    const { updateMe } = await utilisateursService()
    const user = await createUser()

    await updateMe(user.id, schemaMoiUpdate.parse({ fuseau: 'Africa/Lagos' }))

    expect((await ligneUser(user.id)).fuseau).toBe('Africa/Lagos')
  })

  it.each([
    ['fuseau inconnu', { fuseau: 'Mars/Olympus' }],
    ['devise inconnue', { devise: 'GBP' }],
    ['objet vide', {}],
  ])('CA28 should refuse %s at validation level (the service is never reached)', (_libelle, entree) => {
    expect(schemaMoiUpdate.safeParse(entree).success).toBe(false)
  })
})

describe('utilisateurs — appareils (CA29, CA30)', () => {
  it('CA29 should list only the active sessions of the user, flagging the current one, newest activity first', async () => {
    const { listDevices } = await utilisateursService()
    const { toAppareilResource } = await ressourceUtilisateur()
    const a = await createUser()
    const b = await createUser()
    const ancienne = await createSession(a.id, { updatedAt: new Date(Date.now() - 3 * 3_600_000), userAgent: 'Firefox' })
    const courante = await createSession(a.id, { updatedAt: new Date(Date.now() - 60_000), userAgent: 'Chrome' })
    const recente = await createSession(a.id, { updatedAt: new Date(), userAgent: 'Safari' })
    await createSession(a.id, { expireDansDesHeures: -1, userAgent: 'Expirée' })
    await createSession(b.id, { userAgent: 'Session de B' })

    const appareils = (await listDevices(a.id, courante.id)).map(toAppareilResource)

    expect(appareils.map((x) => x.id)).toEqual([recente.id, courante.id, ancienne.id])
    expect(appareils.map((x) => x.actuel)).toEqual([false, true, false])
    expect(appareils.map((x) => x.userAgent)).toEqual(['Safari', 'Chrome', 'Firefox'])
  })

  it('CA29 should expose exactly the AppareilDTO keys and no token, IP or user id', async () => {
    const { listDevices } = await utilisateursService()
    const { toAppareilResource } = await ressourceUtilisateur()
    const a = await createUser()
    const session = await createSession(a.id)

    const appareils = (await listDevices(a.id, session.id)).map(toAppareilResource)

    expect(Object.keys(appareils[0]).sort()).toEqual(['actuel', 'creeLe', 'derniereActivite', 'expireLe', 'id', 'userAgent'])
    const json = JSON.stringify(appareils)
    expect(json).not.toContain(session.token)
    expect(json).not.toContain('token')
    expect(json).not.toContain('203.0.113.7')
    expect(json).not.toContain(a.id)
    expect(appareils[0].creeLe).toBe(session.createdAt.toISOString())
    expect(appareils[0].expireLe).toBe(session.expiresAt.toISOString())
  })

  it('CA29 should cap the user agent at 256 characters and keep a missing one as null', async () => {
    const { listDevices } = await utilisateursService()
    const { toAppareilResource } = await ressourceUtilisateur()
    const a = await createUser()
    const longue = await createSession(a.id, { userAgent: 'x'.repeat(1000), updatedAt: new Date() })
    await createSession(a.id, { userAgent: null, updatedAt: new Date(Date.now() - 1000) })

    const appareils = (await listDevices(a.id, longue.id)).map(toAppareilResource)

    expect(appareils[0].userAgent).toHaveLength(MAX_USER_AGENT)
    expect(appareils[1].userAgent).toBeNull()
  })

  it('CA29 should return an empty list for a user without session', async () => {
    const { listDevices } = await utilisateursService()
    const a = await createUser()

    expect(await listDevices(a.id, randomUUID())).toEqual([])
  })

  it('CA30 should revoke another session of the user', async () => {
    const { revokeDevice } = await utilisateursService()
    const a = await createUser()
    const courante = await createSession(a.id)
    const autre = await createSession(a.id)

    await revokeDevice(a.id, autre.id, courante.id)

    expect(await db.select().from(sessions).where(eq(sessions.id, autre.id))).toHaveLength(0)
    expect(await db.select().from(sessions).where(eq(sessions.id, courante.id))).toHaveLength(1)
  })

  it('CA30 should answer APPAREIL_INTROUVABLE for the session of another user and leave it intact', async () => {
    const { revokeDevice } = await utilisateursService()
    const a = await createUser()
    const b = await createUser()
    const courante = await createSession(a.id)
    const deB = await createSession(b.id)

    const erreur = await rejet(revokeDevice(a.id, deB.id, courante.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('APPAREIL_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect(await db.select().from(sessions).where(eq(sessions.id, deB.id))).toHaveLength(1)
  })

  it('CA30 should refuse to revoke the current session with SESSION_ACTUELLE', async () => {
    const { revokeDevice } = await utilisateursService()
    const a = await createUser()
    const courante = await createSession(a.id)

    const erreur = await rejet(revokeDevice(a.id, courante.id, courante.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('SESSION_ACTUELLE')
    expect(erreur.status).toBe(422)
    expect(await db.select().from(sessions).where(eq(sessions.id, courante.id))).toHaveLength(1)
  })

  it('CA30 should answer APPAREIL_INTROUVABLE for an unknown session id', async () => {
    const { revokeDevice } = await utilisateursService()
    const a = await createUser()
    const courante = await createSession(a.id)

    const erreur = await rejet(revokeDevice(a.id, randomUUID(), courante.id))

    expect(erreur.code).toBe('APPAREIL_INTROUVABLE')
  })

  it('CA30 should turn two simultaneous revocations of the same device into one success and one APPAREIL_INTROUVABLE', async () => {
    const { revokeDevice } = await utilisateursService()
    const a = await createUser()
    const courante = await createSession(a.id)
    const autre = await createSession(a.id)

    const resultats = await Promise.allSettled([
      revokeDevice(a.id, autre.id, courante.id),
      revokeDevice(a.id, autre.id, courante.id),
    ])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const erreur = await rejet(Promise.reject(echec?.reason))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('APPAREIL_INTROUVABLE')
  })
})

describe('utilisateurs — suppression du compte (CA31)', () => {
  async function creerCompteComplet(nomVitrine: string) {
    const { uploadMedia } = await mediasService()
    const { createVitrine, publishVitrine, updateVitrine } = await vitrinesService()
    const user = await createUser()
    const session = await createSession(user.id)
    await db.insert(accounts).values({ id: randomUUID(), accountId: user.id, providerId: 'email-otp', userId: user.id })
    await createVitrine(user.id, { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username: nomVitrine })
    const photo = await uploadMedia(user.id, await makePng(300, 200))
    const autre = await uploadMedia(user.id, await makePng(300, 200))
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ ville: 'Douala', pays: 'CM', photoMediaId: photo.id }))
    await publishVitrine(user.id)
    return { user, session, photo, autre }
  }

  it('CA31 should refuse a wrong confirmation phrase with CONFIRMATION_INVALIDE and delete nothing', async () => {
    const { deleteAccount } = await utilisateursService()
    const { user, session } = await creerCompteComplet('dr-a')

    const erreur = await rejet(deleteAccount(user.id, { confirmation: 'oui', sessionCreatedAt: session.createdAt }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('CONFIRMATION_INVALIDE')
    expect(erreur.status).toBe(400)
    expect(await ligneUser(user.id)).toBeDefined()
    expect(await fichiersDeLUtilisateur(user.id)).not.toHaveLength(0)
  })

  it('CA31 should refuse a session older than 24 h with SESSION_TROP_ANCIENNE and delete nothing', async () => {
    const { deleteAccount } = await utilisateursService()
    const { user } = await creerCompteComplet('dr-a')
    const vieille = await createSession(user.id, { creeIlYADesHeures: 25 })

    const erreur = await rejet(
      deleteAccount(user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: vieille.createdAt }),
    )

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('SESSION_TROP_ANCIENNE')
    expect(erreur.status).toBe(403)
    expect(await ligneUser(user.id)).toBeDefined()
    expect(await ligneVitrine(user.id)).toBeDefined()
    expect(await fichiersDeLUtilisateur(user.id)).not.toHaveLength(0)
  })

  it('CA31 should accept a session that is still fresh (23 h old)', async () => {
    const { deleteAccount } = await utilisateursService()
    const { user } = await creerCompteComplet('dr-a')
    const fraiche = await createSession(user.id, { creeIlYADesHeures: (FRESH_SESSION_MAX_AGE_S / 3600) - 1 })

    await expect(
      deleteAccount(user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: fraiche.createdAt }),
    ).resolves.not.toThrow()

    expect(await ligneUser(user.id)).toBeUndefined()
  })

  it('CA31 should delete the user, sessions, accounts, vitrine, media rows and the user folder, and leave user B untouched', async () => {
    const { deleteAccount } = await utilisateursService()
    const a = await creerCompteComplet('dr-a')
    const b = await creerCompteComplet('dr-b')

    await deleteAccount(a.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: a.session.createdAt })

    expect(await ligneUser(a.user.id)).toBeUndefined()
    expect(await db.select().from(sessions).where(eq(sessions.userId, a.user.id))).toHaveLength(0)
    expect(await db.select().from(accounts).where(eq(accounts.userId, a.user.id))).toHaveLength(0)
    expect(await ligneVitrine(a.user.id)).toBeUndefined()
    expect(await db.select().from(medias).where(eq(medias.userId, a.user.id))).toHaveLength(0)
    expect(existsSync(path.join(mediasDir(), a.user.id))).toBe(false)
    expect(await fichiersDuMedia(a.photo.id)).toHaveLength(0)

    expect(await ligneUser(b.user.id)).toBeDefined()
    expect(await db.select().from(sessions).where(eq(sessions.userId, b.user.id))).toHaveLength(1)
    expect(await db.select().from(accounts).where(eq(accounts.userId, b.user.id))).toHaveLength(1)
    expect(await ligneVitrine(b.user.id)).toBeDefined()
    expect(await db.select().from(medias).where(eq(medias.userId, b.user.id))).toHaveLength(2)
    expect(await fichiersDuMedia(b.photo.id)).toHaveLength(3)
    expect(await fichiersDuMedia(b.autre.id)).toHaveLength(3)
  })

  it('CA31 should make the public vitrine of a deleted account disappear', async () => {
    const { deleteAccount } = await utilisateursService()
    const { getPublicVitrine } = await vitrinesService()
    const a = await creerCompteComplet('dr-a')
    await expect(getPublicVitrine('dr-a')).resolves.toBeDefined()

    await deleteAccount(a.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: a.session.createdAt })

    const erreur = await rejet(getPublicVitrine('dr-a'))
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA31 should free the username of the deleted account', async () => {
    const { deleteAccount } = await utilisateursService()
    const { createVitrine } = await vitrinesService()
    const a = await creerCompteComplet('dr-a')
    const b = await createUser()

    await deleteAccount(a.user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: a.session.createdAt })

    await createVitrine(b.id, { titre: null, prenom: 'Marie', nom: 'Ngo', metier: 'Avocate', username: 'dr-a' })

    expect((await ligneVitrine(b.id)).username).toBe('dr-a')
  })

  it('CA31 should delete an account that has no media at all (no folder to remove)', async () => {
    const { deleteAccount } = await utilisateursService()
    const user = await createUser()
    const session = await createSession(user.id)

    await expect(
      deleteAccount(user.id, { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: session.createdAt }),
    ).resolves.not.toThrow()

    expect(await ligneUser(user.id)).toBeUndefined()
  })
})
