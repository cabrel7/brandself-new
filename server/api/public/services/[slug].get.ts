import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { services, vitrines } from '#shared/db/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const username = event.context.params?.username as string
  const slug = event.context.params?.slug as string

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.username, username),
  })
  if (!vitrine || !vitrine.publieeLe) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable ou non publiée.' })
  }

  const service = await db.query.services.findFirst({
    where: and(eq(services.slug, slug), eq(services.vitrineId, vitrine.id), eq(services.actif, true)),
  })

  if (!service) {
    throw createError({ statusCode: 404, statusMessage: 'Service introuvable.' })
  }

  return { service }
})
