import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCleIdempotence, lireCorps, lireIdParam, reauthPour } from '#server/utils/admin-a2'
import { toCapacite } from '#server/resources/admin-a4'
import { accorderCapacite } from '#server/services/admin/capacites'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaCapaciteAccorder } from '#shared/schemas/admin-a4'

// Réauthentification exigée ET clé d'idempotence (en-tête) : un rejeu ne consomme pas de nouveau code.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const cle = lireCleIdempotence(event)
  const corps = await lireCorps(event, schemaCapaciteAccorder)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.capaciteAccorder, ADMIN_CIBLES.utilisateur, id)
  return toCapacite(await accorderCapacite(admin.adminId, id, corps.capacite, corps.motif, cle, admin.ip, { reauth }))
})
