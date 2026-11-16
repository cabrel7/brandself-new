import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { lireParametres } from '#server/utils/admin-a4'
import { toCapacite } from '#server/resources/admin-a4'
import { revoquerCapacite } from '#server/services/admin/capacites'
import { schemaActionMotif } from '#shared/schemas/admin-a2'
import { schemaCapaciteParam } from '#shared/schemas/admin-a4'

// Sans réauthentification : retirer un accès ne l'élargit jamais. Motif obligatoire.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { id, capacite } = lireParametres(event, schemaCapaciteParam)
  const { motif } = await lireCorps(event, schemaActionMotif)
  const revoquee = await revoquerCapacite(admin.adminId, id, capacite, motif, admin.ip)
  return toCapacite({ capacite: revoquee, rejoue: false })
})
