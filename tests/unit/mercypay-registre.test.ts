import { describe, expect, it } from 'vitest'
import { estFournisseurConnu, fournisseursConfigures, getPaiementProvider, decrirePaiement } from '../../server/services/paiements/fournisseurs'
import type { EnvPaiements } from '../../server/services/paiements/fournisseurs'
import { FOURNISSEUR_FORMAT, FOURNISSEURS_PAIEMENT, PAIEMENT_SOURCE_FOURNISSEUR } from '../../shared/paiements'
import { MERCY_PAY_ECRITURES_MAX_PAR_MINUTE, MERCY_PAY_LECTURES_MAX_PAR_MINUTE } from '../../shared/limites'
import { KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE } from '../support/faux-kpay'
import { MERCY_TEST_CLE_API, MERCY_TEST_CLE_LIVE, MERCY_TEST_SECRET_WEBHOOK } from '../support/faux-mercypay'

// P1 CA-M20 (+ spec §4.3) : le registre des fournisseurs. `mercypay` est « configuré » SI ET SEULEMENT SI sa clé API est présente
// (le secret de webhook est facultatif hors production : le rapprochement par interrogation prend le relais) ; `kpay` n'est plus
// configuré sans ses clés. Le registre est le SEUL endroit qui lit les variables (injectées ici par le paramètre `source`).

const VIDE: EnvPaiements = {
  KPAY_API_KEY: undefined,
  KPAY_SECRET_KEY: undefined,
  KPAY_WEBHOOK_SECRET: undefined,
  KPAY_BASE_URL: 'https://admin.kpay.site',
  MERCY_PAY_API_KEY: undefined,
  MERCY_PAY_WEBHOOK_SECRET: undefined,
  MERCY_PAY_BASE_URL: 'https://mercy-pay.com/api/v1',
}
const avec = (surcharges: Partial<EnvPaiements>): EnvPaiements => ({ ...VIDE, ...surcharges })

describe('constantes partagées', () => {
  it('should know both providers and share the `fournisseur` source for every one of them (D5)', () => {
    expect(FOURNISSEURS_PAIEMENT).toEqual(['kpay', 'mercypay'])
    expect(PAIEMENT_SOURCE_FOURNISSEUR).toBe('fournisseur')
    expect(FOURNISSEUR_FORMAT.test('mercypay')).toBe(true)
  })

  it('should recognise `mercypay` and nothing built from it (route parameter)', () => {
    expect(estFournisseurConnu('mercypay')).toBe(true)
    expect(estFournisseurConnu('MERCYPAY')).toBe(false)
    expect(estFournisseurConnu('mercy-pay')).toBe(false)
    expect(estFournisseurConnu('mercypay/../kpay')).toBe(false)
  })

  it('should keep the write budget under the documented 60 writes/min with a margin, and the read budget under 300/min', () => {
    expect(MERCY_PAY_ECRITURES_MAX_PAR_MINUTE).toBe(40)
    expect(MERCY_PAY_LECTURES_MAX_PAR_MINUTE).toBeGreaterThan(0)
    expect(MERCY_PAY_LECTURES_MAX_PAR_MINUTE).toBeLessThan(300)
  })
})

describe('fournisseursConfigures (CA-M20)', () => {
  it('should contain `mercypay` when its key is present, and no `kpay` without its keys', () => {
    expect(fournisseursConfigures(avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_API }))).toEqual(['mercypay'])
  })

  it('should stay configured without the webhook secret (initiation and polling still work)', () => {
    const source = avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_API, MERCY_PAY_WEBHOOK_SECRET: undefined })

    expect(fournisseursConfigures(source)).toContain('mercypay')
  })

  it('should be empty when nothing is configured', () => {
    expect(fournisseursConfigures(VIDE)).toEqual([])
  })

  it('should NOT consider the webhook secret alone as a configuration', () => {
    expect(fournisseursConfigures(avec({ MERCY_PAY_WEBHOOK_SECRET: MERCY_TEST_SECRET_WEBHOOK }))).toEqual([])
  })

  it('should NOT consider an empty key as a configuration', () => {
    expect(fournisseursConfigures(avec({ MERCY_PAY_API_KEY: '' }))).toEqual([])
  })

  it('should list both when both are configured, and `kpay` alone with only K-PAY keys (K-PAY code is kept, D7)', () => {
    const kpay = { KPAY_API_KEY: KPAY_TEST_CLE_API, KPAY_SECRET_KEY: KPAY_TEST_CLE_SECRETE }

    expect(fournisseursConfigures(avec({ ...kpay, MERCY_PAY_API_KEY: MERCY_TEST_CLE_API })).sort()).toEqual(['kpay', 'mercypay'])
    expect(fournisseursConfigures(avec(kpay))).toEqual(['kpay'])
  })
})

describe('getPaiementProvider("mercypay")', () => {
  it('should return null without a key', () => {
    expect(getPaiementProvider('mercypay', VIDE)).toBeNull()
  })

  it('should build the adapter with the provider name and the environment deduced from the key prefix', () => {
    const sandbox = getPaiementProvider('mercypay', avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_API, MERCY_PAY_WEBHOOK_SECRET: MERCY_TEST_SECRET_WEBHOOK }))
    const live = getPaiementProvider('mercypay', avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_LIVE, MERCY_PAY_WEBHOOK_SECRET: MERCY_TEST_SECRET_WEBHOOK }))

    expect(sandbox).toMatchObject({ nom: 'mercypay', environnement: 'test', webhookConfigure: true })
    expect(live).toMatchObject({ nom: 'mercypay', environnement: 'live', webhookConfigure: true })
  })

  it('should flag the webhook as not configured when the secret is absent', () => {
    const provider = getPaiementProvider('mercypay', avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_API }))

    expect(provider?.webhookConfigure).toBe(false)
  })

  it('should refuse EVERY signature without a secret (never a "no secret = accept")', () => {
    const provider = getPaiementProvider('mercypay', avec({ MERCY_PAY_API_KEY: MERCY_TEST_CLE_API }))
    const corps = Buffer.from('{}')

    expect(provider?.verifierSignature(corps, { 'mercypay-signature': 't=1,v1=' + 'a'.repeat(64) }, new Date(1000))).toBe(false)
    expect(provider?.verifierSignature(corps, {}, new Date())).toBe(false)
  })
})

describe('decrirePaiement("mercypay", n) : libellé transmis à Mercy', () => {
  it.each([1, 3, 12])('should give a short ASCII label for %i months: the first 22 characters are the mobile money message', (mois) => {
    const libelle = decrirePaiement('mercypay', mois)

    expect(libelle).toMatch(/^[\x20-\x7E]+$/)
    expect(libelle.length).toBeLessThanOrEqual(500)
    expect(libelle.slice(0, 22)).toMatch(/^[\x20-\x7E]{1,22}$/)
    expect(libelle).toContain(String(mois))
    expect(libelle).not.toMatch(/mercy|kpay/i)
  })

  it('should differ from one duration to the other', () => {
    expect(decrirePaiement('mercypay', 1)).not.toBe(decrirePaiement('mercypay', 12))
  })
})
