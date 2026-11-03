import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { describe, expect, it } from 'vitest'
import { users, verifications, vitrines } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { insertVitrineRow } from './support/fabriques'

// CA49, #96 : le point d'entrée Better Auth `update-user` ne doit permettre de modifier ni le fuseau, ni la locale,
// ni la devise, ni le nom applicatif, ni les préférences d'e-mail : seul `PUT /api/studio/moi` (Zod, synchronisation du
// fuseau avec la vitrine) écrit ces champs. L'instance est construite avec les MÊMES options que l'application
// (`optionsAuth`), sur la base PostgreSQL réelle ; la session est ouverte par le vrai parcours OTP e-mail
// (code lu en base, stockage en clair hors production), comme e2e/helpers/session.ts.

const SECRET = process.env.NUXT_BETTER_AUTH_SECRET ?? ''
const LONGUEUR_CODE = 6

async function creerAuth() {
  const { optionsAuth } = await import('../../server/auth.config')
  return betterAuth({ ...optionsAuth, secret: SECRET, baseURL: 'http://localhost:3000', basePath: '/api/auth' })
}

/** Ouvre une session réelle pour une adresse neuve et renvoie l'en-tête Cookie ainsi que l'identifiant du compte. */
async function ouvrirSession(auth: Awaited<ReturnType<typeof creerAuth>>) {
  const email = `auth-${randomUUID()}@exemple.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  const [verification] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, `sign-in-otp-${email}`))
    .orderBy(desc(verifications.createdAt))
    .limit(1)
  const otp = verification?.value.split(':')[0]
  if (!otp || otp.length !== LONGUEUR_CODE) throw new Error('Code OTP introuvable en base.')
  const { headers } = await auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true })
  const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const [compte] = await db.select().from(users).where(eq(users.email, email))
  if (!compte) throw new Error('Compte non créé par la connexion OTP.')
  return { cookie, userId: compte.id, email }
}

async function lire(userId: string) {
  const [ligne] = await db.select().from(users).where(eq(users.id, userId))
  return ligne!
}

describe('Better Auth update-user : champs applicatifs fermés (CA49)', () => {
  it('should accept a legitimate profile field through the same session (control: the session is real and authenticated)', async () => {
    const auth = await creerAuth()
    const { cookie, userId } = await ouvrirSession(auth)

    await auth.api.updateUser({ headers: new Headers({ cookie }), body: { name: 'Nouveau nom' } })

    expect((await lire(userId)).name).toBe('Nouveau nom')
  })

  it('should change neither the timezone nor the e-mail preference when update-user is called with them', async () => {
    const auth = await creerAuth()
    const { cookie, userId } = await ouvrirSession(auth)
    const avant = await lire(userId)

    await Promise.resolve(auth.api.updateUser({
      headers: new Headers({ cookie }),
      body: { fuseau: 'Mars/Olympus', email_hebdo: false } as never,
    })).catch(() => undefined)

    const apres = await lire(userId)
    expect(apres.fuseau).toBe(avant.fuseau)
    expect(apres.fuseau).not.toBe('Mars/Olympus')
    expect(apres.email_hebdo).toBe(avant.email_hebdo)
  })

  it.each([
    ['nom', 'Nom injecté'],
    ['locale', 'xx'],
    ['devise', 'GBP'],
    ['fuseau', 'Europe/Paris'],
    ['email_hebdo', false],
    ['email_rappel_jour', false],
  ])('should ignore or refuse the application field "%s" sent through update-user (nothing written)', async (champ, valeur) => {
    const auth = await creerAuth()
    const { cookie, userId } = await ouvrirSession(auth)
    const avant = await lire(userId)

    await Promise.resolve(auth.api.updateUser({ headers: new Headers({ cookie }), body: { [champ]: valeur } as never })).catch(() => undefined)

    const apres = await lire(userId)
    expect({ nom: apres.nom, locale: apres.locale, devise: apres.devise, fuseau: apres.fuseau, email_hebdo: apres.email_hebdo, email_rappel_jour: apres.email_rappel_jour })
      .toEqual({ nom: avant.nom, locale: avant.locale, devise: avant.devise, fuseau: avant.fuseau, email_hebdo: avant.email_hebdo, email_rappel_jour: avant.email_rappel_jour })
  })

  it('should keep the vitrine timezone and the user timezone in step: update-user cannot desynchronize them', async () => {
    const auth = await creerAuth()
    const { cookie, userId } = await ouvrirSession(auth)
    const vitrine = await insertVitrineRow(userId, { username: `auth-${randomUUID().slice(0, 8)}` })

    await Promise.resolve(auth.api.updateUser({ headers: new Headers({ cookie }), body: { fuseau: 'America/New_York' } as never })).catch(() => undefined)

    const [apres] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    expect((await lire(userId)).fuseau).toBe(apres?.fuseau)
  })
})
