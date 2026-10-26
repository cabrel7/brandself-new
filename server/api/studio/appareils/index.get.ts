import { defineApiHandler } from '#server/utils/api'
import { toAppareilResource } from '#server/resources/utilisateur'
import { listDevices } from '#server/services/utilisateurs'

export default defineApiHandler(async (event) => {
  const { user, session } = await requireUserSession(event)
  const appareils = await listDevices(user.id, session.id)
  return { appareils: appareils.map((appareil) => toAppareilResource(appareil)) }
})
