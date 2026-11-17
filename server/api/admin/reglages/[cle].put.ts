import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps, reauthPour } from '#server/utils/admin-a2'
import { lireCleBrute, schemaCorpsModifierReglage } from '#server/utils/admin-a4'
import { toModifierReglage } from '#server/resources/admin-a4'
import { exigerCleReglage, modifierReglage } from '#server/services/admin/reglages'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'

// Clé hors registre (secret compris) : 404 avant toute lecture du corps. La réauthentification dépend du réglage (registre),
// l'idempotence est portée par `cleIdempotence` dans le corps (D-A4-19).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const cle = exigerCleReglage(lireCleBrute(event))
  const corps = await lireCorps(event, schemaCorpsModifierReglage)
  const reauth = reauthPour(event, admin.adminId, ADMIN_ACTIONS.reglageModifier, ADMIN_CIBLES.reglage, cle)
  return toModifierReglage(await modifierReglage(admin.adminId, cle, corps, admin.ip, { reauth }))
})
