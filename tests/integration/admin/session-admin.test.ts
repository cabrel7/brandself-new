import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_SESSION_DUREE_S } from '../../../shared/admin'
import { sessions, users } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import {
  HEURE_MS,
  appelerAuth,
  appelerGarde,
  attendreJobsConnexion,
  brancherGardeSurAuth,
  compterSessions,
  compterUtilisateurs,
  connecterParCode,
  creerAuth,
  creerSessionAdmin,
  creerSuperadmin,
  creerUtilisateurOrdinaire,
  creerUtilisateurSuspendu,
  demanderCodeConnexion,
  demanderCodeTelephone,
  derniereSession,
  evenementAdmin,
  jobsConnexionApresDelai,
  lireCodeEmail,
  lireCodeTelephone,
  lireSessions,
  ouvrirSession,
  sessionAdminService,
  verifierCodeTelephone,
  viderFileMessagesAuth,
} from '../support/admin'

// A1, sessions d'administration sur base RÉELLE et instance Better Auth RÉELLE (mêmes options que l'application,
// `Request` avec en-tête `Host`) : hooks `session.create.before`, `session.update.before`, `user.create.before`,
// filtre de `sendVerificationOTP`, plugin `admin()`, et garde `requireSuperadmin`.
// CA05 à CA12. L'envoi d'un code passe par la VRAIE file BullMQ `messages-auth` (aucun worker : un job y reste).

const HUIT_HEURES_MS = ADMIN_SESSION_DUREE_S * 1000
const MINUTE_MS = 60_000

let auth: Awaited<ReturnType<typeof creerAuth>>

beforeAll(async () => {
  auth = await creerAuth()
})

beforeEach(async () => {
  await viderFileMessagesAuth()
  brancherGardeSurAuth(auth)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sansDomain = (setCookie: string[]): boolean => setCookie.every((c) => !/;\s*domain=/i.test(c))

describe('demande de code sur l\'hôte d\'administration : aucun envoi pour un non-superadmin (CA05)', () => {
  it('should answer 200 { success: true } and enqueue NO job for an ordinary account', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()

    const reponse = await demanderCodeConnexion(auth, ordinaire.email, 'admin')

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ success: true })
    expect(await jobsConnexionApresDelai(ordinaire.email)).toHaveLength(0)
  })

  it('should enqueue the very same code e-mail for that account on the public host (control: the queue and the address are fine)', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()

    const reponse = await demanderCodeConnexion(auth, ordinaire.email, 'public')

    expect(reponse.status).toBe(200)
    expect(await attendreJobsConnexion(ordinaire.email)).toHaveLength(1)
  })

  it('should answer 200 { success: true } and enqueue NO job for an address that has no account', async () => {
    const reponse = await demanderCodeConnexion(auth, 'inconnu-sans-compte@exemple.test', 'admin')

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ success: true })
    expect(await jobsConnexionApresDelai('inconnu-sans-compte@exemple.test')).toHaveLength(0)
  })

  it('should enqueue NO job for a SUSPENDED superadmin', async () => {
    const admin = await creerSuperadmin({ banned: true, banReason: 'suspension de test' })

    const reponse = await demanderCodeConnexion(auth, admin.email, 'admin')

    expect(reponse.status).toBe(200)
    expect(await jobsConnexionApresDelai(admin.email)).toHaveLength(0)
  })

  it('should enqueue exactly one job for an active superadmin (control: the filter does not block the right person)', async () => {
    const admin = await creerSuperadmin()

    const reponse = await demanderCodeConnexion(auth, admin.email, 'admin')

    expect(reponse.status).toBe(200)
    expect(reponse.corps).toEqual({ success: true })
    expect(await attendreJobsConnexion(admin.email)).toHaveLength(1)
  })

  it('should recognise a superadmin whatever the letter case of the address typed', async () => {
    const admin = await creerSuperadmin({ email: 'admin-casse@exemple.test' })

    await demanderCodeConnexion(auth, 'ADMIN-Casse@Exemple.TEST', 'admin')

    expect(await attendreJobsConnexion(admin.email)).toHaveLength(1)
  })

  it('should give the same answer for a superadmin, an ordinary account and an unknown address (no oracle on accounts)', async () => {
    const admin = await creerSuperadmin()
    const ordinaire = await creerUtilisateurOrdinaire()

    const reponses = await Promise.all([
      demanderCodeConnexion(auth, admin.email, 'admin'),
      demanderCodeConnexion(auth, ordinaire.email, 'admin'),
      demanderCodeConnexion(auth, 'personne@exemple.test', 'admin'),
    ])

    expect(new Set(reponses.map((r) => JSON.stringify({ status: r.status, corps: r.corps }))).size).toBe(1)
  })
})

