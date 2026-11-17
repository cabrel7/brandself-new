import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, lireIdParam } from '#server/utils/admin-a2'
import { toRevocation } from '#server/resources/admin-a2'
import { revoquerSessions } from '#server/services/admin/utilisateurs'
import { schemaActionMotif } from '#shared/schemas/admin-a2'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const { motif } = await lireCorps(event, schemaActionMotif)
  return toRevocation(await revoquerSessions(admin.adminId, id, motif, admin.ip))
})
