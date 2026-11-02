import { setResponseHeader, setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toStudioResumeResource, toVitrineStudioResource } from '#server/resources/vitrine'
import { terminer } from '#server/services/onboarding'
import { getStudioView } from '#server/services/vitrines'
import { schemaOnboardingTerminer } from '#shared/schemas/onboarding'

// S8 §6 : 201 à la création de la vitrine, 200 au rejeu (double clic, deuxième appareil). Jamais mis en cache.
// Le débit par utilisateur est appliqué dans le service `terminer`.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await readBodyWith(event, schemaOnboardingTerminer)
  const { creee } = await terminer(user.id, input)
  const { vitrine, resume } = await getStudioView(user.id)
  setResponseStatus(event, creee ? 201 : 200)
  return { vitrine: toVitrineStudioResource(vitrine), resume: toStudioResumeResource(resume) }
})
