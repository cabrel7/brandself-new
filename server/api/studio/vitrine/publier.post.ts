import { defineApiHandler } from '#server/utils/api'
import { toVitrineStudioResource } from '#server/resources/vitrine'
import { publishVitrine } from '#server/services/vitrines'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return { vitrine: toVitrineStudioResource(await publishVitrine(user.id)) }
})
