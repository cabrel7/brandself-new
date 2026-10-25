import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { services, vitrines } from '#shared/db/schema'
import { schemaServiceUpdate } from '#shared/schemas/service'
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
  const result = schemaServiceUpdate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [service] = await db
    .update(services)
    .set({ ...result.data, updatedAt: new Date() })
    .where(and(eq(services.slug, slug), eq(services.vitrineId, vitrine.id)))
    .returning()

  if (!service) {
    throw createError({ statusCode: 404, statusMessage: 'Service introuvable.' })
  }

  return { service }
})
