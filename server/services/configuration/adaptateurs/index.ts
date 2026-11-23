import { adaptateurEssai } from './essai'
import { adaptateurFrais } from './frais'
import { adaptateurMoyens } from './moyens'
import { adaptateurPlans } from './plans'
import { adaptateurPrix } from './prix'

export type { AdaptateurVersion } from './types'
export { adaptateurEssai, adaptateurFrais, adaptateurMoyens, adaptateurPlans, adaptateurPrix }

export const ADAPTATEURS = {
  plans: adaptateurPlans,
  prix: adaptateurPrix,
  frais: adaptateurFrais,
  moyens: adaptateurMoyens,
  essai: adaptateurEssai,
} as const
