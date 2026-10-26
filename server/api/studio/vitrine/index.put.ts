import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toVitrineStudioResource } from '#server/resources/vitrine'
import { updateVitrine } from '#server/services/vitrines'
import { schemaVitrineUpdate } from '#shared/schemas/vitrine'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const patch = await readBodyWith(event, schemaVitrineUpdate)
  return { vitrine: toVitrineStudioResource(await updateVitrine(user.id, patch)) }
})
