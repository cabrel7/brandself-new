import { defineApiHandler } from '#server/utils/api'
import { readParamsWith, readQueryWith } from '#server/utils/validation'
import { toCreneauxPublicResource } from '#server/resources/agenda'
import { listCreneaux } from '#server/services/creneaux'
import { schemaCreneauxQuery, schemaPublicUsernameParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  const query = readQueryWith(event, schemaCreneauxQuery)
  const result = await listCreneaux({
    username,
    serviceSlug: query.service,
    du: query.du,
    au: query.au,
    maintenant: new Date(),
  })
  return toCreneauxPublicResource(result)
})
