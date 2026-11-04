import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { creerKpayProvider } from '../../server/services/paiements/fournisseurs/kpay/adaptateur'
import type { EtatFournisseur } from '../../server/services/paiements/types'
import { NUMEROS_SANDBOX } from '../support/faux-kpay'

// S10 §6 CA25 : essai RÉEL optionnel contre le bac à sable K-PAY. NE FAIT PAS PARTIE de la gate : ce projet Vitest (`sandbox`) n'est
// enregistré que si `KPAY_SANDBOX=1` (voir vitest.config.ts), donc `pnpm test` ne le voit jamais. Ce test n'est PAS une garantie
// d'intégration : il prouve seulement que l'adaptateur parle au vrai K-PAY ; l'intégration est prouvée contre le faux serveur local.
//
// Lancement : KPAY_SANDBOX=1 pnpm exec vitest run --project sandbox   (les clés `kpay_test_` viennent de l'environnement du processus ;
// ce fichier ne lit ni n'affiche aucun fichier .env). Prérequis côté K-PAY : une URL de rappel Payin configurée, sinon le bac à sable
// répond 400. Si KPAY_API_KEY ou KPAY_SECRET_KEY est absente, le test est sauté avec un message explicite.

const CLE_API = process.env.KPAY_API_KEY
const CLE_SECRETE = process.env.KPAY_SECRET_KEY
const PRESENT = Boolean(CLE_API) && Boolean(CLE_SECRETE)
const BASE_URL = process.env.KPAY_BASE_URL ?? 'https://admin.kpay.site'

const INTERVALLE_MS = 10_000
const DUREE_MAX_MS = 120_000
const MONTANT = 100

if (!PRESENT) {
  console.warn('[sandbox K-PAY] KPAY_API_KEY et KPAY_SECRET_KEY sont absentes de l’environnement : essai réel SAUTÉ (ce n’est pas un succès).')
}

const attendre = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function provider() {
  if (!CLE_API?.startsWith('kpay_test_')) {
    // Garde-fou absolu : jamais d'argent réel depuis un essai automatique.
    throw new Error('Le projet sandbox exige une clé kpay_test_ : une clé de production est refusée.')
  }
  return creerKpayProvider({ baseUrl: BASE_URL, cleApi: CLE_API, cleSecrete: CLE_SECRETE ?? '', environnement: 'test' })
}

async function initier(numero: string) {
  const externalId = randomUUID()
  const resultat = await provider().initier({
    externalId, montant: MONTANT, devise: 'XAF', operateur: 'MTN_MOMO_CMR', telephoneInternational: numero, description: 'Brandself — essai bac à sable',
  }, AbortSignal.timeout(15_000))
  return { externalId, resultat }
}

async function attendreTerminal(idFournisseur: string): Promise<EtatFournisseur> {
  const debut = Date.now()
  for (;;) {
    const etat = await provider().consulter(idFournisseur, AbortSignal.timeout(10_000))
    if (etat === null) throw new Error('Transaction introuvable chez K-PAY')
    if (etat.statut !== 'en_attente' || Date.now() - debut >= DUREE_MAX_MS) return etat
    await attendre(INTERVALLE_MS)
  }
}

describe.skipIf(!PRESENT)('bac à sable K-PAY réel (hors gate, CA25)', () => {
  it('should complete a payment started from the sandbox success number (237653456789)', async () => {
    const { externalId, resultat } = await initier(NUMEROS_SANDBOX.succes)

    expect(resultat, 'initiation (une URL de rappel Payin est-elle configurée chez K-PAY ?)').toMatchObject({ issue: 'accepte' })
    if (resultat.issue !== 'accepte') return
    const etat = await attendreTerminal(resultat.idFournisseur)
    expect(etat).toMatchObject({ statut: 'reussi', montant: MONTANT, devise: 'XAF', externalId })
  })

  it('should fail with PAYER_LIMIT_REACHED for the sandbox number 237653456019', async () => {
    const { resultat } = await initier(NUMEROS_SANDBOX.echecPlafond)

    expect(resultat).toMatchObject({ issue: 'accepte' })
    if (resultat.issue !== 'accepte') return
    expect(await attendreTerminal(resultat.idFournisseur)).toMatchObject({ statut: 'echoue', codeEchec: 'PAYER_LIMIT_REACHED' })
  })

  it('should stay non terminal for the sandbox number 237653456129', async () => {
    const { resultat } = await initier(NUMEROS_SANDBOX.nonTerminal)

    expect(resultat).toMatchObject({ issue: 'accepte' })
    if (resultat.issue !== 'accepte') return
    await attendre(INTERVALLE_MS)
    expect((await provider().consulter(resultat.idFournisseur, AbortSignal.timeout(10_000)))?.statut).toBe('en_attente')
  })

  it('should answer null for a transaction identifier unknown to K-PAY', async () => {
    expect(await provider().consulter(randomUUID(), AbortSignal.timeout(10_000))).toBeNull()
  })
})
