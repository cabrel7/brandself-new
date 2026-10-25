import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { services, vitrines } from '#shared/db/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const username = event.context.params?.username as string

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.username, username),
  })
  if (!vitrine || !vitrine.publieeLe) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable ou non publiée.' })
  }

  const liste = await db.query.services.findMany({
    where: and(eq(services.vitrineId, vitrine.id), eq(services.actif, true)),
    orderBy: (services, { asc }) => [asc(services.ordre), asc(services.titre)],
  })

  return { services: liste }
})