describe('un code obtenu sur le site public ne donne aucun accès à l\'administration (CA06, CA07)', () => {
  it('should refuse with 403 the valid code of an ordinary account used on the administration host, and open no session', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    await demanderCodeConnexion(auth, ordinaire.email, 'public')
    const code = await lireCodeEmail(ordinaire.email)

    const reponse = await connecterParCode(auth, ordinaire.email, code, 'admin')

    expect(reponse.status).toBe(403)
    expect(reponse.setCookie.some((c) => /session_token=[^;]/.test(c))).toBe(false)
    expect(await compterSessions()).toBe(0)
  })

  it('should let the same account in on the public host (control: the code and the account are valid)', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    await demanderCodeConnexion(auth, ordinaire.email, 'public')
    const code = await lireCodeEmail(ordinaire.email)

    const reponse = await connecterParCode(auth, ordinaire.email, code, 'public')

    expect(reponse.status).toBe(200)
    const [session] = await lireSessions(ordinaire.id)
    expect(session?.admin).toBe(false)
  })

  it('should create no account for an unknown address that presents a valid code on the administration host', async () => {
    const email = 'nouveau-venu@exemple.test'
    await demanderCodeConnexion(auth, email, 'public')
    const code = await lireCodeEmail(email)

    const reponse = await connecterParCode(auth, email, code, 'admin')

    expect(reponse.status).toBe(403)
    expect(await compterUtilisateurs()).toBe(0)
    expect(await compterSessions()).toBe(0)
  })

  it('should create the account for the same unknown address on the public host (control)', async () => {
    const email = 'nouveau-venu@exemple.test'
    await demanderCodeConnexion(auth, email, 'public')
    const code = await lireCodeEmail(email)

    const reponse = await connecterParCode(auth, email, code, 'public')

    expect(reponse.status).toBe(200)
    expect(await compterUtilisateurs()).toBe(1)
  })

  it('should never leave a superadmin role on an account created through sign-in (the default role stays "user")', async () => {
    const email = 'nouveau-venu-role@exemple.test'
    await demanderCodeConnexion(auth, email, 'public')
    await connecterParCode(auth, email, await lireCodeEmail(email), 'public')

    const [compte] = await db.select().from(users).where(eq(users.email, email))

    expect(compte?.role).toBe('user')
  })

  it('should refuse a SUSPENDED superadmin on the administration host even with a valid code', async () => {
    const admin = await creerSuperadmin({ banned: true, banReason: 'suspension de test' })
    await demanderCodeConnexion(auth, admin.email, 'public')
    const code = await lireCodeEmail(admin.email)

    const reponse = await connecterParCode(auth, admin.email, code, 'admin')

    expect(reponse.status).toBe(403)
    expect(await compterSessions()).toBe(0)
  })
})

describe('session d\'un superadmin sur l\'hôte d\'administration (CA08)', () => {
  it('should open a session marked admin, valid 8 hours at most, with a cookie that has no Domain attribute', async () => {
    const admin = await creerSuperadmin()

    const reponse = await ouvrirSession(auth, admin.email, 'admin')

    expect(reponse.status).toBe(200)
    const session = await derniereSession(admin.id)
    expect(session.admin).toBe(true)
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(session.createdAt.getTime() + HUIT_HEURES_MS)
    expect(session.expiresAt.getTime()).toBeGreaterThan(session.createdAt.getTime() + 7 * HEURE_MS)
    const cookiesSession = reponse.setCookie.filter((c) => /session_token=/.test(c))
    expect(cookiesSession.length).toBeGreaterThan(0)
    expect(sansDomain(reponse.setCookie)).toBe(true)
    for (const cookie of cookiesSession) expect(cookie).toMatch(/httponly/i)
  })

  it('should not shorten the 8 hours either (the session is usable for a working day)', async () => {
    const admin = await creerSuperadmin()

    await ouvrirSession(auth, admin.email, 'admin')

    const session = await derniereSession(admin.id)
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * HEURE_MS + 50 * MINUTE_MS)
  })

  it('should open a plain 30-day session, not marked admin, for the same superadmin on the public host', async () => {
    const admin = await creerSuperadmin()

    const reponse = await ouvrirSession(auth, admin.email, 'public')

    expect(reponse.status).toBe(200)
    const session = await derniereSession(admin.id)
    expect(session.admin).toBe(false)
    expect(session.expiresAt.getTime()).toBeGreaterThan(session.createdAt.getTime() + 29 * 24 * HEURE_MS)
    expect(sansDomain(reponse.setCookie)).toBe(true)
  })

  it('should reply to get-session on the administration host with the signed-in account', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/get-session', cookie })

    expect(reponse.status).toBe(200)
    expect((reponse.corps?.user as { id?: string } | undefined)?.id).toBe(admin.id)
  })

  it('should remove the session on sign-out (the route kept by the administration whitelist)', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    expect(await lireSessions(admin.id)).toHaveLength(1)

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/sign-out', corps: {}, cookie })

    expect(reponse.status).toBe(200)
    expect(await lireSessions(admin.id)).toHaveLength(0)
  })
})

