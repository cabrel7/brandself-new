import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { liens, vitrines } from '#shared/db/schema'
import { schemaLienUpdate } from '#shared/schemas/lien'
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
  const result = schemaLienUpdate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [lien] = await db
    .update(liens)
    .set({ ...result.data, updatedAt: new Date() })
    .where(and(eq(liens.slug, slug), eq(liens.vitrineId, vitrine.id)))
    .returning()

  if (!lien) {
    throw createError({ statusCode: 404, statusMessage: 'Lien introuvable.' })
  }

  return { lien }
})
