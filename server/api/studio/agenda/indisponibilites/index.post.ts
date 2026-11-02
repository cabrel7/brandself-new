import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toIndisponibiliteResource } from '#server/resources/agenda'
import { createIndisponibilite } from '#server/services/agenda'
import { schemaIndisponibiliteCreate } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaIndisponibiliteCreate)
  const { item } = await createIndisponibilite(user.id, input)
  setResponseStatus(event, 201)
  return { item: toIndisponibiliteResource(item) }
})
