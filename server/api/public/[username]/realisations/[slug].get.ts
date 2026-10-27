import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toRealisationPublicCarteResource, toRealisationPublicDetailResource } from '#server/resources/realisation'
import { getPublicRealisation } from '#server/services/realisations'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour un username ou un slug invalide.
const schemaParams = z.object({ username: z.string(), slug: z.string() })

export default defineApiHandler(async (event) => {
  const { username, slug } = readParamsWith(event, schemaParams)
  const { vitrine, item, autres, total } = await getPublicRealisation(username, slug)
  return {
    realisation: toRealisationPublicDetailResource(item.realisation, item.image, item.galerie, vitrine),
    autres: autres.map(({ realisation, image }) => toRealisationPublicCarteResource(realisation, image)),
    total,
  }
})
