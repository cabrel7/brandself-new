import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toAdminSession } from '#server/resources/admin'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  return toAdminSession(admin)
})
