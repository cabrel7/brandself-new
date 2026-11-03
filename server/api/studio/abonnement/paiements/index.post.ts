import { setResponseHeader, setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toPaiementResource } from '#server/resources/abonnement'
import { initierPaiement } from '#server/services/abonnements'
import { schemaPaiementInitier } from '#shared/schemas/abonnement'

// S10 §4 : initie un paiement Mobile Money (synchrone). Le numéro saisi n'est jamais stocké ni journalisé.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await readBodyWith(event, schemaPaiementInitier)
  const paiement = await initierPaiement(user.id, input, new Date())
  setResponseStatus(event, 201)
  return { paiement: toPaiementResource(paiement) }
})
