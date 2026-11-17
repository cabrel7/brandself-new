import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { lireParametres } from '#server/utils/admin-a5'
import { toListeVersions } from '#server/resources/admin-a5'
import { listerVersions } from '#server/services/configuration/versions'
import { schemaHistoriqueVersionsQuery, schemaVersionTypeParam } from '#shared/schemas/admin-versions'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { type } = lireParametres(event, schemaVersionTypeParam)
  const { cle, page, limite } = lireRequete(event, schemaHistoriqueVersionsQuery)
  return toListeVersions(await listerVersions(type, { ...(cle === undefined ? {} : { cle }), page, limite }))
})
