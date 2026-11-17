import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import {
  purgerOauth,
  purgerClientsOauthOrphelins,
} from '../../server/services/oauth-purge'
import {
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from '../../shared/db/schema'
import { OAUTH_CLIENT_ORPHELIN_JOURS, OAUTH_PURGE_LOT } from '../../shared/mcp'
import { JOUR_MS } from '../../shared/temps'
import { createUser } from './support/fabriques'

// Vrai PostgreSQL : on prouve la suppression (et la conservation) en SQL, y compris les cascades.

const MAINTENANT = new Date('2026-11-09T04:00:00.000Z')
const ilYa = (jours: number) => new Date(MAINTENANT.getTime() - jours * JOUR_MS)
const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR_MS)

beforeEach(async () => {
  // Les clients dynamiques n'ont pas de user_id : le TRUNCATE ... CASCADE de users ne les atteint pas.
  await db.delete(oauthClients)
  await db.delete(oauthClientAssertions)
})

async function client(ageJours: number): Promise<string> {
  const clientId = randomUUID()
  await db.insert(oauthClients).values({ id: randomUUID(), clientId, redirectUris: ['https://exemple.com/cb'], createdAt: ilYa(ageJours) })
  return clientId
}

async function consentement(clientId: string): Promise<void> {
  const user = await createUser()
  await db.insert(oauthConsents).values({ id: randomUUID(), clientId, userId: user.id, scopes: ['vitrine:lecture'] })
}

async function jetonAcces(clientId: string, expiresAt: Date, revoked: Date | null = null): Promise<string> {
  const id = randomUUID()
  await db.insert(oauthAccessTokens).values({ id, token: randomUUID(), clientId, scopes: ['vitrine:lecture'], expiresAt, revoked })
  return id
}

async function jetonRenouvellement(clientId: string, expiresAt: Date): Promise<string> {
  const user = await createUser()
  const id = randomUUID()
  await db.insert(oauthRefreshTokens).values({ id, token: randomUUID(), clientId, userId: user.id, scopes: ['offline_access'], expiresAt })
  return id
}

const clientsRestants = async () => (await db.select({ clientId: oauthClients.clientId }).from(oauthClients)).map((c) => c.clientId)

describe('purge des clients OAuth orphelins', () => {
  it('should delete an old client without consent nor token', async () => {
    const vieux = await client(OAUTH_CLIENT_ORPHELIN_JOURS + 1)

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(1)
    expect(await clientsRestants()).not.toContain(vieux)
  })

  it('should keep a recent client', async () => {
    const recent = await client(OAUTH_CLIENT_ORPHELIN_JOURS - 1)

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(0)
    expect(await clientsRestants()).toEqual([recent])
  })

  it('should keep an old client that has a consent, with its consent', async () => {
    const consenti = await client(60)
    await consentement(consenti)

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(0)
    expect(await clientsRestants()).toEqual([consenti])
    expect(await db.select().from(oauthConsents).where(eq(oauthConsents.clientId, consenti))).toHaveLength(1)
  })

  it('should keep an old client that still has an active access token or refresh token', async () => {
    const avecAcces = await client(60)
    await jetonAcces(avecAcces, dans(1))
    const avecRenouvellement = await client(60)
    await jetonRenouvellement(avecRenouvellement, dans(10))

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(0)
    expect((await clientsRestants()).sort()).toEqual([avecAcces, avecRenouvellement].sort())
  })

  it('should delete an old consentless client whose only tokens are expired or revoked, with them (cascade)', async () => {
    const vieux = await client(60)
    await jetonAcces(vieux, ilYa(10))
    await jetonAcces(vieux, dans(1), ilYa(1))

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(1)
    expect(await clientsRestants()).toEqual([])
    expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.clientId, vieux))).toHaveLength(0)
  })

  it('should be idempotent and bounded per pass', async () => {
    const total = OAUTH_PURGE_LOT + 3
    await db.insert(oauthClients).values(
      Array.from({ length: total }, () => ({ id: randomUUID(), clientId: randomUUID(), redirectUris: ['https://exemple.com/cb'], createdAt: ilYa(30) })),
    )

    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(OAUTH_PURGE_LOT)
    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(3)
    expect(await purgerClientsOauthOrphelins(MAINTENANT)).toBe(0)
  })
})

describe('purgerOauth : passage complet', () => {
  it('should delete expired assertions and expired tokens but keep valid ones and consents', async () => {
    await db.insert(oauthClientAssertions).values([
      { id: 'jti-expire', expiresAt: ilYa(1) },
      { id: 'jti-valide', expiresAt: dans(1) },
    ])
    const consenti = await client(60)
    await consentement(consenti)
    const accesExpire = await jetonAcces(consenti, ilYa(5))
    const accesValide = await jetonAcces(consenti, dans(1))
    const renouvExpire = await jetonRenouvellement(consenti, ilYa(5))
    const renouvValide = await jetonRenouvellement(consenti, dans(20))
    const recentExpireDepuisPeu = await jetonAcces(consenti, new Date(MAINTENANT.getTime() - 60_000))

    const bilan = await purgerOauth(MAINTENANT)

    expect(bilan.assertions).toBe(1)
    expect((await db.select({ id: oauthClientAssertions.id }).from(oauthClientAssertions)).map((a) => a.id)).toEqual(['jti-valide'])
    const acces = (await db.select({ id: oauthAccessTokens.id }).from(oauthAccessTokens)).map((t) => t.id)
    expect(acces).not.toContain(accesExpire)
    expect(acces).toEqual(expect.arrayContaining([accesValide, recentExpireDepuisPeu]))
    const renouv = (await db.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens).where(inArray(oauthRefreshTokens.id, [renouvExpire, renouvValide]))).map((t) => t.id)
    expect(renouv).toEqual([renouvValide])
    expect(await clientsRestants()).toEqual([consenti])
    expect(await db.select().from(oauthConsents)).toHaveLength(1)
  })
})
