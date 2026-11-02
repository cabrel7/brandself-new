import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toAgendaStudioResource } from '#server/resources/agenda'
import { replaceDisponibilites } from '#server/services/agenda'
import { schemaDisponibilitesUpdate } from '#shared/schemas/agenda'

export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaDisponibilitesUpdate)
  const resource = toAgendaStudioResource(await replaceDisponibilites(user.id, input.items, {
    pasCreneauMin: input.pasCreneauMin,
    preavisHeures: input.preavisHeures,
    horizonJours: input.horizonJours,
  }))
  return { items: resource.disponibilites, reglages: resource.reglages }
})
