import { setResponseHeader, setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { toGenerationResource } from '#server/resources/generation'
import { generer } from '#server/services/onboarding'
import { getIaQuota } from '#server/services/plans'
import { schemaOnboardingGenerer } from '#shared/schemas/onboarding'

// S8 §6 : 202 pour une nouvelle génération (le travail se fait dans un job), 200 si une génération
// identique existe déjà (même entrée : rien n'est recréé ni recompté). Jamais mis en cache.
export default defineApiHandler(async (event) => {
  const { user } = await requireUserSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  await readBodyWith(event, schemaOnboardingGenerer)
  const { generation, dedoublonnee } = await generer(user.id)
  const quota = await getIaQuota(user.id)
  setResponseStatus(event, dedoublonnee ? 200 : 202)
  return { generation: toGenerationResource(generation), quota }
})
