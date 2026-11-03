import { defineApiHandler } from '#server/utils/api'
import { markShared } from '#server/services/vitrines'
import type { PartageDTO } from '#shared/dto/notifications'

export default defineApiHandler(async (event): Promise<PartageDTO> => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { partageeLe: (await markShared(user.id)).toISOString() }
})
