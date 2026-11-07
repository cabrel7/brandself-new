// S16 : handler de l'outil creer_realisation (écriture).
// Crée une réalisation en brouillon. Sans image principale, reste masquée et ne peut pas être activée.

import { createRealisation } from '../../services/realisations'
import { db } from '../../utils/db'
import { realisations } from '../../../shared/db/schema'
import { eq } from 'drizzle-orm'
import type { ContexteMcp, Scope } from '../types'

export interface RealisationCree {
  id: string
  slug: string
  titre: string
  actif: boolean
  source: string
  lienStudio: string
  message: string
}

export async function executer(
  args: unknown,
  contexte: ContexteMcp,
): Promise<RealisationCree> {
  const input = args as {
    titre: string
    description?: string | null
    imageMediaId?: string | null
    galerie?: string[]
    annee?: number | null
    lieu?: string | null
    role?: string | null
    lien?: string | null
    enVedette?: boolean
    actif?: boolean
  }

  const imageMediaId = input.imageMediaId ?? null
  const galerie = (input.galerie ?? []).filter((id): id is string => id !== null && id !== undefined)

  const resultat = await createRealisation(contexte.userId, {
    titre: input.titre,
    description: input.description ?? null,
    imageMediaId,
    galerie,
    annee: input.annee ?? null,
    lieu: input.lieu ?? null,
    role: input.role ?? null,
    lien: input.lien ?? null,
    enVedette: input.enVedette ?? false,
    actif: false,
  })

  const realisation = resultat.item.realisation

  // Marque l'origine assistant (brouillon créé par le MCP).
  await db
    .update(realisations)
    .set({ source: 'assistant', updatedAt: new Date() })
    .where(eq(realisations.id, realisation.id))

  const sansImage = imageMediaId === null
  return {
    id: realisation.id,
    slug: realisation.slug,
    titre: realisation.titre,
    actif: false,
    source: 'assistant',
    lienStudio: `/studio/compte`,
    message: sansImage
      ? 'Réalisation créée en brouillon (masquée). Ajoutez l’image principale dans le studio pour pouvoir publier cette réalisation.'
      : 'Réalisation créée en brouillon (masquée). Rendez-vous dans le studio pour la relire et l’activer.',
  }
}

export const scopes: readonly Scope[] = ['contenu:ecriture']
export const annotation = 'écriture'
