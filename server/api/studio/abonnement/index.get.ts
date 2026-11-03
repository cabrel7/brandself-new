import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { toAbonnementResource } from '#server/resources/abonnement'
import { getAbonnementView } from '#server/services/abonnements'

// S10 §4 : carte Abonnement du Compte. Jamais mise en cache (état dépendant du temps et du paiement).
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return toAbonnementResource(await getAbonnementView(user.id, new Date()))
})
