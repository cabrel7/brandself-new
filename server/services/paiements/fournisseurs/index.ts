import { env, resolveKpayEnvironnement, resolveMercyPayEnvironnement } from '../../../../shared/env'
import type { Env } from '../../../../shared/env'
import { FOURNISSEURS_PAIEMENT } from '../../../../shared/paiements'
import type { FournisseurPaiement } from '../../../../shared/paiements'
import type { PaiementProvider } from '../types'
import { creerKpayProvider, decrireAbonnementKpay } from './kpay/adaptateur'
import { creerMercyPayProvider, decrireAbonnementMercy } from './mercypay/adaptateur'

// S10 (docs/specs/S10-abonnements.md §5.2) : registre des fournisseurs. C'est le SEUL endroit qui lit les clés
// (`KPAY_*`, `MERCY_PAY_*`) pour construire un adaptateur ; un fournisseur est « configuré » quand ses clés sont présentes.
// Ajouter un fournisseur = un adaptateur + une entrée ici (la source en base reste `fournisseur`, P1 D5).

export type EnvPaiements = Pick<
  Env,
  | 'KPAY_API_KEY'
  | 'KPAY_SECRET_KEY'
  | 'KPAY_WEBHOOK_SECRET'
  | 'KPAY_BASE_URL'
  | 'MERCY_PAY_API_KEY'
  | 'MERCY_PAY_WEBHOOK_SECRET'
  | 'MERCY_PAY_BASE_URL'
>

export function estFournisseurConnu(nom: string): nom is FournisseurPaiement {
  return (FOURNISSEURS_PAIEMENT as readonly string[]).includes(nom)
}

/** `null` si le fournisseur n'est pas configuré (clés absentes) : le paiement n'est alors pas proposé. */
export function getPaiementProvider(nom: FournisseurPaiement, source: EnvPaiements = env): PaiementProvider | null {
  switch (nom) {
    case 'kpay': {
      if (!source.KPAY_API_KEY || !source.KPAY_SECRET_KEY) return null
      return creerKpayProvider({
        baseUrl: source.KPAY_BASE_URL,
        cleApi: source.KPAY_API_KEY,
        cleSecrete: source.KPAY_SECRET_KEY,
        environnement: resolveKpayEnvironnement(source.KPAY_API_KEY),
        ...(source.KPAY_WEBHOOK_SECRET ? { secretWebhook: source.KPAY_WEBHOOK_SECRET } : {}),
      })
    }
    case 'mercypay': {
      // Seule la clé API conditionne le fournisseur : sans secret de webhook, l'initiation et le rapprochement
      // fonctionnent et la route webhook refuse tout (`webhookConfigure` faux).
      if (!source.MERCY_PAY_API_KEY) return null
      return creerMercyPayProvider({
        baseUrl: source.MERCY_PAY_BASE_URL,
        cleApi: source.MERCY_PAY_API_KEY,
        environnement: resolveMercyPayEnvironnement(source.MERCY_PAY_API_KEY),
        ...(source.MERCY_PAY_WEBHOOK_SECRET ? { secretWebhook: source.MERCY_PAY_WEBHOOK_SECRET } : {}),
      })
    }
  }
}

/** Fournisseurs dont les clés sont présentes. */
export function fournisseursConfigures(source: EnvPaiements = env): FournisseurPaiement[] {
  return FOURNISSEURS_PAIEMENT.filter((nom) => getPaiementProvider(nom, source) !== null)
}

/** Libellé du paiement transmis au fournisseur pour une période d'abonnement. */
export function decrirePaiement(nom: FournisseurPaiement, periodeMois: number): string {
  switch (nom) {
    case 'kpay':
      return decrireAbonnementKpay(periodeMois)
    case 'mercypay':
      return decrireAbonnementMercy(periodeMois)
  }
}
