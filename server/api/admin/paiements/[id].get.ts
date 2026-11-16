import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readParamsWith } from '#server/utils/validation'
import { toPaiementDetail } from '#server/resources/admin-paiements'
import { lireDetailPaiement } from '#server/services/admin/paiements'
import { ADMIN_CIBLE_ID_MAX } from '#shared/admin'

const schemaParams = z.object({ id: z.string().min(1).max(ADMIN_CIBLE_ID_MAX) })

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const { id } = readParamsWith(event, schemaParams)
  return toPaiementDetail(await lireDetailPaiement(id))
})
