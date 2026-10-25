import { defineEventHandler, readBody, createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '#server/utils/db'
import { vitrines } from '#shared/db/schema'
import { schemaVitrineCreate } from '#shared/schemas/vitrine'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const body = await readBody(event)
  const result = schemaVitrineCreate.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Données invalides.',
      data: result.error.flatten(),
    })
  }

  const { titre, prenom, nom, metier, username } = result.data

  const [vitrine] = await db
    .insert(vitrines)
    .values({
      id: randomUUID(),
      userId,
      username,
      titre,
      prenom,
      nom,
      metier,
      ville: '',
      pays: '',
      palette: 'terracotta',
    })
    .returning()

  return { vitrine }
})
