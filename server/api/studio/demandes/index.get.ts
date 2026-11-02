import { defineApiHandler } from '#server/utils/api'
import { toDemandeStudioResource } from '#server/resources/agenda'
import { listOwnDemandes } from '#server/services/demandes'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items } = await listOwnDemandes(user.id)
  return { items: items.map(toDemandeStudioResource) }
})
