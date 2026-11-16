import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { lireParametres } from '#server/utils/admin-a5'
import { introuvableAdmin } from '#server/utils/introuvable'
import { toEssaiPrompt } from '#server/resources/admin-a5'
import { essaiPrompt } from '#server/services/ia/essai'
import { schemaEssaiPrompt, schemaVersionTypeParam } from '#shared/schemas/admin-versions'

// `POST /api/admin/versions/prompts/essai` : lecture seule, aucune ligne persistée, fixtures synthétiques, 10 essais par
// heure et par administrateur (429 `ESSAI_LIMITE`). Le corps ne porte QUE le contenu du prompt (schéma strict).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { type } = lireParametres(event, schemaVersionTypeParam)
  if (type !== 'prompts') throw introuvableAdmin()
  const corps = await lireCorps(event, schemaEssaiPrompt)
  return toEssaiPrompt(await essaiPrompt(admin.adminId, corps))
})
