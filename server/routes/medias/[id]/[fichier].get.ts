import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { sendMediaVariant } from '#server/utils/media-response'
import { readParamsWith } from '#server/utils/validation'
import { readMediaVariantByFilename } from '#server/services/medias'

// Pas de validation stricte ici : un id ou un nom de fichier invalide est un 404 (décidé par le service).
const schemaParams = z.object({ id: z.string(), fichier: z.string() })

export default defineApiHandler(async (event) => {
  const { id, fichier } = readParamsWith(event, schemaParams)
  const { data, width } = await readMediaVariantByFilename(id, fichier)
  return sendMediaVariant(event, id, width, data)
})
