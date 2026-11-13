// S16 : handler de l'outil lister_messages (lecture seule, confidentialité par défaut).
// Par défaut : date locale, prénom + initiale, lu/non lu. Le sujet et le texte sont écrits par le visiteur : ils ne
// sortent qu'avec le détail autorisé, confinés dans `contenu_visiteur` (tronqué, données non fiables).

import { listOwnMessages } from '../../services/messages'
import { avecDetailVisiteur, prenomInitiale } from '../confidentialite'
import type { ContenuVisiteur } from '../confidentialite'
import { isoDansFuseau } from '../format'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

export type MessageResume = {
  id: string
  date: string
  expediteur: string
  lu: boolean
} & Partial<ContenuVisiteur>

export interface MessagesVue {
  fuseau: string
  items: MessageResume[]
  nonLus: number
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<MessagesVue> {
  const detail = options.detailAutorise === true
  const { items, nonLus } = await listOwnMessages(contexte.userId)

  return {
    fuseau: contexte.fuseau,
    items: items.map((message) => ({
      id: message.id,
      date: isoDansFuseau(message.createdAt, contexte.fuseau),
      expediteur: prenomInitiale(message.nom),
      lu: message.luLe !== null,
      ...avecDetailVisiteur(detail, { sujet: message.sujet, message: message.message }),
    })),
    nonLus,
  }
}

export const scopes: readonly Scope[] = ['messages:lecture']
export const annotation = 'lecture seule'
