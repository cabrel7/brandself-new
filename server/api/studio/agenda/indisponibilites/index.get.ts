import { defineApiHandler } from '#server/utils/api'
import { toIndisponibiliteResource } from '#server/resources/agenda'
import { listOwnIndisponibilites } from '#server/services/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { items } = await listOwnIndisponibilites(user.id)
  return { items: items.map(toIndisponibiliteResource) }
})
