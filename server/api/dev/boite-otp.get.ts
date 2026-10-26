import { createError, defineEventHandler, getQuery } from 'h3'
import { BOITE_OTP_PREFIXE, BOITE_OTP_DUREE_SECONDES } from '#server/services/otp/envoi'
import { redis } from '#server/utils/redis'
import { env } from '#shared/env'

// Boîte aux lettres de développement : lit le dernier code déposé par le
// worker (server/services/otp/envoi.ts). Refusée en production — aucun
// fournisseur n'y est branché et le code n'y est jamais déposé.
export default defineEventHandler(async (event) => {
  if (env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, statusMessage: 'Introuvable.' })
  }

  const identifiant = getQuery(event).identifiant
  if (typeof identifiant !== 'string' || identifiant.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'Identifiant manquant.' })
  }

  const code = await redis.get(`${BOITE_OTP_PREFIXE}${identifiant.trim()}`)
  const expiration = code ? BOITE_OTP_DUREE_SECONDES : 0

  return { code: code ?? null, expiration }
})
