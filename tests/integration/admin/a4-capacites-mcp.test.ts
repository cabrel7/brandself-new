import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { MCP_PORTEES } from '../../../shared/mcp'
import { schemaCapaciteReponse } from '../../../shared/schemas/admin-a4'
import { compterJournal, demanderEtLireCode, journalDe, ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import { MOTIF_A4, appelerA4, poserReglage, reinitialiserA4 } from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'
import { creerAbonne } from '../support/abonnements'
import { rejet } from '../support/erreurs'

// A4 CA15 (D-A4-11) : `mcp.actif` est la coupure GLOBALE ; la capacité `mcp` d'un COMPTE est lue ensuite à chaque appel. Un compte
// gratuit sans capacité est refusé (consentement et outils) ; capacité accordée par l'administration (route réelle, réauthentifiée,
// journalisée) puis révoquée : accès, puis refus aussitôt (la spec tolère 10 s). Serveur MCP, gardes, PlanService, base et journal
// RÉELS (transport mémoire, comme a2-mcp.test.ts : le transport HTTP et le JWT ne sont pas rejoués). Aucun autre compte n'est touché.

const suite = preparerSuiteAdmin()
let connecte: AdminA4
const consentement = () => import('../../../server/mcp/consentement')

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
  await poserReglage('mcp.actif', true, connecte.admin.id)
})

async function connecter(userId: string) {
  const { creerServeurMcp } = await import('../../../server/mcp/server')
  const serveur = creerServeurMcp({ userId, assistantId: `assistant-${randomUUID()}`, scopes: MCP_PORTEES })
  const [cote1, cote2] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'test-a4', version: '1.0.0' })
  await Promise.all([serveur.connect(cote1), mcp.connect(cote2)])
  return mcp
}

async function outilRefuse(mcp: Client): Promise<boolean> {
  try {
    const reponse = await mcp.callTool({ name: 'obtenir_agenda', arguments: {} }) as { isError?: boolean }
    return reponse.isError === true
  } catch {
    return true
  }
}

const accorder = async (userId: string, surcharges: { corps?: unknown, reauth?: string | null, cle?: string } = {}) => {
  const reauth = surcharges.reauth === undefined
    ? (await demanderEtLireCode(connecte.admin.id, { action: ADMIN_ACTIONS.capaciteAccorder, cibleType: 'utilisateur', cibleId: userId })).code
    : surcharges.reauth
  return appelerA4('capaciteAccorder', {
    params: { id: userId },
    cookie: connecte.cookie,
    ...(reauth === null ? {} : { reauth }),
    cleIdempotenceEntete: surcharges.cle ?? `cle-${randomUUID()}`,
    corps: surcharges.corps ?? { capacite: 'mcp', motif: MOTIF_A4 },
  })
}

const revoquer = (userId: string) =>
  appelerA4('capaciteRevoquer', { params: { id: userId, capacite: 'mcp' }, cookie: connecte.cookie, corps: { motif: MOTIF_A4 } })

describe('capacité mcp accordée par l\'administration (CA15)', () => {
  it('should refuse a free account without capacity, open consent and tools once granted, and refuse again right after the revocation, without touching another account', async () => {
    const { exigerPlanPayantPourConsentement } = await consentement()
    const compte = await creerAbonne('gratuit')
    const autre = await creerAbonne('gratuit')
    const mcp = await connecter(compte.user.id)
    const mcpAutre = await connecter(autre.user.id)
    expect(await outilRefuse(mcp), 'témoin : sans capacité').toBe(true)
    expect(await rejet(exigerPlanPayantPourConsentement(compte.user.id))).toMatchObject({ code: 'PLAN_PAYANT_REQUIS' })

    const octroi = await accorder(compte.user.id)

    expect(octroi.status).toBe(200)
    expect(schemaCapaciteReponse.parse(octroi.corps)).toMatchObject({ rejoue: false, capacite: { utilisateurId: compte.user.id, capacite: 'mcp', revoqueLe: null } })
    await expect(exigerPlanPayantPourConsentement(compte.user.id)).resolves.toBeUndefined()
    expect(await outilRefuse(mcp)).toBe(false)
    expect(await outilRefuse(mcpAutre)).toBe(true)

    const retrait = await revoquer(compte.user.id)

    expect(retrait.status).toBe(200)
    expect(await outilRefuse(mcp)).toBe(true)
    expect(await rejet(exigerPlanPayantPourConsentement(compte.user.id))).toMatchObject({ code: 'PLAN_PAYANT_REQUIS' })
    expect(await journalDe(ADMIN_ACTIONS.capaciteAccorder)).toHaveLength(1)
    expect(await journalDe(ADMIN_ACTIONS.capaciteRevoquer)).toHaveLength(1)
  })

  it('should replay a grant with the same Idempotency-Key without a second row nor journal line', async () => {
    const compte = await creerAbonne('gratuit')
    const cle = 'cle-octroi-0001'

    const premier = await accorder(compte.user.id, { cle })
    const rejeu = await accorder(compte.user.id, { cle })

    expect(premier.status).toBe(200)
    expect(rejeu).toMatchObject({ status: 200, corps: { rejoue: true } })
    expect(await journalDe(ADMIN_ACTIONS.capaciteAccorder)).toHaveLength(1)
  })

  it.each([
    ['sans code de réauthentification', { reauth: null }, 403],
    ['sans motif', { corps: { capacite: 'mcp' } }, 422],
    ['pour une capacité inconnue', { corps: { capacite: 'admin', motif: MOTIF_A4 } }, 422],
  ] as const)('should refuse a grant %s, and write nothing', async (_cas, surcharges, statut) => {
    const compte = await creerAbonne('gratuit')

    const reponse = await accorder(compte.user.id, surcharges)

    expect(reponse.status).toBe(statut)
    expect(await compterJournal()).toBe(0)
    expect(await outilRefuse(await connecter(compte.user.id))).toBe(true)
  })
})
