import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toMoiResource } from '#server/resources/utilisateur'
import { updateMe } from '#server/services/utilisateurs'
import { schemaMoiUpdate } from '#shared/schemas/moi'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const patch = await readBodyWith(event, schemaMoiUpdate)
  return { moi: toMoiResource(await updateMe(user.id, patch)) }
})
