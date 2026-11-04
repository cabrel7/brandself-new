import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toContenusPublicsResource, toVitrinePublicResource } from '#server/resources/vitrine'
import { getPublicVitrinePage } from '#server/services/vitrines'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const page = await getPublicVitrinePage(username)
  return {
    vitrine: toVitrinePublicResource(page.vitrine, page.badgeBrandself),
    contenus: toContenusPublicsResource(page.contenus),
  }
})
