// Adaptateur « moyens » : seul le drapeau `actif` change (D-A5-08). Chaque identifiant doit exister au catalogue du code
// pour CE fournisseur : un moyen ne se crée pas depuis l'interface (il dépend d'un code d'opérateur).
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../../shared/admin'
import { FOURNISSEURS_PAIEMENT } from '../../../../shared/paiements'
import { schemaValeursMoyens } from '../../../../shared/schemas/admin-versions'
import type { ValeursMoyens } from '../../../../shared/schemas/admin-versions'
import { MOYENS_PAIEMENT } from '../../../config/paiements'
import { ValidationError } from '../../../exceptions/http'
import type { AdaptateurVersion } from './types'

export const adaptateurMoyens: AdaptateurVersion<ValeursMoyens> = {
  type: 'moyens',
  categorie: VERSION_CATEGORIE_PAR_TYPE.moyens,
  schemaValeurs: schemaValeursMoyens,
  validerCoherence(_tx, cle, valeurs) {
    if (!(FOURNISSEURS_PAIEMENT as readonly string[]).includes(cle)) {
      return Promise.reject(new ValidationError({ cle: ['Fournisseur inconnu.'] }))
    }
    const connus = new Set(MOYENS_PAIEMENT.filter((m) => m.fournisseur === cle).map((m) => m.id))
    const inconnus = valeurs.actifs.filter((id) => !connus.has(id))
    return inconnus.length > 0
      ? Promise.reject(new ValidationError({ 'valeurs.actifs': inconnus.map((id) => `Moyen inconnu : ${id}`) }))
      : Promise.resolve()
  },
}