describe('durée absolue de 8 heures (CA09, CA10)', () => {
  it('should refuse with 404 a session created 8 h 01 ago, even though its expires_at is still in the future, and delete it', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    const session = await derniereSession(admin.id)
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 8 * HEURE_MS - MINUTE_MS), expiresAt: new Date(Date.now() + HEURE_MS) }).where(eq(sessions.id, session.id))

    const resultat = await appelerGarde(evenementAdmin({ cookie }))

    expect(resultat).toMatchObject({ erreur: { statusCode: 404 } })
    expect(await lireSessions(admin.id)).toHaveLength(0)
  })

  it('should still accept a session created 7 h 59 ago (control: the cut is at 8 hours, not before)', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    const session = await derniereSession(admin.id)
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 8 * HEURE_MS + MINUTE_MS), expiresAt: new Date(Date.now() + 2 * MINUTE_MS) }).where(eq(sessions.id, session.id))

    const resultat = await appelerGarde(evenementAdmin({ cookie }))

    expect(resultat).toHaveProperty('contexte')
    expect(await lireSessions(admin.id)).toHaveLength(1)
  })

  it('should keep expires_at at or below created_at + 8 h after get-session refreshed the session', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    const avant = await derniereSession(admin.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/get-session', cookie })

    expect(reponse.status).toBe(200)
    const apres = await derniereSession(admin.id)
    // Preuve que le rafraîchissement a bien eu lieu : sans lui, la borne ci-dessous serait vraie par défaut.
    expect(apres.updatedAt.getTime()).toBeGreaterThan(avant.updatedAt.getTime())
    expect(apres.expiresAt.getTime()).toBeLessThanOrEqual(apres.createdAt.getTime() + HUIT_HEURES_MS)
  })

  it('should keep it capped after several refreshes in a row', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    for (let i = 0; i < 3; i += 1) {
      await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/get-session', cookie })
    }

    const session = await derniereSession(admin.id)
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(session.createdAt.getTime() + HUIT_HEURES_MS)
  })

  it('should return the real end of the session: the nearest of expires_at and created_at + 8 h', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const admin = await creerSuperadmin()
    const proche = await creerSessionAdmin(admin.id, { creeIlYADesHeures: 1, expireDansDesHeures: 2 })
    const lointaine = await creerSessionAdmin(admin.id, { creeIlYADesHeures: 1, expireDansDesHeures: 24 * 30 })

    const courte = await lireSessionAdmin(proche.id)
    const longue = await lireSessionAdmin(lointaine.id)

    expect(courte?.expireLe.getTime()).toBe(proche.expiresAt.getTime())
    expect(longue?.expireLe.getTime()).toBe(lointaine.createdAt.getTime() + HUIT_HEURES_MS)
  })
})

