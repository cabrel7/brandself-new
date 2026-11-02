import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toStudioResumeResource, toVitrineStudioResource } from '#server/resources/vitrine'
import { terminer } from '#server/services/onboarding'
import { getStudioView } from '#server/services/vitrines'
import { schemaOnboardingTerminer } from '#shared/schemas/onboarding'

// S8 §6 : 201 à la création de la vitrine, 200 au rejeu (double clic, deuxième appareil).
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaOnboardingTerminer)
  const { creee } = await terminer(user.id, input)
  const { vitrine, resume } = await getStudioView(user.id)
  setResponseStatus(event, creee ? 201 : 200)
  return { vitrine: toVitrineStudioResource(vitrine), resume: toStudioResumeResource(resume) }
})
