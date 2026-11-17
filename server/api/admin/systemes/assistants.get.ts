import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toAgregatsAssistants } from '#server/resources/admin-a4'
import { lireAgregatsAssistants } from '#server/services/admin/agregats-assistants'
import { schemaJoursQuery } from '#shared/schemas/admin-a4'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { jours } = lireRequete(event, schemaJoursQuery)
  return toAgregatsAssistants(await lireAgregatsAssistants(jours))
})
