import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { exigerReauth } from '#server/utils/reauth'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { toMarquage } from '#server/resources/admin-paiements'
import { marquerPayeManuellement } from '#server/services/paiements/manuel'
import { ADMIN_ACTIONS, ADMIN_CIBLE_ID_MAX, ADMIN_CIBLES } from '#shared/admin'
import { schemaActionPaiement } from '#shared/schemas/admin-paiements'

const schemaParams = z.object({ id: z.string().min(1).max(ADMIN_CIBLE_ID_MAX) })

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { id } = readParamsWith(event, schemaParams)
  const entree = await readBodyWith(event, schemaActionPaiement)
  // La réauthentification est consommée DANS la transaction du service : si le marquage échoue, le code reste utilisable.
  const resultat = await marquerPayeManuellement(
    { adminId: admin.adminId, ip: admin.ip },
    id,
    entree,
    (tx) => exigerReauth(event, tx, admin.adminId, {
      action: ADMIN_ACTIONS.paiementMarquerPaye,
      cibleType: ADMIN_CIBLES.paiement,
      cibleId: id,
    }),
  )
  return toMarquage(resultat)
})
