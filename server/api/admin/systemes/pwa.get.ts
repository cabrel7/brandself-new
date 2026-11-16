import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toAgregatsPwa } from '#server/resources/admin-a4'
import { lireAgregatsPwa } from '#server/services/admin/agregats-pwa'
import { schemaJoursQuery } from '#shared/schemas/admin-a4'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { jours } = lireRequete(event, schemaJoursQuery)
  return toAgregatsPwa(await lireAgregatsPwa(jours))
})
