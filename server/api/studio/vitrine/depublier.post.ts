import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { vitrines } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const [vitrine] = await db
    .update(vitrines)
    .set({ publieeLe: null, updatedAt: new Date() })
    .where(eq(vitrines.userId, userId))
    .returning()

  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  return { vitrine }
})
