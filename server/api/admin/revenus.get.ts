import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toRevenus } from '#server/resources/admin-paiements'
import { lireRevenus } from '#server/services/admin/revenus'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toRevenus(await lireRevenus())
})
