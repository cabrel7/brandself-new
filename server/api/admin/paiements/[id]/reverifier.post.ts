import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { reverifierPaiement } from '#server/services/admin/confirmation'
import { ADMIN_CIBLE_ID_MAX } from '#shared/admin'
import { schemaActionPaiement } from '#shared/schemas/admin-paiements'

const schemaParams = z.object({ id: z.string().min(1).max(ADMIN_CIBLE_ID_MAX) })

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { id } = readParamsWith(event, schemaParams)
  const entree = await readBodyWith(event, schemaActionPaiement)
  return reverifierPaiement({ adminId: admin.adminId, ip: admin.ip }, id, entree)
})
