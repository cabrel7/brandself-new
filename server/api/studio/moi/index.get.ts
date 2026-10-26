import { defineApiHandler } from '#server/utils/api'
import { toMoiResource } from '#server/resources/utilisateur'
import { getMe } from '#server/services/utilisateurs'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return { moi: toMoiResource(await getMe(user.id)) }
})
