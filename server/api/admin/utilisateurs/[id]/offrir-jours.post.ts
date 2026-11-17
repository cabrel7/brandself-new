import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCleIdempotence, lireCorps, lireIdParam } from '#server/utils/admin-a2'
import { toOffrirJours } from '#server/resources/admin-a2'
import { offrirJours } from '#server/services/admin/utilisateurs'
import { schemaOffrirJours } from '#shared/schemas/admin-a2'

// Motif seul (D-A2-07) ; clé d'idempotence dans l'en-tête `Idempotency-Key` (D-A2-06).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const id = lireIdParam(event)
  const cle = lireCleIdempotence(event)
  const { motif, jours } = await lireCorps(event, schemaOffrirJours)
  return toOffrirJours(await offrirJours(admin.adminId, id, jours, cle, motif, admin.ip))
})
