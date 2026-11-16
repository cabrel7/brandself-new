// A5 (D-A5-04, R9) : contrôle de la configuration des paiements au démarrage (serveur et worker), sur les versions
// ACTIVES de la base. Lecture asynchrone : `PRIX_STATUT` n'est plus lu en dur.
//  - configuration invalide : `ConfigPaiementsError` (le démarrage échoue, comme avant) ;
//  - grille non validée en production : le serveur démarre, le paiement reste verrouillé (règle de `assertConfigPaiements`) ;
//  - base illisible au démarrage : on journalise et on démarre, paiements verrouillés (jamais « ouverts » par défaut).
import type { Env } from '../../../shared/env'
import { assertConfigPaiements, MOYENS_PAIEMENT } from '../../config/paiements'
import { appliquerMoyensActifs, lireInstantaneStrict } from './lecture'

export async function verifierConfigPaiementsAuDemarrage(env: Pick<Env, 'NODE_ENV'> & Partial<Pick<Env, 'KPAY_API_KEY'>>): Promise<void> {
  let instantane: Awaited<ReturnType<typeof lireInstantaneStrict>>
  try {
    instantane = await lireInstantaneStrict()
  } catch {
    console.error('[paiements] versions de configuration illisibles au démarrage : le paiement en ligne reste verrouillé en production')
    return
  }
  assertConfigPaiements(env, {
    moyens: appliquerMoyensActifs(MOYENS_PAIEMENT, instantane.moyensActifs),
    frais: instantane.frais,
    prix: instantane.grille,
    prixStatut: instantane.prixValideeLe === null ? 'a_valider' : 'valide',
  })
}
