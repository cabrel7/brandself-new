import { describe, expect, it } from 'vitest'
import { PLAN_IDS } from '../../../shared/plans'
import { FRAIS_PAIEMENT, MOYENS_PAIEMENT } from '../../../server/config/paiements'
import { PLANS, PRIX_PLANS } from '../../../server/config/plans'

// A5 R10 : la version 1 seedée (migration 0032) et les constantes du code doivent rester IDENTIQUES tant que le repli existe
// (D-A5-04 : une erreur de lecture sert les constantes, qui valent la v1). L'égalité des lignes SQL est éprouvée dans
// migration-0032.test.ts ; ICI on prouve ce que les LECTEURS du code rendent sur la base réelle : sans cache, la lecture
// de chaque catégorie égale la constante. Une modification de grille par le code seul (sans nouvelle version) casse ce test.

const lecture = () => import('../../../server/services/configuration/lecture')

/** Les lecteurs peuvent rendre la version (`{ valeurs }`) ou les valeurs seules : le contrat de forme n'est pas figé par la spec. */
const valeursDe = (lu: unknown): unknown => (typeof lu === 'object' && lu !== null && 'valeurs' in lu ? (lu as { valeurs: unknown }).valeurs : lu)

describe('version 1 seedée : lue par le code, égale aux constantes', () => {
  it.each(PLAN_IDS)('should read the active %s plan, without cache, equal to PLANS (plus the mcp capacity)', async (plan) => {
    const { lireVersionActive } = await lecture()

    const lu = await lireVersionActive('plan', plan, { sansCache: true })

    expect(valeursDe(lu)).toEqual({ ...PLANS[plan], capacites: { mcp: plan === 'payant' } })
  })

  it('should read the price grid equal to PRIX_PLANS.payant, and report the seeded grid as NOT validated (production stays locked)', async () => {
    const { lireGrillePrix, lireVersionActive } = await lecture()

    const grille = await lireGrillePrix()
    const version = await lireVersionActive('prix', 'payant', { sansCache: true }) as { valideeLe?: Date | string | null }

    expect(valeursDe(grille)).toEqual(PRIX_PLANS.payant)
    expect(version.valideeLe ?? null).toBeNull()
  })

  it('should read the mobile-money fees of K-PAY equal to FRAIS_PAIEMENT', async () => {
    const { lireFrais } = await lecture()

    expect(valeursDe(await lireFrais('kpay', 'mobile_money'))).toEqual(FRAIS_PAIEMENT.kpay?.mobile_money)
  })

  it('should read exactly the active methods of MOYENS_PAIEMENT', async () => {
    const { lireMoyensActifs } = await lecture()

    const lu = valeursDe(await lireMoyensActifs()) as unknown
    // Le lecteur rend la liste COMPLÈTE des moyens avec leur drapeau `actif` appliqué (ou la liste des identifiants actifs).
    const elements = Array.isArray(lu) ? lu : (lu as { actifs: unknown[] }).actifs
    const ids = elements
      .filter((m) => typeof m === 'string' || (m as { actif?: boolean }).actif === true)
      .map((m) => (typeof m === 'string' ? m : (m as { id: string }).id))

    expect([...ids].sort()).toEqual(MOYENS_PAIEMENT.filter((m) => m.actif).map((m) => m.id).sort())
  })
})
