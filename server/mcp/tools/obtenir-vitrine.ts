// S16 : handler de l'outil obtenir_vitrine (lecture seule).
// État de la vitrine, plan, compteurs de services et réalisations, prochaines étapes.

import { getStudioView } from '../../services/vitrines'
import { getPlanEffectif } from '../../services/plans'
import type { ContexteMcp, Scope } from '../types'

export interface VitrineEtat {
  publiee: boolean
  plan: string
  etatAbonnement: string
  nbServices: number
  nbRealisations: number
  prochaineEtape: string | null
  lienStudio: string
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
): Promise<VitrineEtat> {
  const vue = await getStudioView(contexte.userId)
  const plan = await getPlanEffectif(contexte.userId)

  const nbServices = vue.resume.compteurs.services
  const nbRealisations = vue.resume.compteurs.realisations

  return {
    publiee: vue.vitrine.vitrine.publieeLe !== null,
    plan: plan.plan,
    etatAbonnement: plan.etat,
    nbServices,
    nbRealisations,
    prochaineEtape: vue.resume.prochaineEtape ?? null,
    lienStudio: `/studio/${vue.vitrine.vitrine.username}`,
  }
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
