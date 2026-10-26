import { defineApiHandler } from '#server/utils/api'
import { toStudioResumeResource, toVitrineStudioResource } from '#server/resources/vitrine'
import { getStudioView } from '#server/services/vitrines'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { vitrine, resume } = await getStudioView(user.id)
  return { vitrine: toVitrineStudioResource(vitrine), resume: toStudioResumeResource(resume) }
})
