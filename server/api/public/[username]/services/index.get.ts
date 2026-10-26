import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toServicePublicCarteResource } from '#server/resources/service'
import { getPublicServices } from '#server/services/services'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string() })

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaParams)
  const { total, aLaUne, services } = await getPublicServices(username)
  return {
    total,
    aLaUne: aLaUne.map(({ service, image }) => toServicePublicCarteResource(service, image)),
    services: services.map(({ service, image }) => toServicePublicCarteResource(service, image)),
  }
})
