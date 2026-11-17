import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { lireParametres } from '#server/utils/admin-a5'
import { toListeCatalogue } from '#server/resources/admin-a5'
import { listerCatalogue } from '#server/services/configuration/catalogues'
import { schemaCatalogueNomParam, schemaListeCatalogueQuery } from '#shared/schemas/admin-catalogues'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { nom } = lireParametres(event, schemaCatalogueNomParam)
  const { page, limite } = lireRequete(event, schemaListeCatalogueQuery)
  return toListeCatalogue(nom, await listerCatalogue(nom, page, limite))
})
