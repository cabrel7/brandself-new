import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readMediaUpload } from '#server/utils/upload'
import { toMediaResource } from '#server/resources/media'
import { uploadMedia } from '#server/services/medias'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const data = await readMediaUpload(event)
  const media = await uploadMedia(user.id, data)
  setResponseStatus(event, 201)
  return { media: toMediaResource(media) }
})
