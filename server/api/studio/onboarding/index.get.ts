import { defineApiHandler } from '#server/utils/api'
import { toOnboardingResource } from '#server/resources/onboarding'
import { getOnboarding } from '#server/services/onboarding'

// S8 §6 : état de l'inscription guidée. Lecture seule : ne crée jamais de progression.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return { onboarding: toOnboardingResource(await getOnboarding(user.id)) }
})
