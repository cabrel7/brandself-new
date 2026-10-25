import { defineEventHandler, createError } from 'h3'
import { db } from '#server/utils/db'
import { temoignages, vitrines } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const vitrine = await db.query.vitrines.findFirst({
    where: eq(vitrines.userId, userId),
  })
  if (!vitrine) {
    throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable.' })
  }

  const liste = await db.query.temoignages.findMany({
    where: eq(temoignages.vitrineId, vitrine.id),
    orderBy: (temoignages, { asc }) => [asc(temoignages.ordre), asc(temoignages.auteur)],
  })

  return { temoignages: liste }
})
