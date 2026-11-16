import { defineApiHandler } from '#server/utils/api'
import { setResponseHeader } from 'h3'
import { toEtatPublic } from '#server/resources/admin-a4'
import { lireEtatMaintenance } from '#server/services/maintenance'

// A4 : état public (maintenance en cours ou non), lu par le studio. Jamais refusé par la maintenance, jamais mis en cache.
export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return toEtatPublic(await lireEtatMaintenance())
})
