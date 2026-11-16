// Adaptateur « prix » : la grille COMPLÈTE (3 devises x 3 durées, entiers, schéma) ; chaque prix d'une devise payable
// reste au moins égal au montant minimal du moyen actif qui l'accepte (sinon le paiement serait refusé à l'initiation).
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../../shared/admin'
import { PERIODES_MOIS } from '../../../../shared/plans'
import { schemaValeursPrix } from '../../../../shared/schemas/admin-versions'
import type { ValeursPrix } from '../../../../shared/schemas/admin-versions'
import { PLAN_PAYANT_ID } from '../../../config/plans'
import { ValidationError } from '../../../exceptions/http'
import { appliquerMoyensActifs, lireInstantaneSansCache } from '../lecture'
import { MOYENS_PAIEMENT } from '../../../config/paiements'
import type { AdaptateurVersion } from './types'

export const adaptateurPrix: AdaptateurVersion<ValeursPrix> = {
  type: 'prix',
  categorie: VERSION_CATEGORIE_PAR_TYPE.prix,
  schemaValeurs: schemaValeursPrix,
  async validerCoherence(tx, cle, valeurs) {
    if (cle !== PLAN_PAYANT_ID) throw new ValidationError({ cle: ['Seul le plan payant a un prix.'] })
    const { moyensActifs } = await lireInstantaneSansCache(tx)
    const champs: Record<string, string[]> = {}
    for (const moyen of appliquerMoyensActifs(MOYENS_PAIEMENT, moyensActifs).filter((m) => m.actif)) {
      const grille = (valeurs as Record<string, Record<number, number> | undefined>)[moyen.devise]
      if (grille === undefined) continue
      for (const periode of PERIODES_MOIS) {
        const montant = grille[periode]
        if (montant !== undefined && montant < moyen.montantMin) {
          champs[`valeurs.${moyen.devise}.${periode}`] = [`Inférieur au montant minimal du moyen (${moyen.montantMin}).`]
        }
      }
    }
    if (Object.keys(champs).length > 0) throw new ValidationError(champs)
  },
}
