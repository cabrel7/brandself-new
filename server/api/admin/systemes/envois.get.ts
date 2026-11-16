import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toEnvois } from '#server/resources/admin-a4'
import { agregerEnvois } from '#server/services/envois-codes'
import { schemaEnvoisQuery } from '#shared/schemas/admin-a4'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { jours } = lireRequete(event, schemaEnvoisQuery)
  const maintenant = new Date()
  return toEnvois(jours, await agregerEnvois(jours, maintenant), maintenant)
})
