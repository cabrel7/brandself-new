// Adaptateur « frais » : un barème par (fournisseur, méthode) CONNU du code (la clé ne s'invente pas depuis l'interface).
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../../shared/admin'
import { FOURNISSEURS_PAIEMENT, METHODES_PAIEMENT } from '../../../../shared/paiements'
import { schemaValeursFrais } from '../../../../shared/schemas/admin-versions'
import type { ValeursFrais } from '../../../../shared/schemas/admin-versions'
import { ValidationError } from '../../../exceptions/http'
import type { AdaptateurVersion } from './types'

export const adaptateurFrais: AdaptateurVersion<ValeursFrais> = {
  type: 'frais',
  categorie: VERSION_CATEGORIE_PAR_TYPE.frais,
  schemaValeurs: schemaValeursFrais,
  validerCoherence(_tx, cle) {
    const [fournisseur, methode] = cle.split(':')
    const connu = (FOURNISSEURS_PAIEMENT as readonly string[]).includes(fournisseur ?? '')
      && (METHODES_PAIEMENT as readonly string[]).includes(methode ?? '')
    return connu ? Promise.resolve() : Promise.reject(new ValidationError({ cle: ['Barème de frais inconnu.'] }))
  },
}
