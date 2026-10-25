import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { medias } from '#shared/db/schema'
import { deleteMedia } from '#server/services/medias'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const mediaId = event.context.params?.id as string

  const [existing] = await db
    .select()
    .from(medias)
    .where(and(eq(medias.id, mediaId), eq(medias.userId, userId)))
    .limit(1)

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Média introuvable.' })
  }

  await deleteMedia(userId, mediaId)
  await db.delete(medias).where(eq(medias.id, mediaId))

  return { ok: true }
})
