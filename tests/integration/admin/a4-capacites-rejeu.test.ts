import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { schemaCapaciteReponse } from '../../../shared/schemas/admin-a4'
import { demanderEtLireCode, ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import { MOTIF_A4, appelerA4, reinitialiserA4 } from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'
import { creerAbonne } from '../support/abonnements'

// Rejeu d'un octroi de capacité : la ligne relue est la plus RÉCENTE (tri décroissant sur `accorde_le`). Après un octroi,
// une révocation puis un nouvel octroi, le rejeu du second ne doit pas renvoyer la première ligne (révoquée).

const suite = preparerSuiteAdmin()
let connecte: AdminA4

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
})

const accorder = async (userId: string, cle: string) => {
  const { code } = await demanderEtLireCode(connecte.admin.id, { action: ADMIN_ACTIONS.capaciteAccorder, cibleType: 'utilisateur', cibleId: userId })
  return appelerA4('capaciteAccorder', {
    params: { id: userId },
    cookie: connecte.cookie,
    reauth: code,
    cleIdempotenceEntete: cle,
    corps: { capacite: 'mcp', motif: MOTIF_A4 },
  })
}

const revoquer = (userId: string) =>
  appelerA4('capaciteRevoquer', { params: { id: userId, capacite: 'mcp' }, cookie: connecte.cookie, corps: { motif: MOTIF_A4 } })

describe('rejeu d\'un octroi de capacité', () => {
  it('should replay the grant with the MOST RECENT row (the active one), not the older revoked row', async () => {
    const compte = await creerAbonne('gratuit')
    const premier = await accorder(compte.user.id, `cle-${randomUUID()}`)
    await revoquer(compte.user.id)
    const cleSecond = `cle-${randomUUID()}`
    const second = await accorder(compte.user.id, cleSecond)

    const rejeu = await accorder(compte.user.id, cleSecond)

    const idPremier = schemaCapaciteReponse.parse(premier.corps).capacite.id
    const idSecond = schemaCapaciteReponse.parse(second.corps).capacite.id
    expect(idSecond).not.toBe(idPremier)
    expect(rejeu.status).toBe(200)
    expect(schemaCapaciteReponse.parse(rejeu.corps)).toMatchObject({ rejoue: true, capacite: { id: idSecond, revoqueLe: null } })
  })
})
