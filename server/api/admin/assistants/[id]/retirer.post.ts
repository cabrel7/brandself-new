import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, lireIdParam } from '#server/utils/admin-a2'
import { toActionEffectuee } from '#server/resources/admin-a2'
import { retirerAssistant } from '#server/services/admin/assistants'
import { schemaActionMotif } from '#shared/schemas/admin-a2'

// `id` = identifiant du CONSENTEMENT (D-A2-15). Motif seul (D-A2-07).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const { motif } = await lireCorps(event, schemaActionMotif)
  await retirerAssistant(admin.adminId, id, motif, admin.ip)
  return toActionEffectuee()
})
