import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toListeUtilisateurs } from '#server/resources/admin-a2'
import { listerUtilisateurs } from '#server/services/admin/utilisateurs'
import { schemaListeUtilisateursQuery } from '#shared/schemas/admin-a2'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const filtres = lireRequete(event, schemaListeUtilisateursQuery)
  return toListeUtilisateurs(await listerUtilisateurs(filtres))
})
