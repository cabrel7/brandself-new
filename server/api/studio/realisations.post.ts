import { defineEventHandler, readBody, createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '#server/utils/db'
import { realisations, vitrines } from '#shared/db/schema'
import { schemaRealisationCreate } from '#shared/schemas/realisation'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaRealisationCreate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.userId, userId),
  })
  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  const [realisation] = await db
    .insert(realisations)
    .values({
      id: randomUUID(),
      vitrineId: vitrine.id,
      ...result.data,
    })
    .returning()

  return { realisation }
})
