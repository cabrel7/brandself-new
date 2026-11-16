import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toEtatFiles } from '#server/resources/admin-a4'
import { lireEtatFiles } from '#server/services/admin/supervision-files'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toEtatFiles(await lireEtatFiles())
})