describe('compte suspendu : aucune session, par e-mail comme par téléphone (CA11)', () => {
  it('should answer 403 BANNED_USER with a French message and open no session for a suspended account using an e-mail code', async () => {
    const suspendu = await creerUtilisateurSuspendu()
    await demanderCodeConnexion(auth, suspendu.email, 'public')
    const code = await lireCodeEmail(suspendu.email)

    const reponse = await connecterParCode(auth, suspendu.email, code, 'public')

    expect(reponse.status).toBe(403)
    expect(reponse.corps?.code).toBe('BANNED_USER')
    expect(String(reponse.corps?.message)).toMatch(/suspendu/i)
    expect(String(reponse.corps?.message)).not.toMatch(/banned/i)
    expect(await compterSessions()).toBe(0)
  })

  it('should answer 403 BANNED_USER and open no session for a suspended account using a phone code', async () => {
    const telephone = '+237600000101'
    await creerUtilisateurSuspendu({ phoneNumber: telephone, phoneNumberVerified: true })
    await demanderCodeTelephone(auth, telephone, 'public')
    const code = await lireCodeTelephone(telephone)

    const reponse = await verifierCodeTelephone(auth, telephone, code, 'public')

    expect(reponse.status).toBe(403)
    expect(reponse.corps?.code).toBe('BANNED_USER')
    expect(await compterSessions()).toBe(0)
  })

  it('should let the phone code of a NON suspended account in (control: the refusal above comes from the suspension)', async () => {
    const telephone = '+237600000102'
    await creerUtilisateurOrdinaire({ phoneNumber: telephone, phoneNumberVerified: true })
    await demanderCodeTelephone(auth, telephone, 'public')
    const code = await lireCodeTelephone(telephone)

    const reponse = await verifierCodeTelephone(auth, telephone, code, 'public')

    expect(reponse.status).toBe(200)
    expect(await compterSessions()).toBe(1)
  })

  it('should keep refusing a suspension that has an end date in the future', async () => {
    const suspendu = await creerUtilisateurSuspendu({ banExpires: new Date(Date.now() + 24 * HEURE_MS) })
    await demanderCodeConnexion(auth, suspendu.email, 'public')

    const reponse = await connecterParCode(auth, suspendu.email, await lireCodeEmail(suspendu.email), 'public')

    expect(reponse.status).toBe(403)
    expect(reponse.corps?.code).toBe('BANNED_USER')
    expect(await compterSessions()).toBe(0)
  })

  it('should let an account in once its suspension has ended, and lift the suspension flag', async () => {
    const suspendu = await creerUtilisateurSuspendu({ banExpires: new Date(Date.now() - MINUTE_MS) })
    await demanderCodeConnexion(auth, suspendu.email, 'public')

    const reponse = await connecterParCode(auth, suspendu.email, await lireCodeEmail(suspendu.email), 'public')

    expect(reponse.status).toBe(200)
    const [compte] = await db.select().from(users).where(eq(users.id, suspendu.id))
    expect(compte?.banned).toBe(false)
    expect(compte?.banExpires).toBeNull()
  })

  it('should open no session for a suspended account on the administration host either', async () => {
    const suspendu = await creerSuperadmin({ banned: true, banReason: 'suspension de test' })
    await demanderCodeConnexion(auth, suspendu.email, 'admin')
    await demanderCodeConnexion(auth, suspendu.email, 'public')

    const reponse = await connecterParCode(auth, suspendu.email, await lireCodeEmail(suspendu.email), 'admin')

    expect(reponse.status).toBe(403)
    expect(await compterSessions()).toBe(0)
  })
})

