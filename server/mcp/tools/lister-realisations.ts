// S16 : handler de l'outil lister_realisations (lecture seule).
// Liste toutes les réalisations de la vitrine, publiées ou brouillons.

import { listOwnRealisations } from '../../services/realisations'
import type { ContexteMcp, Scope } from '../types'

export interface RealisationResume {
  id: string
  slug: string
  titre: string
  description: string | null
  actif: boolean
  enVedette: boolean
  source: string
  masqueParPlan: boolean
  imagePrincipale: boolean
  galerie: number
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
): Promise<RealisationResume[]> {
  const resultat = await listOwnRealisations(contexte.userId)
  return resultat.items.map((entry) => ({
    id: entry.realisation.id,
    slug: entry.realisation.slug,
    titre: entry.realisation.titre,
    description: entry.realisation.description,
    actif: entry.realisation.actif,
    enVedette: entry.realisation.enVedette,
    source: entry.realisation.source,
    masqueParPlan: entry.realisation.masqueParPlan,
    imagePrincipale: entry.realisation.imageMediaId !== null,
    galerie: entry.galerie.length,
  }))
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
