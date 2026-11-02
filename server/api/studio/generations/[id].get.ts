import { getRouterParams, setResponseHeader } from 'h3'
import { NotFoundError } from '#server/exceptions/http'
import { defineApiHandler } from '#server/utils/api'
import { toGenerationResource } from '#server/resources/generation'
import { getOwnGeneration } from '#server/services/ia/generations'
import { schemaGenerationIdParams } from '#shared/schemas/onboarding'

// S8 §6 : un identifiant mal formé est « introuvable » (404), jamais une erreur de validation (400) :
// rien ne distingue une génération inconnue, d'autrui ou mal écrite. Jamais mise en cache.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const params = schemaGenerationIdParams.safeParse(getRouterParams(event, { decode: true }))
  if (!params.success) throw new NotFoundError('GENERATION_INTROUVABLE')
  return { generation: toGenerationResource(await getOwnGeneration(user.id, params.data.id)) }
})
