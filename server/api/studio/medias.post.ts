import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { db } from '#server/utils/db'
import { medias } from '#shared/db/schema'
import { uploadMedia } from '#server/services/medias'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.name === 'file' && p.data && p.filename)
  if (!filePart?.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun fichier fourni.' })
  }

  const media = await uploadMedia(userId, filePart.data)

  const [entry] = await db
    .insert(medias)
    .values({
      id: media.id,
      userId,
      disk: 'local',
      chemin: media.chemin,
      mime: media.mime,
      taille: media.taille,
      largeur: media.largeur,
      hauteur: media.hauteur,
    })
    .returning()

  return { media: entry }
})
