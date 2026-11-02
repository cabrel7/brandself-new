import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { messages, vitrines } from '../../shared/db/schema'
import { NotFoundError } from '../exceptions/http'
import { db } from '../utils/db'
import { insertTransactionalEmailEvents } from './email-outbox'
import { requireVitrineId } from './vitrine-acces'
import { MESSAGES_LISTE_MAX } from '../../shared/message'
import type { MessageCreateInput } from '../../shared/message'

// S7-bis — domaine « Messages » : la page Contact d'une vitrine publiée crée un message
// et déclenche l'email au professionnel via l'outbox transactionnelle (écrite dans la
// même transaction : jamais de message sans email, jamais d'email sans message).
// Le studio liste les messages de SA vitrine (isolation par user) et marque la lecture
// de façon idempotente (premier dépliage).

export type MessageRow = typeof messages.$inferSelect

export async function createMessage(
  username: string,
  input: MessageCreateInput,
): Promise<{ item: MessageRow }> {
  return db.transaction(async (tx) => {
    // La page Contact n'existe que sur une vitrine publiée : username inconnu ou
    // vitrine dépubliée = même réponse (404), aucune écriture.
    const [vitrine] = await tx
      .select({ id: vitrines.id })
      .from(vitrines)
      .where(and(eq(vitrines.username, username.trim().toLowerCase()), isNotNull(vitrines.publieeLe)))
      .limit(1)
    if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')

    const [item] = await tx
      .insert(messages)
      .values({
        id: randomUUID(),
        vitrineId: vitrine.id,
        nom: input.nom,
        email: input.email,
        telephone: input.telephone,
        sujet: input.sujet,
        message: input.message,
      })
      .returning()
    if (!item) throw new Error('Insertion du message sans résultat.')
    await insertTransactionalEmailEvents(tx, 'message', item.id, ['message_professionnel_nouvelle'])
    return { item }
  })
}

export async function listOwnMessages(userId: string): Promise<{ items: MessageRow[], nonLus: number }> {
  const vitrineId = await requireVitrineId(userId)
  const items = await db
    .select()
    .from(messages)
    .where(eq(messages.vitrineId, vitrineId))
    .orderBy(desc(messages.createdAt), asc(messages.id))
    .limit(MESSAGES_LISTE_MAX)
  // Compteur global (pas sur la page plafonnée) : COUNT séparé sur tous les non lus.
  const [compte] = await db
    .select({ total: count() })
    .from(messages)
    .where(and(eq(messages.vitrineId, vitrineId), isNull(messages.luLe)))
  return { items, nonLus: Number(compte?.total ?? 0) }
}

export async function markMessageLu(userId: string, id: string): Promise<{ item: MessageRow }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ message: messages })
      .from(messages)
      .innerJoin(vitrines, eq(vitrines.id, messages.vitrineId))
      .where(and(eq(messages.id, id), eq(vitrines.userId, userId)))
      .for('update', { of: messages })
    // Id inconnu OU message d'une autre vitrine : même réponse (isolation).
    if (!current) throw new NotFoundError('MESSAGE_INTROUVABLE')
    // Idempotent : le re-marquage ne change jamais `lu_le`.
    if (current.message.luLe !== null) return { item: current.message }
    const [item] = await tx
      .update(messages)
      .set({ luLe: new Date(), updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning()
    if (!item) throw new NotFoundError('MESSAGE_INTROUVABLE')
    return { item }
  })
}