describe('une session ouverte sur le site public ne vaut rien sur l\'hôte d\'administration (CA12, CA02)', () => {
  it('should answer 404 to the cookie of a superadmin session opened on the public host, presented on the administration host', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'public')

    const resultat = await appelerGarde(evenementAdmin({ hote: 'admin', cookie }))

    expect(resultat).toMatchObject({ erreur: { statusCode: 404 } })
    expect((await lireSessions(admin.id))[0]?.admin).toBe(false)
  })

  it('should answer 404 to a valid ADMIN session presented with the public Host header', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const resultat = await appelerGarde(evenementAdmin({ hote: 'public', cookie }))

    expect(resultat).toMatchObject({ erreur: { statusCode: 404 } })
  })

  it('should let a valid admin session through on the administration host (control)', async () => {
    const admin = await creerSuperadmin({ name: 'Administrateur de test' })
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const resultat = await appelerGarde(evenementAdmin({ hote: 'admin', cookie }))

    expect(resultat).toHaveProperty('contexte')
    if (!('contexte' in resultat)) return
    const session = await derniereSession(admin.id)
    expect(resultat.contexte).toMatchObject({ adminId: admin.id, nom: 'Administrateur de test', email: admin.email, sessionId: session.id })
    expect(resultat.contexte.expireLe.getTime()).toBeLessThanOrEqual(session.createdAt.getTime() + HUIT_HEURES_MS)
    expect(typeof resultat.contexte.ip).toBe('string')
  })

  it('should give the exact same 404 body whatever the reason of the refusal (no oracle on hosts, sessions, roles or suspensions)', async () => {
    const { cookie: cookieAdmin } = await ouvrirSession(auth, (await creerSuperadmin()).email, 'admin')
    const { cookie: cookiePublic } = await ouvrirSession(auth, (await creerSuperadmin()).email, 'public')
    const vieux = await creerSuperadmin()
    const { cookie: cookieVieux } = await ouvrirSession(auth, vieux.email, 'admin')
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 9 * HEURE_MS) }).where(eq(sessions.userId, vieux.id))
    const suspendu = await creerSuperadmin()
    const { cookie: cookieSuspendu } = await ouvrirSession(auth, suspendu.email, 'admin')
    await db.update(users).set({ banned: true }).where(eq(users.id, suspendu.id))
    const retrograde = await creerSuperadmin()
    const { cookie: cookieRetrograde } = await ouvrirSession(auth, retrograde.email, 'admin')
    await db.update(users).set({ role: 'user' }).where(eq(users.id, retrograde.id))

    const cas = {
      'aucun cookie': evenementAdmin({}),
      'cookie inventé': evenementAdmin({ cookie: 'better-auth.session_token=invente.signature-inventee' }),
      'session ouverte sur le site public': evenementAdmin({ cookie: cookiePublic }),
      'hôte public': evenementAdmin({ hote: 'public', cookie: cookieAdmin }),
      'hôte absent': evenementAdmin({ hote: 'public', cookie: cookieAdmin, entetes: { host: '' } }),
      'plus de 8 heures': evenementAdmin({ cookie: cookieVieux }),
      'compte suspendu depuis': evenementAdmin({ cookie: cookieSuspendu }),
      'rôle retiré depuis': evenementAdmin({ cookie: cookieRetrograde }),
      'écriture d\'une autre origine': evenementAdmin({ methode: 'POST', cookie: cookieAdmin, origine: 'http://localhost:3000' }),
    }

    const erreurs = new Map<string, unknown>()
    for (const [nom, evenement] of Object.entries(cas)) {
      const resultat = await appelerGarde(evenement)
      expect(resultat, nom).toHaveProperty('erreur')
      if ('erreur' in resultat) erreurs.set(nom, resultat.erreur)
    }

    expect(new Set([...erreurs.values()].map((e) => JSON.stringify(e))).size).toBe(1)
    expect([...erreurs.values()][0]).toMatchObject({ statusCode: 404, message: 'Not Found' })
  })

  it('should refuse a write whose Origin is another host, and accept the same write from the administration origin or without Origin', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const autreOrigine = await appelerGarde(evenementAdmin({ methode: 'POST', cookie, origine: 'http://localhost:3000' }))
    const memeOrigine = await appelerGarde(evenementAdmin({ methode: 'POST', cookie }))
    const sansOrigine = await appelerGarde(evenementAdmin({ methode: 'POST', cookie, origine: null }))
    const lecture = await appelerGarde(evenementAdmin({ methode: 'GET', cookie, origine: 'http://localhost:3000' }))

    expect(autreOrigine).toHaveProperty('erreur')
    expect(memeOrigine).toHaveProperty('contexte')
    expect(sansOrigine).toHaveProperty('contexte')
    expect(lecture).toHaveProperty('contexte')
  })

  it('should never trust X-Forwarded-Host: only the Host header decides', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const resultat = await appelerGarde(evenementAdmin({ hote: 'public', cookie, entetes: { 'x-forwarded-host': 'admin.localhost' } }))

    expect(resultat).toHaveProperty('erreur')
  })
})

