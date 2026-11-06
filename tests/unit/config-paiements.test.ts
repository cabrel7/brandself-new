import { describe, expect, it, vi } from 'vitest'
import { PRIX_MAX_MINOR } from '../../shared/devises'
import { FRAIS_TAUX_PB_MAX } from '../../shared/paiements'
import { PERIODES_MOIS, PLAN_IDS, RESSOURCES_QUOTA } from '../../shared/plans'
import {
  assertConfigPaiements,
  ConfigPaiementsError,
  FRAIS_PAIEMENT,
  getFraisPaiement,
  getMoyenPaiement,
  MOYENS_PAIEMENT,
  paiementVerrouille,
} from '../../server/config/paiements'
import type { ConfigPaiementsVerifiable, MoyenPaiementConfig } from '../../server/config/paiements'
import { LIMITE_CHAMP_PAR_RESSOURCE, PLAN_PAYANT_ID, PLANS, PRIX_PLANS, PRIX_STATUT } from '../../server/config/plans'
import type { GrillePrix } from '../../server/config/plans'

// S10 CA11, CA15 : validation de la configuration des paiements au démarrage ; §3.3 : catalogue et grille.

const DEVELOPPEMENT = { NODE_ENV: 'development' } as const
const PRODUCTION = { NODE_ENV: 'production' } as const

function configValide(surcharge: Partial<ConfigPaiementsVerifiable> = {}): ConfigPaiementsVerifiable {
  return {
    moyens: MOYENS_PAIEMENT,
    frais: FRAIS_PAIEMENT,
    prix: PRIX_PLANS[PLAN_PAYANT_ID],
    prixStatut: 'valide',
    ...surcharge,
  }
}

function avecPrix(xaf: Record<number, number>): GrillePrix {
  return { ...PRIX_PLANS[PLAN_PAYANT_ID], XAF: xaf as GrillePrix['XAF'] }
}

function messageDe(config: ConfigPaiementsVerifiable, env: Parameters<typeof assertConfigPaiements>[0] = DEVELOPPEMENT): string {
  try {
    assertConfigPaiements(env, config)
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ConfigPaiementsError)
    return (erreur as Error).message
  }
  return ''
}

