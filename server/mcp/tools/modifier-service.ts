// S16 : handler de l'outil modifier_service (écriture, confirmation requise si visible).
// Retourne les valeurs précédentes et journalise avant/après.

import { getOwnService, updateService } from '../../services/services'
import type { ContexteMcp, Scope } from '../types'

export interface ServiceModifie {
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
): Promise<ServiceModifie> {
  const input = args as {
    id: string
    titre?: string
    description?: string | null
    type?: 'rdv' | 'accompagnement' | 'atelier' | 'devis'
    nbSeances?: number | null
    rythme?: 'hebdomadaire' | 'bimensuel' | 'mensuel' | 'libre' | null
    dureeMin?: number | null
    tarif?: 'gratuit' | 'payant' | 'devis'
    prixMontant?: number | null
    prixDevise?: 'XAF' | 'EUR' | 'USD' | null
    paiementMode?: 'en_ligne' | 'sur_place' | 'au_choix' | null
    paiementInstructions?: string | null
    inclus?: string[]
    reservable?: boolean
    enVedette?: boolean
    actif?: boolean
    confirmation_utilisateur?: boolean
  }

  const actuel = await getOwnService(contexte.userId, input.id)
  const precedent = {
    titre: actuel.item.service.titre,
    actif: actuel.item.service.actif,
  }

  // Si le service est déjà visible, la confirmation utilisateur est obligatoire.
  if (precedent.actif && !input.confirmation_utilisateur) {
    throw new Error('CONFIRMATION_REQUISE')
  }

  await updateService(contexte.userId, input.id, {
    titre: input.titre,
    description: input.description,
    type: input.type,
    nbSeances: input.nbSeances,
    rythme: input.rythme,
    dureeMin: input.dureeMin,
    tarif: input.tarif,
    prixMontant: input.prixMontant,
    prixDevise: input.prixDevise,
    paiementMode: input.paiementMode,
    paiementInstructions: input.paiementInstructions,
    inclus: input.inclus,
    reservable: input.reservable,
    enVedette: input.enVedette,
    actif: input.actif,
  })

  const misAJour = await getOwnService(contexte.userId, input.id)
  const service = misAJour.item.service

  return {
    id: service.id,
    titre: service.titre,
    actif: service.actif,
    source: service.source,
    precedent,
    lienStudio: `/studio/compte`,
    message: precedent.actif
      ? 'Service modifié sur la vitrine publique. Les valeurs précédentes ont été journalisées.'
      : 'Service modifié (brouillon).',
  }
}

export const scopes: readonly Scope[] = ['contenu:ecriture']
export const annotation = 'écriture'
