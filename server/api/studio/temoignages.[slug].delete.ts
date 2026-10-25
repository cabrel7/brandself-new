import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { temoignages, vitrines } from '#shared/db/schema'
import { eq, and } from 'drizzle-orm'

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

  const [temoignage] = await db
    .delete(temoignages)
    .where(and(eq(temoignages.slug, slug), eq(temoignages.vitrineId, vitrine.id)))
    .returning()

  if (!temoignage) {
    throw createError({ statusCode: 404, statusMessage: 'Témoignage introuvable.' })
  }

  return { ok: true }
})
