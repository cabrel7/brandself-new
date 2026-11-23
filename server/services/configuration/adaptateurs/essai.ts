// Adaptateur « essai » (E1 D3) : une seule clé, `inscription` (CHECK de la migration 0036). Le schéma strict vérifie déjà la
// forme et l'ordre des jours (1 <= services < statistiques < durée) ; aucune cohérence avec une autre version, donc pas
// d'aperçu d'impact (un changement ne touche que les essais accordés ensuite).
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../../shared/admin'
import { ESSAI_CLE_CONFIG } from '../../../../shared/essai'
import { schemaValeursEssai } from '../../../../shared/schemas/admin-versions'
import type { ValeursEssai } from '../../../../shared/schemas/admin-versions'
import { ValidationError } from '../../../exceptions/http'
import type { AdaptateurVersion } from './types'

export const adaptateurEssai: AdaptateurVersion<ValeursEssai> = {
  type: 'essai',
  categorie: VERSION_CATEGORIE_PAR_TYPE.essai,
  schemaValeurs: schemaValeursEssai,
  validerCoherence(_tx, cle) {
    return cle === ESSAI_CLE_CONFIG ? Promise.resolve() : Promise.reject(new ValidationError({ cle: ['Réglage d’essai inconnu.'] }))
  },
}
