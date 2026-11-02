import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toDemandeCreatedResource } from '#server/resources/agenda'
import { createDemande } from '#server/services/demandes'
import { enforceLimit } from '#server/services/limiteur'
import { DEMANDE_PUBLIC_LIMIT } from '#shared/limites'
import { schemaDemandeCreate, schemaPublicUsernameParams } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  const ip = getClientIp(event)
  await enforceLimit(`demande-publique:${ip}`, DEMANDE_PUBLIC_LIMIT.limit, DEMANDE_PUBLIC_LIMIT.windowS, {
    failClosed: true,
  })
  const input = await readBodyWith(event, schemaDemandeCreate)
  const { item } = await createDemande(username, {
    serviceSlug: input.service,
    nom: input.nom,
    email: input.email,
    telephone: input.telephone,
    message: input.message,
  })
  setResponseStatus(event, 201)
  return toDemandeCreatedResource(item)
})
