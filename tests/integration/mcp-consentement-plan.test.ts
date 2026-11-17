import { describe, expect, it } from 'vitest'
import { creerAbonne } from './support/abonnements'
import { rejet } from './support/erreurs'

// S16 : un compte gratuit ne peut pas ACCEPTER un assistant (POST /api/auth/oauth2/consent), le plan payant le
// peut. Plan lu pour de VRAI par PlanService dans la base de test (aucun mock de la couche prouvée).
const consentement = () => import('../../server/mcp/consentement')

describe('consentement MCP et plan (S16)', () => {
  it('should refuse a free account with 403 PLAN_PAYANT_REQUIS and a French message', async () => {
    const { exigerPlanPayantPourConsentement, MESSAGE_PLAN_PAYANT_CONSENTEMENT } = await consentement()
    const gratuit = await creerAbonne('gratuit')

    const erreur = await rejet(exigerPlanPayantPourConsentement(gratuit.user.id))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'PLAN_PAYANT_REQUIS', status: 403, message: MESSAGE_PLAN_PAYANT_CONSENTEMENT })
  })

  it('should refuse an account whose subscription is over', async () => {
    const { exigerPlanPayantPourConsentement } = await consentement()
    const termine = await creerAbonne('termine')

    expect(await rejet(exigerPlanPayantPourConsentement(termine.user.id))).toMatchObject({ code: 'PLAN_PAYANT_REQUIS', status: 403 })
  })

  it.each(['actif', 'grace'] as const)('should let a %s paid account through', async (etat) => {
    const { exigerPlanPayantPourConsentement } = await consentement()
    const payant = await creerAbonne(etat)

    await expect(exigerPlanPayantPourConsentement(payant.user.id)).resolves.toBeUndefined()
  })
})
