import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCleIdempotence, lireCorps, lireIdParam, reauthPour } from '#server/utils/admin-a2'
import { toChangerPlan } from '#server/resources/admin-a2'
import { changerPlan } from '#server/services/admin/utilisateurs'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaChangerPlan } from '#shared/schemas/admin-a2'

// Réauthentification exigée (D-A2-07) ET clé d'idempotence (D-A2-06) : un rejeu ne consomme pas de nouveau code.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const cle = lireCleIdempotence(event)
  const corps = await lireCorps(event, schemaChangerPlan)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.utilisateurChangerPlan, ADMIN_CIBLES.utilisateur, id)
  const jours = corps.plan === 'payant' ? corps.jours : null
  return toChangerPlan(await changerPlan(admin.adminId, id, corps.plan, jours, cle, corps.motif, admin.ip, { reauth }))
})
