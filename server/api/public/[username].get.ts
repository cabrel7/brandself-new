import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { vitrines, users, medias } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const username = event.context.params?.username as string

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.username, username),
  })

  if (!vitrine || !vitrine.publieeLe) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable ou non publiée.' })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, vitrine.userId),
  })

  let photoMedia = null
  if (vitrine.photoMediaId) {
    photoMedia = await db.query.medias.findFirst({
      where: eq(medias.id, vitrine.photoMediaId),
    })
  }

  return { vitrine, user, photoMedia }
})
