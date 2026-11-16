import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toListeReglages } from '#server/resources/admin-a4'
import { listerReglages } from '#server/services/admin/reglages'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toListeReglages(await listerReglages())
})
