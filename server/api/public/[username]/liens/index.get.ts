import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toLienPublicCarteResource } from '#server/resources/lien'
import { getPublicLiens } from '#server/services/liens'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const { total, liens } = await getPublicLiens(username)
  return {
    total,
    liens: liens.map(toLienPublicCarteResource),
  }
})
