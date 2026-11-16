import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toSante } from '#server/resources/admin-a4'
import { lireSante } from '#server/services/admin/sante'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toSante(await lireSante())
})
