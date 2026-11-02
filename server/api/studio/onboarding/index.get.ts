import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { toOnboardingResource } from '#server/resources/onboarding'
import { getOnboarding } from '#server/services/onboarding'

// S8 §6 : état de l'inscription guidée (données personnelles : jamais mis en cache).
// Lecture seule : ne crée jamais de progression.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { onboarding: toOnboardingResource(await getOnboarding(user.id)) }
})
