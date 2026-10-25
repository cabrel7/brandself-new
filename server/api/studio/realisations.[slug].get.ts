import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { realisations, vitrines } from '#shared/db/schema'
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

  const realisation = await db.query.realisations.findFirst({
    where: eq(realisations.slug, slug),
  })

  if (!realisation || realisation.vitrineId !== vitrine.id) {
    throw createError({ statusCode: 404, statusMessage: 'Réalisation introuvable.' })
  }

  return { realisation }
})
