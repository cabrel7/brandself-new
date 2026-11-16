import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toRecherche } from '#server/resources/admin-a2'
import { rechercher } from '#server/services/admin/recherche'
import { schemaRechercheQuery } from '#shared/schemas/admin-a2'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { q } = lireRequete(event, schemaRechercheQuery)
  return toRecherche(await rechercher(q))
})
