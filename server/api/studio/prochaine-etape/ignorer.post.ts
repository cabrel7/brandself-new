import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { ignoreNextStep } from '#server/services/vitrines'
import type { ProchaineEtapeDTO } from '#shared/dto/notifications'
import { schemaEtapeIgnorer } from '#shared/schemas/notifications'

export default defineApiHandler(async (event): Promise<ProchaineEtapeDTO> => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { etape } = await readBodyWith(event, schemaEtapeIgnorer)
  return { etape: await ignoreNextStep(user.id, etape) }
})
