import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { toPaiementResource } from '#server/resources/abonnement'
import { suivrePaiement } from '#server/services/abonnements'
import { schemaPaiementId } from '#shared/schemas/abonnement'

// S10 §4 : suivi d'un paiement par le navigateur. Lit NOTRE base (jamais le fournisseur). Le paiement d'autrui est 404.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { id } = readParamsWith(event, schemaPaiementId)
  return { paiement: toPaiementResource(await suivrePaiement(user.id, id)) }
})