describe('lireSessionAdmin : la garde relit la base, le jeton ne fait pas foi (CA09, CA12)', () => {
  const MAINTENANT = new Date('2026-11-14T12:00:00.000Z')

  async function session(options: Parameters<typeof creerSessionAdmin>[1] & { surcharges?: Partial<typeof users.$inferInsert> } = {}) {
    const admin = await creerSuperadmin(options.surcharges)
    const ligne = await creerSessionAdmin(admin.id, options)
    return { admin, ligne }
  }

  it('should return the administrator and the session of a valid admin session', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session({ creeIlYADesHeures: 1 })

    const lue = await lireSessionAdmin(ligne.id)

    expect(lue).toMatchObject({ adminId: admin.id, email: admin.email, sessionId: ligne.id })
  })

  it('should prefer the application name, then the account name, then a neutral fallback', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const avecNom = await session({ surcharges: { nom: 'Nom applicatif', name: 'Nom du compte' } })
    const sansNom = await session({ surcharges: { nom: '', name: 'Nom du compte' } })
    const anonyme = await session({ surcharges: { nom: '', name: '' } })

    expect((await lireSessionAdmin(avecNom.ligne.id))?.nom).toBe('Nom applicatif')
    expect((await lireSessionAdmin(sansNom.ligne.id))?.nom).toBe('Nom du compte')
    expect((await lireSessionAdmin(anonyme.ligne.id))?.nom).toBe('Administrateur')
  })

  it('should refuse and DELETE a session older than 8 hours', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session({ creeIlYADesHeures: 8 + 1 / 60 })

    expect(await lireSessionAdmin(ligne.id)).toBeNull()
    expect(await lireSessions(admin.id)).toHaveLength(0)
  })

  it('should accept a session just under 8 hours and refuse it at exactly 8 hours (injected clock)', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { ligne } = await session({ creeIlYADesHeures: 0 })
    const creee = ligne.createdAt.getTime()

    expect(await lireSessionAdmin(ligne.id, new Date(creee + HUIT_HEURES_MS - 1))).not.toBeNull()
    expect(await lireSessionAdmin(ligne.id, new Date(creee + HUIT_HEURES_MS))).toBeNull()
  })

  it('should refuse a session that is not marked admin, and KEEP it (it is a legitimate public session)', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session({ admin: false })

    expect(await lireSessionAdmin(ligne.id)).toBeNull()
    expect(await lireSessions(admin.id)).toHaveLength(1)
  })

  it('should refuse an admin session of an account that is no longer a superadmin', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session()
    await db.update(users).set({ role: 'user' }).where(eq(users.id, admin.id))

    expect(await lireSessionAdmin(ligne.id)).toBeNull()
  })

  it('should refuse an admin session flagged on an account that never was a superadmin', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const ordinaire = await creerUtilisateurOrdinaire()
    const ligne = await creerSessionAdmin(ordinaire.id, { admin: true })

    expect(await lireSessionAdmin(ligne.id)).toBeNull()
  })

  it('should refuse an admin session of a suspended account, with or without an end date in the future', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const sansTerme = await session()
    await db.update(users).set({ banned: true }).where(eq(users.id, sansTerme.admin.id))
    const avecTerme = await session()
    await db.update(users).set({ banned: true, banExpires: new Date(MAINTENANT.getTime() + HEURE_MS) }).where(eq(users.id, avecTerme.admin.id))

    expect(await lireSessionAdmin(sansTerme.ligne.id, MAINTENANT)).toBeNull()
    expect(await lireSessionAdmin(avecTerme.ligne.id, MAINTENANT)).toBeNull()
  })

  it('should stop treating a suspension as active once its end date has passed', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session()
    await db.update(users).set({ banned: true, banExpires: new Date(MAINTENANT.getTime() - HEURE_MS) }).where(eq(users.id, admin.id))

    expect(await lireSessionAdmin(ligne.id, MAINTENANT)).not.toBeNull()
  })

  it('should refuse a session whose own expires_at has passed, even if it is young', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const { ligne } = await session({ creeIlYADesHeures: 1, expireDansDesHeures: -0.01 })

    expect(await lireSessionAdmin(ligne.id)).toBeNull()
  })

  it('should answer null for an unknown session', async () => {
    const { lireSessionAdmin } = await sessionAdminService()

    expect(await lireSessionAdmin('session-qui-n-existe-pas')).toBeNull()
  })

  it('should delete a session idempotently', async () => {
    const { supprimerSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session()

    await supprimerSessionAdmin(ligne.id)
    await supprimerSessionAdmin(ligne.id)

    expect(await lireSessions(admin.id)).toHaveLength(0)
  })

  it('should only ever delete the session it was asked about', async () => {
    const { supprimerSessionAdmin } = await sessionAdminService()
    const { admin, ligne } = await session()
    const autre = await creerSessionAdmin(admin.id)

    await supprimerSessionAdmin(ligne.id)

    expect((await lireSessions(admin.id)).map((s) => s.id)).toEqual([autre.id])
  })

  it('should not touch a session of another account when one expires', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const vieille = await session({ creeIlYADesHeures: 9 })
    const jeune = await session({ creeIlYADesHeures: 1 })

    await lireSessionAdmin(vieille.ligne.id)

    expect(await db.select({ n: sql<number>`count(*)::int` }).from(sessions)).toEqual([{ n: 1 }])
    expect(await lireSessions(jeune.admin.id)).toHaveLength(1)
  })
})

