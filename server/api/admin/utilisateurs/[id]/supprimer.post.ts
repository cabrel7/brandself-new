import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, lireIdParam, reauthPour } from '#server/utils/admin-a2'
import { toActionEffectuee } from '#server/resources/admin-a2'
import { supprimer } from '#server/services/admin/utilisateurs'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaSupprimerUtilisateur } from '#shared/schemas/admin-a2'

// Réauthentification exigée (D-A2-07) + e-mail exact du compte ressaisi (D-A2-08, vérifié par le service).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const { motif, emailConfirmation } = await lireCorps(event, schemaSupprimerUtilisateur)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.utilisateurSupprimer, ADMIN_CIBLES.utilisateur, id)
  await supprimer(admin.adminId, id, emailConfirmation, motif, admin.ip, { reauth })
  return toActionEffectuee()
})