describe('catalogue des moyens (#104)', () => {
  it('should activate only MTN MoMo and Orange Money in Cameroon, in XAF', () => {
    const actifs = MOYENS_PAIEMENT.filter((m) => m.actif)

    expect(actifs.map((m) => m.id).sort()).toEqual(['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
    expect(actifs.every((m) => m.pays === 'CMR' && m.devise === 'XAF' && m.indicatif === '237')).toBe(true)
    expect(getMoyenPaiement('kpay:MTN_MOMO_CMR')?.libelle).toBe('MTN MoMo')
    expect(getMoyenPaiement('kpay:ORANGE_CMR')?.libelle).toBe('Orange Money')
  })

  it('should list the foreign wallets as inactive', () => {
    const inactifs = MOYENS_PAIEMENT.filter((m) => !m.actif).map((m) => m.id).sort()

    expect(inactifs).toEqual(['kpay:MTN_MOMO_BEN', 'kpay:MTN_MOMO_CIV', 'kpay:MTN_MOMO_COG', 'kpay:ORANGE_CIV', 'kpay:ORANGE_SEN'])
  })

  it('should accept Cameroonian mobile numbers only for the active wallets', () => {
    const mtn = getMoyenPaiement('kpay:MTN_MOMO_CMR') as MoyenPaiementConfig

    expect(mtn.numeroNational.test('653456789')).toBe(true)
    expect(mtn.numeroNational.test('553456789')).toBe(false)
    expect(mtn.numeroNational.test('6534567890')).toBe(false)
  })

  it('should return undefined for an unknown wallet', () => {
    expect(getMoyenPaiement('kpay:INCONNU')).toBeUndefined()
  })
})

describe('frais (#107)', () => {
  it('should set K-PAY mobile money at 500 basis points borne by the merchant', () => {
    expect(getFraisPaiement('kpay', 'mobile_money')).toEqual({ tauxPointsBase: 500, supporteur: 'marchand' })
  })

  it('should have no fees configured for the declared but unused card method', () => {
    expect(getFraisPaiement('kpay', 'carte')).toBeUndefined()
  })
})

describe('plans et grille de prix (#106)', () => {
  it('should keep the provisional status until commercial validation', () => {
    expect(PRIX_STATUT).toBe('a_valider')
  })

  it('should give the free plan the limits of the spec and the paid plan no limit', () => {
    expect(PLANS.gratuit).toEqual({
      services: 3,
      realisations: 3,
      temoignages: 3,
      reservationsParMois: 10,
      generationsIaParMois: 3,
      badge: true,
      statistiquesJours: 7,
      statistiquesDetails: false,
    })
    expect(PLANS.payant).toEqual({
      services: null,
      realisations: null,
      temoignages: null,
      reservationsParMois: null,
      generationsIaParMois: null,
      badge: false,
      statistiquesJours: 90,
      statistiquesDetails: true,
    })
  })

  it('should configure every plan and map every quota resource to a limit field', () => {
    expect(Object.keys(PLANS).sort()).toEqual([...PLAN_IDS].sort())
    for (const ressource of RESSOURCES_QUOTA) {
      expect(PLANS.gratuit).toHaveProperty(LIMITE_CHAMP_PAR_RESSOURCE[ressource])
    }
  })

  it('should price XAF at 5000, 13500 and 48000 and every currency on every period with whole numbers', () => {
    expect(PRIX_PLANS.payant.XAF).toEqual({ 1: 5_000, 3: 13_500, 12: 48_000 })
    for (const grille of Object.values(PRIX_PLANS.payant)) {
      for (const periode of PERIODES_MOIS) {
        const montant = grille[periode]
        expect(Number.isSafeInteger(montant)).toBe(true)
        expect(montant).toBeGreaterThan(0)
        expect(montant).toBeLessThanOrEqual(PRIX_MAX_MINOR)
      }
    }
  })
})

describe('assertConfigPaiements (CA11, CA15)', () => {
  it('should accept the shipped configuration once the prices are validated', () => {
    expect(() => assertConfigPaiements(PRODUCTION, configValide())).not.toThrow()
    expect(() => assertConfigPaiements(DEVELOPPEMENT, configValide())).not.toThrow()
  })

  it('should accept the provisional prices outside production', () => {
    expect(() => assertConfigPaiements(DEVELOPPEMENT)).not.toThrow()
    expect(() => assertConfigPaiements({ NODE_ENV: 'test' })).not.toThrow()
  })

  it('should NOT stop the startup on provisional prices in production without live keys: it only warns (payment stays locked)', () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => assertConfigPaiements(PRODUCTION)).not.toThrow()
    expect(() => assertConfigPaiements({ ...PRODUCTION, KPAY_API_KEY: 'kpay_test_abc' }, configValide({ prixStatut: 'a_valider' }))).not.toThrow()
    expect(avertissement).toHaveBeenCalledWith(expect.stringMatching(/PRIX_STATUT/))
    avertissement.mockRestore()
  })

  it('should refuse the provisional prices in production when LIVE K-PAY keys are present, naming PRIX_STATUT (CA15)', () => {
    expect(messageDe(configValide({ prixStatut: 'a_valider' }), { ...PRODUCTION, KPAY_API_KEY: 'kpay_live_abc' })).toMatch(/PRIX_STATUT/)
  })

  it('should lock the payment only in production while the prices are provisional', () => {
    expect(paiementVerrouille(PRODUCTION, 'a_valider')).toBe(true)
    expect(paiementVerrouille(PRODUCTION, 'valide')).toBe(false)
    expect(paiementVerrouille(DEVELOPPEMENT, 'a_valider')).toBe(false)
  })

  it('should refuse a price below the wallet minimum', () => {
    expect(messageDe(configValide({ prix: avecPrix({ 1: 99, 3: 13_500, 12: 48_000 }) }))).toMatch(/prix XAF 1 mois.*minimum/)
  })

  it.each([
    ['a decimal', 5_000.5],
    ['a negative number', -5_000],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['above the maximum', PRIX_MAX_MINOR + 1],
  ])('should refuse a price that is %s', (_nom, valeur) => {
    expect(messageDe(configValide({ prix: avecPrix({ 1: valeur, 3: 13_500, 12: 48_000 }) }))).toMatch(/prix XAF 1 mois/)
  })

  it('should refuse a missing period price for a payable currency', () => {
    expect(messageDe(configValide({ prix: avecPrix({ 1: 5_000, 12: 48_000 }) }))).toMatch(/prix XAF 3 mois/)
  })

  it('should refuse an active K-PAY wallet in a currency with decimals', () => {
    const moyens = [{ ...(getMoyenPaiement('kpay:MTN_MOMO_CMR') as MoyenPaiementConfig), devise: 'EUR' }]

    expect(messageDe(configValide({ moyens }))).toMatch(/sans décimales/)
  })

  it('should not require decimals-free currency on an inactive wallet', () => {
    const moyens = [{ ...(getMoyenPaiement('kpay:ORANGE_CIV') as MoyenPaiementConfig), devise: 'EUR' }]

    expect(() => assertConfigPaiements(DEVELOPPEMENT, configValide({ moyens }))).not.toThrow()
  })

  it.each([
    ['above the maximum', FRAIS_TAUX_PB_MAX + 1],
    ['negative', -1],
    ['not an integer', 12.5],
  ])('should refuse a fee rate that is %s', (_nom, tauxPointsBase) => {
    const frais = { kpay: { mobile_money: { tauxPointsBase, supporteur: 'marchand' as const } } }

    expect(messageDe(configValide({ frais }))).toMatch(/frais kpay\/mobile_money/)
  })

  it('should accept a zero fee rate', () => {
    const frais = { kpay: { mobile_money: { tauxPointsBase: 0, supporteur: 'client' as const } } }

    expect(() => assertConfigPaiements(DEVELOPPEMENT, configValide({ frais }))).not.toThrow()
  })

  it('should refuse a wallet without configured fees', () => {
    expect(messageDe(configValide({ frais: {} }))).toMatch(/aucun frais configuré/)
  })

  it('should refuse a wallet whose id does not match provider and operator, and duplicates', () => {
    const base = getMoyenPaiement('kpay:MTN_MOMO_CMR') as MoyenPaiementConfig

    expect(messageDe(configValide({ moyens: [{ ...base, id: 'kpay:AUTRE' }] }))).toMatch(/fournisseur:OPERATEUR/)
    expect(messageDe(configValide({ moyens: [base, base] }))).toMatch(/en double/)
  })

  it('should report every problem at once without leaking anything but configuration', () => {
    const message = messageDe(
      configValide({ prixStatut: 'a_valider', prix: avecPrix({ 1: 0, 3: 13_500, 12: 48_000 }) }),
      { ...PRODUCTION, KPAY_API_KEY: 'kpay_live_abc' },
    )

    expect(message).toMatch(/prix XAF 1 mois/)
    expect(message).toMatch(/PRIX_STATUT/)
  })
})
