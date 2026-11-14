import { sendNoContent } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { deconnecterAdmin, requireSuperadmin } from '#server/utils/admin'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  await deconnecterAdmin(event, admin)
  return sendNoContent(event)
})
