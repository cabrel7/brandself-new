import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toVitrineStudioResource } from '#server/resources/vitrine'
import { changeUsername } from '#server/services/vitrines'
import { schemaUsernameChange } from '#shared/schemas/vitrine'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { username } = await readBodyWith(event, schemaUsernameChange)
  return { vitrine: toVitrineStudioResource(await changeUsername(user.id, username)) }
})