describe('plugin admin() de Better Auth : aucune écriture par ses routes (D-A1-03, défense en profondeur)', () => {
  it('should answer 404 to impersonate-user (disabled path) even with a superadmin session', async () => {
    const admin = await creerSuperadmin()
    const cible = await creerUtilisateurOrdinaire()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/impersonate-user', corps: { userId: cible.id }, cookie })

    expect(reponse.status).toBe(404)
    expect(await compterSessions()).toBe(1)
  })

  it('should answer 404 to stop-impersonating (disabled path)', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/stop-impersonating', corps: {}, cookie })

    expect(reponse.status).toBe(404)
  })

  it('should refuse set-role to a superadmin (he holds NO permission of the plugin) and leave the role unchanged', async () => {
    const admin = await creerSuperadmin()
    const cible = await creerUtilisateurOrdinaire()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const reponse = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/set-role', corps: { userId: cible.id, role: 'superadmin' }, cookie })

    expect(reponse.status).toBeGreaterThanOrEqual(400)
    expect(reponse.status).toBeLessThan(500)
    const [relu] = await db.select({ role: users.role }).from(users).where(eq(users.id, cible.id))
    expect(relu?.role).toBe('user')
  })

  it('should refuse ban-user, remove-user and create-user to a superadmin: nothing is written outside our journalled services', async () => {
    const admin = await creerSuperadmin()
    const cible = await creerUtilisateurOrdinaire()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')

    const bannir = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/ban-user', corps: { userId: cible.id }, cookie })
    const supprimer = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/remove-user', corps: { userId: cible.id }, cookie })
    const creer = await appelerAuth(auth, { hote: 'admin', chemin: '/api/auth/admin/create-user', corps: { email: 'cree-par-le-plugin@exemple.test', password: 'un-mot-de-passe-assez-long', name: 'X', role: 'superadmin' }, cookie })

    for (const reponse of [bannir, supprimer, creer]) {
      expect(reponse.status).toBeGreaterThanOrEqual(400)
      expect(reponse.status).toBeLessThan(500)
    }
    const [relu] = await db.select().from(users).where(eq(users.id, cible.id))
    expect(relu).toMatchObject({ banned: false, role: 'user' })
    expect(await db.select().from(users).where(eq(users.email, 'cree-par-le-plugin@exemple.test'))).toHaveLength(0)
  })

  it('should refuse set-role to an ordinary account trying to promote itself', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    const { cookie } = await ouvrirSession(auth, ordinaire.email, 'public')

    const reponse = await appelerAuth(auth, { hote: 'public', chemin: '/api/auth/admin/set-role', corps: { userId: ordinaire.id, role: 'superadmin' }, cookie })

    expect(reponse.status).toBeGreaterThanOrEqual(400)
    const [relu] = await db.select({ role: users.role }).from(users).where(eq(users.id, ordinaire.id))
    expect(relu?.role).toBe('user')
  })

  it('should not let an ordinary account give itself the superadmin role through update-user', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()
    const { cookie } = await ouvrirSession(auth, ordinaire.email, 'public')

    await appelerAuth(auth, { hote: 'public', chemin: '/api/auth/update-user', corps: { role: 'superadmin', banned: false }, cookie })

    const [relu] = await db.select({ role: users.role }).from(users).where(eq(users.id, ordinaire.id))
    expect(relu?.role).toBe('user')
  })
})

describe('session ordinaire de plus de 8 h : 404 sans suppression (MINOR a)', () => {
  it('should refuse an ordinary session older than 8 h on the administration host and KEEP it', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const admin = await creerSuperadmin()
    const ordinaire = await creerSessionAdmin(admin.id, { admin: false, creeIlYADesHeures: 9 })

    expect(await lireSessionAdmin(ordinaire.id)).toBeNull()
    expect(await lireSessions(admin.id)).toHaveLength(1)
  })

  it('should keep a superadmin session opened on the public host and aged 9 h when it is presented on the administration host', async () => {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'public')
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 9 * HEURE_MS) }).where(eq(sessions.userId, admin.id))

    const resultat = await appelerGarde(evenementAdmin({ cookie }))

    expect(resultat).toMatchObject({ erreur: { statusCode: 404 } })
    expect(await lireSessions(admin.id)).toHaveLength(1)
  })

  it('should still delete an ADMIN session older than 8 h (contrast)', async () => {
    const { lireSessionAdmin } = await sessionAdminService()
    const admin = await creerSuperadmin()
    const vieille = await creerSessionAdmin(admin.id, { admin: true, creeIlYADesHeures: 9 })

    expect(await lireSessionAdmin(vieille.id)).toBeNull()
    expect(await lireSessions(admin.id)).toHaveLength(0)
  })
})

