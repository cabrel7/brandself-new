import { z } from 'zod'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { readParamsWith } from '#server/utils/validation'
import { recordLienClic } from '#server/services/liens'

// Aucune règle de format ici : le service renvoie 404 (sans requête) pour tout username invalide.
const schemaParams = z.object({ username: z.string(), slug: z.string().trim().min(1).max(80) })

/**
 * Enregistre un clic sur un lien de la page de liens (trafic public, sans session).
 * Limité en débit par adresse IP : une 429 n'interrompt jamais la navigation (appel en arrière-plan).
 */
export default defineApiHandler(async (event) => {
  const { username, slug } = readParamsWith(event, schemaParams)
  const ip = getClientIp(event)
  await recordLienClic(username, slug, ip)
  return { ok: true }
})
