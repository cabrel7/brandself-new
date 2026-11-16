import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { toActionEffectuee } from '#server/resources/admin-a2'
import { relancerJob } from '#server/services/admin/supervision-files'
import { schemaJobRelancer } from '#shared/schemas/admin-a4'

// Sans réauthentification (D-A4-02) ; refusé pour `messages-auth` (422 JOB_NON_RELANCABLE). Réponse sans donnée du job.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const corps = await lireCorps(event, schemaJobRelancer)
  const { rejoue } = await relancerJob(admin.adminId, corps, admin.ip)
  return toActionEffectuee(rejoue)
})
