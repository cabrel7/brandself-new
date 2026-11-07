// S16 : handler de l'outil creer_service (écriture).
// Crée un service en brouillon (actif = false, source = assistant).

import { createService } from '../../services/services'
import { db } from '../../utils/db'
import { services } from '../../../shared/db/schema'
import { eq } from 'drizzle-orm'
import type { ContexteMcp, Scope } from '../types'

export interface ServiceCree {
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
  _options: { cleIdempotence?: string },
): Promise<ServiceCree> {
  const input = args as {
    titre: string
    description?: string | null
    type: 'rdv' | 'accompagnement' | 'atelier' | 'devis'
    nbSeances?: number | null
    rythme?: 'hebdomadaire' | 'bimensuel' | 'mensuel' | 'libre' | null
    dureeMin?: number | null
    tarif: 'gratuit' | 'payant' | 'devis'
    prixMontant?: number | null
    prixDevise?: 'XAF' | 'EUR' | 'USD' | null
    paiementMode?: 'en_ligne' | 'sur_place' | 'au_choix' | null
    paiementInstructions?: string | null
    inclus?: string[]
    reservable?: boolean
    enVedette?: boolean
    actif?: boolean
  }

  const resultat = await createService(contexte.userId, {
    titre: input.titre,
    description: input.description ?? null,
    imageMediaId: null,
    type: input.type,
    nbSeances: input.nbSeances ?? null,
    rythme: input.rythme ?? null,
    dureeMin: input.dureeMin ?? null,
    tarif: input.tarif,
    prixMontant: input.prixMontant ?? null,
    prixDevise: input.prixDevise ?? null,
    paiementMode: input.paiementMode ?? null,
    paiementInstructions: input.paiementInstructions ?? null,
    inclus: input.inclus ?? [],
    reservable: input.reservable ?? true,
    enVedette: input.enVedette ?? false,
    actif: false,
  })

  const service = resultat.item.service

  // Marque l'origine assistant (brouillon créé par le MCP).
  await db
    .update(services)
    .set({ source: 'assistant', updatedAt: new Date() })
    .where(eq(services.id, service.id))

  return {
    id: service.id,
    slug: service.slug,
    titre: service.titre,
    actif: false,
    source: 'assistant',
    lienStudio: `/studio/compte`,
    message: 'Service créé en brouillon (masqué). Rendez-vous dans le studio pour le relire et l’activer.',
  }
}

export const scopes: readonly Scope[] = ['contenu:ecriture']
export const annotation = 'écriture'
