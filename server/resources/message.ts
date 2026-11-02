import type { MessageCreatedDTO, MessageStudioDTO, MessagesStudioReponse } from '../../shared/dto/message'
import { SUJETS_MESSAGE } from '../../shared/message'
import type { SujetMessage } from '../../shared/message'
import type { MessageRow } from '../services/messages'

function sujetMessage(value: string): SujetMessage {
  if ((SUJETS_MESSAGE as readonly string[]).includes(value)) return value as SujetMessage
  throw new Error('Sujet de message invalide en base.')
}

/** Réponse 201 de POST /api/public/:username/messages — trois clés, pas une de plus. */
export function toMessageCreatedResource(item: MessageRow): MessageCreatedDTO {
  return {
    message: {
      id: item.id,
      sujet: sujetMessage(item.sujet),
      creeLe: item.createdAt.toISOString(),
    },
  }
}

/** Liste du studio (§4.6) : DTO pur, aucune clé technique d'ORM (vitrineId absent). */
export function toMessagesStudioResource(liste: { items: MessageRow[], nonLus: number }): MessagesStudioReponse {
  return {
    items: liste.items.map((item): MessageStudioDTO => ({
      id: item.id,
      nom: item.nom,
      email: item.email,
      telephone: item.telephone,
      sujet: sujetMessage(item.sujet),
      message: item.message,
      luLe: item.luLe?.toISOString() ?? null,
      creeLe: item.createdAt.toISOString(),
    })),
    nonLus: liste.nonLus,
  }
}

/** Réponse du marquage lu (§4.7) : luLe est toujours défini après un marquage. */
export function toMessageLuResource(item: MessageRow): { item: { id: string, luLe: string } } {
  if (item.luLe === null) throw new Error('Un message marqué lu doit porter une date de lecture.')
  return { item: { id: item.id, luLe: item.luLe.toISOString() } }
}
