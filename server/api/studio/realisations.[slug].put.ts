import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { realisations, vitrines } from '#shared/db/schema'
import { schemaRealisationUpdate } from '#shared/schemas/realisation'
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
  const result = schemaRealisationUpdate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [realisation] = await db
    .update(realisations)
    .set({ ...result.data, updatedAt: new Date() })
    .where(and(eq(realisations.slug, slug), eq(realisations.vitrineId, vitrine.id)))
    .returning()

  if (!realisation) {
    throw createError({ statusCode: 404, statusMessage: 'Réalisation introuvable.' })
  }

  return { realisation }
})
