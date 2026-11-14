import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readBodyWith } from '#server/utils/validation'
import { toReauthReponse } from '#server/resources/admin'
import { demanderCode } from '#server/services/admin/reauth'
import { schemaDemandeReauth } from '#shared/schemas/admin'

export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const demande = await readBodyWith(event, schemaDemandeReauth)
  const reponse = toReauthReponse(await demanderCode(admin.adminId, demande))
  setResponseStatus(event, 202)
  return reponse
})
