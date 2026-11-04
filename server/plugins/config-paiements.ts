import { env } from '../../shared/env'
import { assertConfigPaiements } from '../config/paiements'

// S10 §3.3 : la configuration des paiements est validée au démarrage. En production, une grille de prix encore
// `a_valider` (PRIX_STATUT) ou une valeur invalide fait ÉCHOUER le démarrage (jamais de prix provisoires en ligne).
export default defineNitroPlugin(() => {
  assertConfigPaiements(env)
})
