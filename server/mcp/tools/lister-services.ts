// S16 : handler de l'outil lister_services (lecture seule).
// Liste tous les services de la vitrine, publiés ou brouillons.

import { listOwnServices } from '../../services/services'
import type { ContexteMcp, Scope } from '../types'

export interface ServiceResume {
  id: string
  slug: string
  titre: string
  description: string | null
  actif: boolean
  enVedette: boolean
  source: string
  masqueParPlan: boolean
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
): Promise<ServiceResume[]> {
  const resultat = await listOwnServices(contexte.userId)
  return resultat.items.map((entry) => ({
    id: entry.service.id,
    slug: entry.service.slug,
    titre: entry.service.titre,
    description: entry.service.description,
    actif: entry.service.actif,
    enVedette: entry.service.enVedette,
    source: entry.service.source,
    masqueParPlan: entry.service.masqueParPlan,
  }))
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
