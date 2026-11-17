import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MCP_PORTEES } from '../../../shared/mcp'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import {
  MOTIF_SUSPENSION,
  appelerA2,
  codeReauthPour,
  issue,
  poserAssistant,
  reactiverEnBase,
  suspendreEnBase,
  viderClientsOauth,
} from '../support/admin-a2'
import { creerAbonne } from '../support/abonnements'

// A2 CA03 : un jeton MCP émis AVANT la suspension est refusé à l'appel suivant, même non expiré. Un jeton d'accès JWT n'a
// pas de ligne en base : seule la lecture de `users.suspendu` à CHAQUE appel le neutralise. Limite assumée : le
// transport HTTP (`requireMcpAuth`, MCP_ACTIF=false par défaut, JWT signé) n'est pas rejoué ici ; le serveur MCP RÉEL
// est branché sur un transport mémoire avec l'identité d'un jeton « déjà vérifié » (userId, assistantId, portées),
// exactement ce que `gererRequeteMcp` lui transmet. Les gardes et les services sont réels, la base aussi.

const suite = preparerSuiteAdmin()
const mcpAuth = () => import('../../../server/mcp/auth')

beforeEach(async () => {
  await viderClientsOauth()
})

async function connecter(userId: string, assistantId: string = `assistant-${randomUUID()}`) {
  const { creerServeurMcp } = await import('../../../server/mcp/server')
  const serveur = creerServeurMcp({ userId, assistantId, scopes: MCP_PORTEES })
  const [cote1, cote2] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'test-a2', version: '1.0.0' })
  await Promise.all([serveur.connect(cote1), mcp.connect(cote2)])
  return mcp
}

async function appeler(mcp: Client, nom: string): Promise<{ erreur: boolean, texte: string }> {
  try {
    const reponse = await mcp.callTool({ name: nom, arguments: {} }) as { isError?: boolean, content: Array<{ type: string, text: string }> }
    return { erreur: reponse.isError === true, texte: reponse.content.map((c) => c.text).join('\n') }
  } catch (erreur) {
    return { erreur: true, texte: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}

async function lignesJournalAssistant(userId: string): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM journal_assistant WHERE user_id = ${userId}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

describe('serveur MCP et suspension (CA03)', () => {
  it('should answer a tool call before the suspension (control), refuse the SAME connection right after it, and serve it again once reactivated', async () => {
    const pro = await creerAbonne('actif')
    const mcp = await connecter(pro.user.id)
    const avant = await appeler(mcp, 'obtenir_agenda')
    expect(avant.erreur, `témoin : ${avant.texte}`).toBe(false)

    await suspendreEnBase(pro.user.id)
    const pendant = await appeler(mcp, 'obtenir_agenda')
    await reactiverEnBase(pro.user.id)
    const apres = await appeler(mcp, 'obtenir_agenda')

    expect(pendant.erreur).toBe(true)
    expect(pendant.texte).not.toContain(pro.vitrine.username)
    expect(pendant.texte).not.toContain(MOTIF_SUSPENSION)
    expect(apres.erreur, apres.texte).toBe(false)
  })

  it('should refuse every tool that answers an active account with no argument (control), not only the agenda', async () => {
    const { OUTILS_MCP } = await import('../../../server/mcp/tools')
    const actif = await creerAbonne('actif')
    const suspendu = await creerAbonne('actif')
    await suspendreEnBase(suspendu.user.id)
    const mcpActif = await connecter(actif.user.id)
    const mcpSuspendu = await connecter(suspendu.user.id)
    let controles = 0

    for (const outil of OUTILS_MCP) {
      const temoin = await appeler(mcpActif, outil.nom)
      if (temoin.erreur) continue
      controles += 1
      expect((await appeler(mcpSuspendu, outil.nom)).erreur, outil.nom).toBe(true)
    }

    expect(controles).toBeGreaterThanOrEqual(3)
    expect(await lignesJournalAssistant(suspendu.user.id)).toBe(0)
  })

  it('should refuse the connection of a token issued before the suspension through the real admin action too', async () => {
    const { admin, cookie } = await ouvrirAdmin(suite.auth())
    const pro = await creerAbonne('actif')
    await poserAssistant(pro.user.id)
    const mcp = await connecter(pro.user.id)
    expect((await appeler(mcp, 'obtenir_agenda')).erreur).toBe(false)

    const reponse = await appelerA2('suspendre', { id: pro.user.id, cookie, reauth: await codeReauthPour(admin.id, 'suspendre', pro.user.id), corps: { motif: MOTIF_SUSPENSION } })

    expect(reponse.status).toBe(200)
    expect((await appeler(mcp, 'obtenir_agenda')).erreur).toBe(true)
  })

  it('should not suspend the MCP of another account', async () => {
    const suspendu = await creerAbonne('actif')
    const autre = await creerAbonne('actif')
    await suspendreEnBase(suspendu.user.id)
    const mcp = await connecter(autre.user.id)

    expect((await appeler(mcp, 'obtenir_agenda')).erreur).toBe(false)
  })
})

describe('gardes d\'autorisation MCP lues à chaque appel (server/mcp/auth.ts)', () => {
  it('should refuse verifierPlanPayant and resoudreVitrine with a 403 for a suspended paid account, and accept them when active (control)', async () => {
    const { verifierPlanPayant, resoudreVitrine } = await mcpAuth()
    const pro = await creerAbonne('actif')
    expect(await issue(verifierPlanPayant(pro.user.id))).toEqual({ ok: true })
    expect(await issue(resoudreVitrine(pro.user.id))).toEqual({ ok: true })

    await suspendreEnBase(pro.user.id)

    expect(await issue(verifierPlanPayant(pro.user.id))).toMatchObject({ ok: false, status: 403 })
    expect(await issue(resoudreVitrine(pro.user.id))).toMatchObject({ ok: false, status: 403 })
  })

  it('should fail closed for an account that no longer exists (a token outliving a deletion opens nothing)', async () => {
    const { verifierPlanPayant, resoudreVitrine } = await mcpAuth()
    const inconnu = '00000000-0000-4000-8000-000000000000'

    expect((await issue(verifierPlanPayant(inconnu))).ok).toBe(false)
    expect((await issue(resoudreVitrine(inconnu))).ok).toBe(false)
  })

  it('should resolve no scope after the REAL suspension (consent deleted), whatever the unexpired token claims', async () => {
    const { admin, cookie } = await ouvrirAdmin(suite.auth())
    const { résoudrePortées } = await mcpAuth()
    const pro = await creerAbonne('actif')
    const a = await poserAssistant(pro.user.id, { scopes: ['vitrine:lecture'] })
    const identite = { userId: pro.user.id, clientId: a.clientId, portéesJeton: ['vitrine:lecture'] }
    expect(await résoudrePortées(identite)).toEqual(['vitrine:lecture'])

    await appelerA2('suspendre', { id: pro.user.id, cookie, reauth: await codeReauthPour(admin.id, 'suspendre', pro.user.id), corps: { motif: MOTIF_SUSPENSION } })

    expect(await résoudrePortées(identite)).toBeNull()
  })
})
