import { setResponseHeader, setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toGenerationResource } from '#server/resources/generation'
import { ameliorer } from '#server/services/ia/ameliorer'
import { getIaQuota } from '#server/services/plans'
import { schemaAmeliorerInput } from '#shared/schemas/ia'

// S8 §6 : « Améliorer avec l'IA ». 202 : le travail se fait dans un job. Le texte proposé n'est jamais
// écrit dans la vitrine ; l'utilisateur l'accepte puis enregistre lui-même. Jamais mis en cache.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await readBodyWith(event, schemaAmeliorerInput)
  const { generation } = await ameliorer(user.id, input)
  const quota = await getIaQuota(user.id)
  setResponseStatus(event, 202)
  return { generation: toGenerationResource(generation), quota }
})
