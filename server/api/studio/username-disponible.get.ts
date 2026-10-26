import { defineApiHandler } from '#server/utils/api'
import { readQueryWith } from '#server/utils/validation'
import { checkUsernameAvailability } from '#server/services/vitrines'
import { schemaUsernameQuery } from '#shared/schemas/username'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { username } = readQueryWith(event, schemaUsernameQuery)
  return checkUsernameAvailability(user.id, username)
})
