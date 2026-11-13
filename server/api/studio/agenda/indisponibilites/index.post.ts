import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toIndisponibiliteCreateResource } from '#server/resources/agenda'
import { createIndisponibilite } from '#server/services/agenda'
import { schemaIndisponibiliteCreate } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaIndisponibiliteCreate)
  const resultat = await createIndisponibilite(user.id, input)
  // Une plage entièrement déjà fermée ne crée rien : 200 plutôt que 201.
  setResponseStatus(event, resultat.type === 'plage' && resultat.creees === 0 ? 200 : 201)
  return toIndisponibiliteCreateResource(resultat)
})
