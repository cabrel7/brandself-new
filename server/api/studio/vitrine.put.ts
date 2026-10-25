import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { vitrines } from '#shared/db/schema'
import { schemaVitrineUpdate } from '#shared/schemas/vitrine'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaVitrineUpdate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [vitrine] = await db
    .update(vitrines)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(vitrines.userId, userId))
    .returning()

  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  return { vitrine }
})
