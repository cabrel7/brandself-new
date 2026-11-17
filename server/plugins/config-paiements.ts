import { env } from '../../shared/env'
import { verifierConfigPaiementsAuDemarrage } from '../services/configuration/demarrage'

// S10 §3.3, A5 (R9) : la configuration des paiements est validée au démarrage, sur les versions ACTIVES (lecture
// asynchrone). Une configuration invalide fait ÉCHOUER le démarrage ; une grille de prix non validée en production
// laisse le serveur démarrer avec le paiement verrouillé (jamais de prix provisoires en ligne).
export default defineNitroPlugin(async () => {
  await verifierConfigPaiementsAuDemarrage(env)
})
