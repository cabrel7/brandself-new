import { defineEventHandler, getQuery, createError } from 'h3'
import { db } from '#server/utils/db'
import { vitrines } from '#shared/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const query = getQuery(event)
  const username = typeof query.username === 'string' ? query.username.trim().toLowerCase() : ''

  if (!username) {
    throw createError({ statusCode: 400, statusMessage: 'L\'adresse est requise.' })
  }

  const [existing] = await db
    .select({ id: vitrines.id })
    .from(vitrines)
    .where(eq(vitrines.username, username))
    .limit(1)

  const disponible = !existing || existing.id === userId

  return { disponible, username }
})
