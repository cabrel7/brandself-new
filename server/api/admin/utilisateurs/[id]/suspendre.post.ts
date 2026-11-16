import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, lireIdParam, reauthPour } from '#server/utils/admin-a2'
import { toActionEffectuee } from '#server/resources/admin-a2'
import { suspendre } from '#server/services/admin/utilisateurs'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaActionMotif } from '#shared/schemas/admin-a2'

// Réauthentification exigée (D-A2-07) : le service consomme le code DANS sa transaction.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const { motif } = await lireCorps(event, schemaActionMotif)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.utilisateurSuspendre, ADMIN_CIBLES.utilisateur, id)
  await suspendre(admin.adminId, id, motif, admin.ip, { reauth })
  return toActionEffectuee()
})
