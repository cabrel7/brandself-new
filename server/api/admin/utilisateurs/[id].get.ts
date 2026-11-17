import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireIdParam } from '#server/utils/admin-a2'
import { toUtilisateurFiche } from '#server/resources/admin-a2'
import { getFicheUtilisateur } from '#server/services/admin/utilisateurs'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toUtilisateurFiche(await getFicheUtilisateur(lireIdParam(event)))
})
