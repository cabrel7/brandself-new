import { setResponseStatus } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toRappelReponse } from '#server/resources/admin-paiements'
import { rappelerAbonnement } from '#server/services/admin/abonnements'
import { ADMIN_CIBLE_ID_MAX } from '#shared/admin'
import { schemaRappelAbonnement } from '#shared/schemas/admin-paiements'

const schemaParams = z.object({ id: z.string().min(1).max(ADMIN_CIBLE_ID_MAX) })

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { id } = readParamsWith(event, schemaParams)
  const entree = await readBodyWith(event, schemaRappelAbonnement)
  await rappelerAbonnement({ adminId: admin.adminId, ip: admin.ip }, id, entree)
  setResponseStatus(event, 202)
  return toRappelReponse()
})
