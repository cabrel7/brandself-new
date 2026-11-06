// S11 §6 : lecture des statistiques de la vitrine (studio). Contrat : GET /api/studio/statistiques?periode=7|30|90.
import { defineApiHandler } from '#server/utils/api'
import { readQueryWith } from '#server/utils/validation'
import { getStatistiques } from '#server/services/statistiques'
import { schemaStatistiquesQuery } from '#shared/schemas/statistiques'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { periode } = readQueryWith(event, schemaStatistiquesQuery)
  return await getStatistiques(user.id, Number(periode), new Date())
})
