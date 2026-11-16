import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readQueryWith } from '#server/utils/validation'
import { toListeAbonnements } from '#server/resources/admin-paiements'
import { listerAbonnements } from '#server/services/admin/abonnements'
import { schemaListeAbonnementsQuery } from '#shared/schemas/admin-paiements'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const query = readQueryWith(event, schemaListeAbonnementsQuery)
  return toListeAbonnements(await listerAbonnements(query))
})
