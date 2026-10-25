import { defineEventHandler, readBody, createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '#server/utils/db'
import { temoignages, vitrines } from '#shared/db/schema'
import { schemaTemoignageCreate } from '#shared/schemas/temoignage'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaTemoignageCreate.safeParse(body)
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

  const [temoignage] = await db
    .insert(temoignages)
    .values({
      id: randomUUID(),
      vitrineId: vitrine.id,
      slug: result.data.slug,
      auteur: result.data.auteur,
      fonction: result.data.fonction,
      texte: result.data.texte,
      enVedette: result.data.enVedette,
      ordre: result.data.ordre,
      actif: result.data.actif,
    })
    .returning()

  return { temoignage }
})
