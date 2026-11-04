import {
  KPAY_APPELS_CLE,
  KPAY_APPELS_FENETRE_S,
  KPAY_APPELS_MAX_PAR_MINUTE,
} from '../../../shared/limites'
import { ServiceUnavailableError } from '../../exceptions/http'
import { hitLimit } from '../limiteur'
import type { FournisseurPaiement } from '../../../shared/paiements'

// S10 (docs/specs/S10-abonnements.md §1 #110) : K-PAY plafonne à 100 requêtes/min pour toute l'application. Un
// compteur Redis GLOBAL, partagé entre l'initiation (web) et la vérification (worker), borne nos appels à 60.
// FAIL-CLOSED : Redis indisponible = 503 `LIMITEUR_INDISPONIBLE`, aucun appel au fournisseur. Budget épuisé = 503
// `FOURNISSEUR_INDISPONIBLE` avec `retryAfter`.

/** Réserve un appel vers le fournisseur ; lève 503 si le budget de la minute est épuisé ou si Redis est coupé. */
export async function reserverAppelFournisseur(nom: FournisseurPaiement): Promise<void> {
  switch (nom) {
    case 'kpay': {
      const statut = await hitLimit(KPAY_APPELS_CLE, KPAY_APPELS_MAX_PAR_MINUTE, KPAY_APPELS_FENETRE_S, { failClosed: true })
      if (!statut.allowed) throw new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE', { retryAfter: statut.retryAfter })
    }
  }
}
