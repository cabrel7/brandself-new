// Adaptateur « plans » : limites chiffrées bornées (schéma), cohérence entre plans (D-A5-05) : un plan gratuit n'est
// jamais illimité (schéma) et chaque limite du gratuit reste au plus égale à celle du payant.
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../../shared/admin'
import { PLAN_IDS } from '../../../../shared/plans'
import type { PlanId } from '../../../../shared/plans'
import { schemaValeursPlan, VERSION_PLAN_LIMITES_CLES } from '../../../../shared/schemas/admin-versions'
import type { ValeursPlan } from '../../../../shared/schemas/admin-versions'
import { ValidationError } from '../../../exceptions/http'
import { lireInstantaneSansCache } from '../lecture'
import type { AdaptateurVersion } from './types'

const MESSAGE_GRATUIT_AU_PLUS_PAYANT = 'La limite du plan gratuit ne peut pas dépasser celle du plan payant.'

export const adaptateurPlans: AdaptateurVersion<ValeursPlan> = {
  type: 'plans',
  categorie: VERSION_CATEGORIE_PAR_TYPE.plans,
  schemaValeurs: schemaValeursPlan,
  async validerCoherence(tx, cle, valeurs) {
    if (!(PLAN_IDS as readonly string[]).includes(cle)) throw new ValidationError({ cle: ['Plan inconnu.'] })
    const autre: PlanId = cle === 'gratuit' ? 'payant' : 'gratuit'
    const { plans } = await lireInstantaneSansCache(tx)
    const gratuit = cle === 'gratuit' ? valeurs : plans[autre]
    const payant = cle === 'payant' ? valeurs : plans[autre]
    const champs: Record<string, string[]> = {}
    for (const limite of VERSION_PLAN_LIMITES_CLES) {
      const g = gratuit[limite]
      const p = payant[limite]
      if (g !== null && p !== null && g > p) champs[`valeurs.${limite}`] = [MESSAGE_GRATUIT_AU_PLUS_PAYANT]
    }
    if (Object.keys(champs).length > 0) throw new ValidationError(champs)
  },
}
