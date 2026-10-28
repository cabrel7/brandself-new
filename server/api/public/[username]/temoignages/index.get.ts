import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toTemoignagePublicCarteResource } from '#server/resources/temoignage'
import { getPublicTemoignages } from '#server/services/temoignages'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const { total, temoignages } = await getPublicTemoignages(username)
  return {
    total,
    temoignages: temoignages.map(toTemoignagePublicCarteResource),
  }
})
