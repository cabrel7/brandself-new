import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toServicePublicCarteResource, toServicePublicDetailResource } from '#server/resources/service'
import { getPublicService, resolveServiceOptions } from '#server/services/services'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour un username ou un slug invalide.
const schemaParams = z.object({ username: z.string(), slug: z.string() })

export default defineApiHandler(async (event) => {
  const { username, slug } = readParamsWith(event, schemaParams)
  const { vitrine, item, autres, total } = await getPublicService(username, slug)
  return {
    service: toServicePublicDetailResource(item.service, item.image, vitrine, resolveServiceOptions()),
    autres: autres.map(({ service, image }) => toServicePublicCarteResource(service, image)),
    total,
  }
})