describe('contrôle de l\'Origin des écritures (MINOR b)', () => {
  async function verdict(options: Parameters<typeof evenementAdmin>[0]): Promise<'passe' | 'refuse'> {
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    const resultat = await appelerGarde(evenementAdmin({ methode: 'POST', cookie, ...options }))
    return 'contexte' in resultat ? 'passe' : 'refuse'
  }

  it('should accept the exact administration origin, and an absent Origin', async () => {
    expect(await verdict({})).toBe('passe')
    expect(await verdict({ origine: null })).toBe('passe')
  })

  it.each([
    ['schéma différent', 'https://admin.localhost:3000'],
    ['port différent', 'http://admin.localhost:3001'],
    ['port absent', 'http://admin.localhost'],
    ['hôte public', 'http://localhost:3000'],
    ['hôte voisin', 'http://admin.localhost.evil.test:3000'],
    ['origine « null »', 'null'],
    ['origine illisible', 'pas-une-origine'],
  ])('should refuse an Origin with a %s (%s)', async (_cas, origine) => {
    expect(await verdict({ origine })).toBe('refuse')
  })

  it('should refuse Sec-Fetch-Site: cross-site even with the right Origin, and accept same-origin and same-site', async () => {
    expect(await verdict({ entetes: { 'sec-fetch-site': 'cross-site' } })).toBe('refuse')
    expect(await verdict({ entetes: { 'sec-fetch-site': 'same-origin' } })).toBe('passe')
    expect(await verdict({ entetes: { 'sec-fetch-site': 'same-site' } })).toBe('passe')
  })

  it('should refuse Sec-Fetch-Site: cross-site even without Origin', async () => {
    expect(await verdict({ origine: null, entetes: { 'sec-fetch-site': 'cross-site' } })).toBe('refuse')
  })
})

describe('route attrape-tout /api/admin/** : aucun oracle d\'existence de route (MINOR c)', () => {
  async function corpsDe(handler: (event: ReturnType<typeof evenementAdmin>) => unknown, event: ReturnType<typeof evenementAdmin>): Promise<string> {
    try {
      await handler(event)
    } catch (erreur) {
      const e = erreur as { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }
      return JSON.stringify({ s: e.statusCode, m: e.statusMessage, t: e.message, d: e.data })
    }
    return 'REPONSE_SANS_ERREUR'
  }

  it('should answer the same uniform 404 to a superadmin on an unknown route, and to a non-admin on an unknown or existing route', async () => {
    const attrape = (await import('../../../server/api/admin/[...]')).default as unknown as (e: ReturnType<typeof evenementAdmin>) => unknown
    const session = (await import('../../../server/api/admin/session.get')).default as unknown as (e: ReturnType<typeof evenementAdmin>) => unknown
    const admin = await creerSuperadmin()
    const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
    const ordinaire = await ouvrirSession(auth, (await creerUtilisateurOrdinaire()).email, 'public')

    const corps = await Promise.all([
      corpsDe(attrape, evenementAdmin({ cookie })),
      corpsDe(attrape, evenementAdmin({})),
      corpsDe(attrape, evenementAdmin({ cookie: ordinaire.cookie })),
      corpsDe(session, evenementAdmin({})),
      corpsDe(session, evenementAdmin({ cookie: ordinaire.cookie })),
    ])

    expect(new Set(corps).size).toBe(1)
    expect(JSON.parse(corps[0]!)).toMatchObject({ s: 404, t: 'Not Found' })
  })
})

describe('hôte lu dans request.url quand l\'en-tête Host manque (MINOR e)', () => {
  async function demander(email: string, url: string) {
    const instance = await creerAuth()
    return instance.handler(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ email, type: 'sign-in' }),
    }))
  }

  it('should treat a request without Host header whose URL is on the administration host as admin: no code for an ordinary account', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()

    const reponse = await demander(ordinaire.email, 'http://admin.localhost:3000/api/auth/email-otp/send-verification-otp')

    expect(reponse.status).toBe(200)
    expect(await jobsConnexionApresDelai(ordinaire.email)).toHaveLength(0)
  })

  it('should treat the same request on the public URL as public: the code is sent (control)', async () => {
    const ordinaire = await creerUtilisateurOrdinaire()

    await demander(ordinaire.email, 'http://localhost:3000/api/auth/email-otp/send-verification-otp')

    expect(await attendreJobsConnexion(ordinaire.email)).toHaveLength(1)
  })
})
