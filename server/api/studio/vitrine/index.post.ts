import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toStudioResumeResource, toVitrineStudioResource } from '#server/resources/vitrine'
import { createVitrine, getStudioView } from '#server/services/vitrines'
import { schemaVitrineCreate } from '#shared/schemas/vitrine'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaVitrineCreate)
  await createVitrine(user.id, input)
  const { vitrine, resume } = await getStudioView(user.id)
  setResponseStatus(event, 201)
  return { vitrine: toVitrineStudioResource(vitrine), resume: toStudioResumeResource(resume) }
})
