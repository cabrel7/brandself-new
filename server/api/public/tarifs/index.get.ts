import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readQueryWith } from '#server/utils/validation'
import { toTarifsResource } from '#server/resources/abonnement'
import { getTarifs } from '#server/services/abonnements'
import { schemaTarifsQuery } from '#shared/schemas/abonnement'

// S10 §4 : plans, limites et prix issus de la configuration serveur. Public, mis en cache 5 minutes.
const CACHE_TARIFS = 'public, max-age=300'

export default defineApiHandler(async (event) => {
  const { devise } = readQueryWith(event, schemaTarifsQuery)
  setResponseHeader(event, 'Cache-Control', CACHE_TARIFS)
  return toTarifsResource(getTarifs(devise))
})
