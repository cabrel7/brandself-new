import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readQueryWith } from '#server/utils/validation'
import { toListePaiements } from '#server/resources/admin-paiements'
import { listerPaiements } from '#server/services/admin/paiements'
import { schemaListePaiementsQuery } from '#shared/schemas/admin-paiements'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const query = readQueryWith(event, schemaListePaiementsQuery)
  return toListePaiements(await listerPaiements(query))
})
