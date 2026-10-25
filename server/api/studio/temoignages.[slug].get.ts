import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { temoignages, vitrines } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const slug = event.context.params?.slug as string

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.userId, userId),
  })
  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  const temoignage = await db.query.temoignages.findFirst({
    where: eq(temoignages.slug, slug),
  })

  if (!temoignage || temoignage.vitrineId !== vitrine.id) {
    throw createError({ statusCode: 404, statusMessage: 'Témoignage introuvable.' })
  }

  return { temoignage }
})
