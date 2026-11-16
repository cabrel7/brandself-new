import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toVueEnsembleEnrichie } from '#server/resources/admin-paiements'
import { lireVueEnsembleEnrichie } from '#server/services/admin/revenus-vue-ensemble'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  return toVueEnsembleEnrichie(await lireVueEnsembleEnrichie(admin))
})
