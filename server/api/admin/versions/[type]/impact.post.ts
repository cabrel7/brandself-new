import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { lireParametres } from '#server/utils/admin-a5'
import { introuvableAdmin } from '#server/utils/introuvable'
import { toImpactPlan } from '#server/resources/admin-a5'
import { apercuImpact } from '#server/services/configuration/versions'
import { schemaImpactPlanRequete, schemaVersionTypeParam } from '#shared/schemas/admin-versions'

// `POST /api/admin/versions/plans/impact` : lecture seule (aucune écriture, aucune réauthentification).
export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { type } = lireParametres(event, schemaVersionTypeParam)
  if (type !== 'plans') throw introuvableAdmin()
  const { cle, valeurs } = await lireCorps(event, schemaImpactPlanRequete)
  return toImpactPlan(await apercuImpact(cle, valeurs))
})
