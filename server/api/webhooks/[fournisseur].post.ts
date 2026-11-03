import { getRouterParams, setResponseHeader } from 'h3'
import { NotFoundError } from '#server/exceptions/http'
import { defineApiHandler } from '#server/utils/api'
import { traiterWebhook } from '#server/services/webhooks-paiement'
import { schemaWebhookFournisseur } from '#shared/schemas/abonnement'

// S10 §4 : webhook d'un fournisseur de paiement. Ni session, ni Origin : la signature du corps BRUT est
// l'autorisation (vérifiée par le service avant tout parsing). Le corps n'est lu qu'ici, en flux borné.
export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const params = schemaWebhookFournisseur.safeParse(getRouterParams(event, { decode: true }))
  if (!params.success) throw new NotFoundError('FOURNISSEUR_INCONNU')
  return traiterWebhook(params.data.fournisseur, event.node.req, event.node.req.headers, new Date())
})
