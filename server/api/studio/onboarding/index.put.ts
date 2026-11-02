import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toOnboardingResource } from '#server/resources/onboarding'
import { saveEtape } from '#server/services/onboarding'
import { schemaOnboardingEtape } from '#shared/schemas/onboarding'

// S8 §6 : enregistre une étape (1 identité, 2 photo, 3 proposition) selon `etape`.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const input = await readBodyWith(event, schemaOnboardingEtape)
  return { onboarding: toOnboardingResource(await saveEtape(user.id, input)) }
})
