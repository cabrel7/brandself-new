// S16 : handler de l'outil modifier_realisation (écriture, confirmation requise si visible).
// Retourne les valeurs précédentes et journalise avant/après.

import { getOwnRealisation, updateRealisation } from '../../services/realisations'
import { ValidationError } from '../../exceptions/http'
import type { ContexteMcp, Scope } from '../types'

const MESSAGE_CONFIRMATION = 'Cette réalisation est déjà visible sur la vitrine publique. Demandez d’abord confirmation à l’utilisateur dans la conversation, puis renvoyez la demande avec confirmation_utilisateur à vrai.'

export interface RealisationModifiee {
  id: string
  titre: string
  actif: boolean
  source: string
  precedent: { titre: string, actif: boolean } | null
  lienStudio: string
  message: string
}

export async function executer(
  args: unknown,
  contexte: ContexteMcp,
): Promise<RealisationModifiee> {
  const input = args as {
    id: string
    titre?: string
    description?: string | null
    imageMediaId?: string | null
    galerie?: string[]
    annee?: number | null
    lieu?: string | null
    role?: string | null
    lien?: string | null
    enVedette?: boolean
    confirmation_utilisateur?: boolean
  }

  const actuel = await getOwnRealisation(contexte.userId, input.id)
  const precedent = {
    titre: actuel.item.realisation.titre,
    actif: actuel.item.realisation.actif,
  }

  // Si la réalisation est déjà visible, la confirmation utilisateur est obligatoire.
  if (precedent.actif && !input.confirmation_utilisateur) {
    throw new ValidationError({ confirmation_utilisateur: [MESSAGE_CONFIRMATION] }, MESSAGE_CONFIRMATION)
  }

  // Champ omis = inchangé : `undefined` n'écrase jamais (le service ne remplace la galerie que si elle est fournie).
  const galerie = input.galerie?.filter((id): id is string => id !== null && id !== undefined)

  await updateRealisation(contexte.userId, input.id, {
    titre: input.titre,
    description: input.description,
    imageMediaId: input.imageMediaId ?? undefined,
    galerie,
    annee: input.annee,
    lieu: input.lieu,
    role: input.role,
    lien: input.lien,
    enVedette: input.enVedette,
  })

  const misAJour = await getOwnRealisation(contexte.userId, input.id)
  const realisation = misAJour.item.realisation

  return {
    id: realisation.id,
    titre: realisation.titre,
    actif: realisation.actif,
    source: realisation.source,
    precedent,
    lienStudio: `/studio/compte`,
    message: precedent.actif
      ? 'Réalisation modifiée sur la vitrine publique. Les valeurs précédentes ont été journalisées.'
      : 'Réalisation modifiée (brouillon).',
  }
}

export const scopes: readonly Scope[] = ['contenu:ecriture']
export const annotation = 'écriture'
