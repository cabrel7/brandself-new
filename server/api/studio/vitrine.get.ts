import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { vitrines } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.userId, userId),
  })

  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  return { vitrine }
})
