// S16 : écriture dans le journal des appels d'assistant (`journal_assistant`).
// Le JSON est admis ici uniquement. Avant/après ne sont remplis que pour les outils de modification.

import { randomUUID } from 'node:crypto'
import { db } from '../utils/db'
import { journalAssistant } from '../../shared/db/schema'

export interface ÉcritureJournal {
  userId: string
  assistantId: string
  outil: string
  argumentsResume: unknown
  resultat?: unknown
  avant?: unknown
  apres?: unknown
}

export async function journaliserAppel({
  userId,
  assistantId,
  outil,
  argumentsResume,
  resultat,
  avant,
  apres,
}: ÉcritureJournal): Promise<void> {
  await db
    .insert(journalAssistant)
    .values({
      id: randomUUID(),
      userId,
      assistantId,
      outil,
      argumentsResume: argumentsResume as unknown as Record<string, unknown>,
      resultat: resultat as unknown as Record<string, unknown> | null,
      avant: avant as unknown as Record<string, unknown> | null,
      apres: apres as unknown as Record<string, unknown> | null,
    })
}