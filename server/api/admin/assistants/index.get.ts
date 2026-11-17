import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toListeAssistants } from '#server/resources/admin-a2'
import { listerAssistants } from '#server/services/admin/assistants'
import { schemaListeAssistantsQuery } from '#shared/schemas/admin-a2'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { utilisateurId } = lireRequete(event, schemaListeAssistantsQuery)
  return toListeAssistants(await listerAssistants(utilisateurId))
})
