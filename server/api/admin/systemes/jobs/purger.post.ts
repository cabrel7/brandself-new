import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, reauthPour } from '#server/utils/admin-a2'
import { toPurgeFiles } from '#server/resources/admin-a4'
import { purgerEchecs } from '#server/services/admin/supervision-files'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaJobPurger } from '#shared/schemas/admin-a4'

// Réauthentification exigée : jobs `failed` seulement, 1 000 au plus, journalisée.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const corps = await lireCorps(event, schemaJobPurger)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.jobPurger, ADMIN_CIBLES.job, corps.file)
  return toPurgeFiles(await purgerEchecs(admin.adminId, corps, admin.ip, { reauth }))
})
