import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { temoignages, vitrines } from '#shared/db/schema'
import { schemaTemoignageUpdate } from '#shared/schemas/temoignage'
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

  const body = await readBody(event)
  const result = schemaTemoignageUpdate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [temoignage] = await db
    .update(temoignages)
    .set({ ...result.data, updatedAt: new Date() })
    .where(and(eq(temoignages.slug, slug), eq(temoignages.vitrineId, vitrine.id)))
    .returning()

  if (!temoignage) {
    throw createError({ statusCode: 404, statusMessage: 'Témoignage introuvable.' })
  }

  return { temoignage }
})
