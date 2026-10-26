import { defineEventHandler, readBody, createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '#server/utils/db'
import { liens, vitrines } from '#shared/db/schema'
import { schemaLienCreate } from '#shared/schemas/lien'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaLienCreate.safeParse(body)
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

  const [lien] = await db
    .insert(liens)
    .values({
      id: randomUUID(),
      vitrineId: vitrine.id,
      ...result.data,
    })
    .returning()

  return { lien }
})
