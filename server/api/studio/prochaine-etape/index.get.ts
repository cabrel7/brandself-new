import { defineApiHandler } from '#server/utils/api'
import { getNextStep } from '#server/services/vitrines'
import type { ProchaineEtapeDTO } from '#shared/dto/notifications'

export default defineApiHandler(async (event): Promise<ProchaineEtapeDTO> => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { etape: await getNextStep(user.id) }
})
