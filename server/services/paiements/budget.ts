import {
  KPAY_APPELS_CLE,
  KPAY_APPELS_FENETRE_S,
  KPAY_APPELS_MAX_PAR_MINUTE,
  MERCY_PAY_APPELS_FENETRE_S,
  MERCY_PAY_ECRITURES_MAX_PAR_MINUTE,
  MERCY_PAY_LECTURES_MAX_PAR_MINUTE,
} from '../../../shared/limites'
import { ServiceUnavailableError } from '../../exceptions/http'
import { hitLimit } from '../limiteur'
import type { FournisseurPaiement } from '../../../shared/paiements'

// S10 (docs/specs/S10-abonnements.md §1 #110) : K-PAY plafonne à 100 requêtes/min pour toute l'application. Un
// compteur Redis GLOBAL, partagé entre l'initiation (web) et la vérification (worker), borne nos appels à 60.
// P1 : Mercy Pay limite par clé à 60 écritures et 300 lectures par minute ; nous en utilisons 40 et 200 (marge).
// Un compteur PAR fournisseur et, chez Mercy, PAR nature d'appel : saturer l'un ne touche jamais les autres.
// FAIL-CLOSED : Redis indisponible (ou compteur illisible) = 503 `LIMITEUR_INDISPONIBLE`, aucun appel au fournisseur.
// Budget épuisé = 503 `FOURNISSEUR_INDISPONIBLE` avec `retryAfter`. Le compteur est un INCR atomique (`hitLimit`).

/** `ecriture` = création chez le fournisseur (POST) ; `lecture` = consultation (GET). K-PAY n'a qu'un budget commun. */
export type NatureAppel = 'ecriture' | 'lecture'

interface Budget {
  cle: string
  max: number
  fenetreS: number
}

const MERCY_CLE_PREFIXE = 'mercypay:appels:'

function budgetDe(nom: FournisseurPaiement, nature: NatureAppel): Budget {
  switch (nom) {
    case 'kpay':
      return { cle: KPAY_APPELS_CLE, max: KPAY_APPELS_MAX_PAR_MINUTE, fenetreS: KPAY_APPELS_FENETRE_S }
    case 'mercypay':
      return {
        cle: `${MERCY_CLE_PREFIXE}${nature}`,
        max: nature === 'ecriture' ? MERCY_PAY_ECRITURES_MAX_PAR_MINUTE : MERCY_PAY_LECTURES_MAX_PAR_MINUTE,
        fenetreS: MERCY_PAY_APPELS_FENETRE_S,
      }
  }
}

/** Réserve un appel vers le fournisseur ; lève 503 si le budget de la minute est épuisé ou si Redis est coupé. */
export async function reserverAppelFournisseur(nom: FournisseurPaiement, nature: NatureAppel = 'ecriture'): Promise<void> {
  const budget = budgetDe(nom, nature)
  const statut = await hitLimit(budget.cle, budget.max, budget.fenetreS, { failClosed: true })
  if (!statut.allowed) throw new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE', { retryAfter: statut.retryAfter })
}
