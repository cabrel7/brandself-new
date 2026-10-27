import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toRealisationPublicCarteResource } from '#server/resources/realisation'
import { getPublicRealisations } from '#server/services/realisations'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const { total, aLaUne, realisations } = await getPublicRealisations(username)
  return {
    total,
    aLaUne: aLaUne.map(({ realisation, image }) => toRealisationPublicCarteResource(realisation, image)),
    realisations: realisations.map(({ realisation, image }) => toRealisationPublicCarteResource(realisation, image)),
  }
})
