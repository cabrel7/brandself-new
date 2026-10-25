import { defineEventHandler, readBody, createError } from 'h3'
import { db } from '#server/utils/db'
import { users } from '#shared/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schemaMoi = z.object({
  locale: z.string().trim().min(2).max(10).default('fr'),
  devise: z.string().trim().min(3).max(3).default('XAF'),
  fuseau: z.string().trim().min(1).default('Africa/Douala'),
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaMoi.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const [updated] = await db
    .update(users)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Utilisateur introuvable.' })
  }

  return { user: updated }
})
