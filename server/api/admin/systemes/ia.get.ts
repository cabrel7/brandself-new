import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toAgregatsIa } from '#server/resources/admin-a4'
import { lireAgregatsIa } from '#server/services/admin/agregats-ia'
import { schemaJoursQuery } from '#shared/schemas/admin-a4'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { jours } = lireRequete(event, schemaJoursQuery)
  return toAgregatsIa(await lireAgregatsIa(jours))
})
