import { sendNoContent } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readParamsWith } from '#server/utils/validation'
import { deleteTemoignageBySlug } from '#server/services/temoignages'
import { schemaTemoignageParams } from '#shared/schemas/temoignage'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { slug } = readParamsWith(event, schemaTemoignageParams)
  await deleteTemoignageBySlug(user.id, slug)
  return sendNoContent(event)
})
