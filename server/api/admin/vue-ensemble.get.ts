import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toVueEnsemble } from '#server/resources/admin'
import { lireVueEnsemble } from '#server/services/admin/vue-ensemble'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  return toVueEnsemble(lireVueEnsemble(admin))
})
