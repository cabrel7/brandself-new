import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toAlertes } from '#server/resources/admin-paiements'
import { lireAlertes } from '#server/services/admin/alertes'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toAlertes(await lireAlertes())
})
