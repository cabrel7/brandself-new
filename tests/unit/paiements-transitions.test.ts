import { describe, expect, it } from 'vitest'
import { PAIEMENT_STATUTS } from '../../shared/paiements'
import type { PaiementStatut } from '../../shared/paiements'
import { moduleTransitions } from './support/s10'

// S10 §1 #111 et #115 : machine d'états d'un paiement, fonction PURE `transitionPaiement(statut, evenementNormalise)`.
// Elle renvoie une décision : { type: 'succes' } | { type: 'echec', statut, codeEchec } | { type: 'ignorer', motif } | { type: 'attente' }.
//   cree       -> en_attente | echoue | expire (+ reussi, annule : le webhook peut devancer notre mise à jour)
//   en_attente -> reussi | echoue | annule | expire | anomalie
//   expire | echoue | annule -> reussi | anomalie    (un `completed` tardif est TOUJOURS appliqué : l'argent a été pris)
//   `reussi` et `anomalie` sont FINAUX. `failed` et `cancelled` ne s'appliquent qu'à cree, en_attente, expire.

type StatutEvenement = 'en_attente' | 'reussi' | 'echoue' | 'annule' | 'rembourse' | 'autre'

async function decider(statut: PaiementStatut, evenement: StatutEvenement, codeEchec: string | null = null) {
  const { transitionPaiement } = await moduleTransitions()
  return transitionPaiement(statut, { statut: evenement, codeEchec })
}

describe('transitionPaiement : un paiement réussi (completed)', () => {
  it.each(['cree', 'en_attente', 'echoue', 'annule', 'expire'] as const)('should apply a completed payment from %s (money was taken)', async (depart) => {
    expect(await decider(depart, 'reussi')).toEqual({ type: 'succes' })
  })

  it.each(['reussi', 'anomalie'] as const)('should ignore a completed event on the final status %s (no second extension)', async (final) => {
    const decision = await decider(final, 'reussi')

    expect(decision.type).toBe('ignorer')
  })
})

describe('transitionPaiement : échec et annulation', () => {
  it.each(['cree', 'en_attente', 'expire'] as const)('should record a failure from %s with the provider failure code', async (depart) => {
    expect(await decider(depart, 'echoue', 'PAYER_NOT_FOUND')).toEqual({ type: 'echec', statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND' })
  })

  it.each(['cree', 'en_attente', 'expire'] as const)('should record a cancellation from %s', async (depart) => {
    expect(await decider(depart, 'annule')).toEqual({ type: 'echec', statut: 'annule', codeEchec: null })
  })

  it.each(['reussi', 'anomalie', 'echoue', 'annule'] as const)('should ignore a failed event on %s (a late failure never downgrades or rewrites)', async (depart) => {
    expect((await decider(depart, 'echoue', 'PAYER_NOT_FOUND')).type).toBe('ignorer')
  })

  it.each(['reussi', 'anomalie', 'echoue', 'annule'] as const)('should ignore a cancelled event on %s', async (depart) => {
    expect((await decider(depart, 'annule')).type).toBe('ignorer')
  })
})

describe('transitionPaiement : événements sans effet', () => {
  it.each(PAIEMENT_STATUTS)('should wait without any write on a non terminal provider status from %s', async (depart) => {
    expect(await decider(depart, 'en_attente')).toEqual({ type: 'attente' })
  })

  it.each(PAIEMENT_STATUTS)('should ignore a refund from %s, with the REMBOURSE reason for the alert (Q10)', async (depart) => {
    expect(await decider(depart, 'rembourse')).toEqual({ type: 'ignorer', motif: 'REMBOURSE' })
  })

  it.each(PAIEMENT_STATUTS)('should ignore payouts and unknown events from %s as EVENEMENT_NON_GERE', async (depart) => {
    expect(await decider(depart, 'autre')).toEqual({ type: 'ignorer', motif: 'EVENEMENT_NON_GERE' })
  })
})

describe('transitionPaiement : propriétés', () => {
  it('should never decide success for any event other than a completed payment', async () => {
    for (const depart of PAIEMENT_STATUTS) {
      for (const evenement of ['en_attente', 'echoue', 'annule', 'rembourse', 'autre'] as const) {
        expect((await decider(depart, evenement)).type).not.toBe('succes')
      }
    }
  })

  it('should never let a final status (reussi, anomalie) change, whatever the event', async () => {
    for (const final of ['reussi', 'anomalie'] as const) {
      for (const evenement of ['reussi', 'echoue', 'annule', 'rembourse', 'autre', 'en_attente'] as const) {
        const decision = await decider(final, evenement, 'X')
        expect(['ignorer', 'attente']).toContain(decision.type)
      }
    }
  })

  it('should be pure : same inputs, same decision, input untouched', async () => {
    const evenement = Object.freeze({ statut: 'echoue' as const, codeEchec: 'PAYER_NOT_FOUND' })
    const { transitionPaiement } = await moduleTransitions()

    expect(transitionPaiement('en_attente', evenement)).toEqual(transitionPaiement('en_attente', evenement))
  })
})
