import { createHash } from 'node:crypto'
import { FENETRE_OTP_SECONDES, verdictLimiteOtp } from '../../shared/limiteur'
import { redis } from '../utils/redis'

const CHEMINS_OTP = new Set([
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/phone-number/send-otp',
])

interface CorpsOtp {
  email?: string
  phoneNumber?: string
}

interface EventAvecWeb {
  web?: { request?: Request; [cle: string]: unknown }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST' || !CHEMINS_OTP.has(event.path)) {
    return
  }

  // Lit le corps une seule fois, puis le republie pour Better Auth :
  // toWebRequest construit un Request sur le flux brut de la requête, que cette
  // lecture consomme (sinon : « Response body object should not be disturbed »).
  const brut = await readRawBody(event).catch(() => null)
  let identifiant: string | undefined
  if (typeof brut === 'string') {
    try {
      const corps = JSON.parse(brut) as CorpsOtp
      identifiant = corps.email ?? corps.phoneNumber
    } catch {
      identifiant = undefined
    }
    const entetes = new Headers()
    for (const [cle, valeur] of Object.entries(event.node.req.headers)) {
      if (valeur === undefined) {
        continue
      }
      if (Array.isArray(valeur)) {
        for (const element of valeur) {
          entetes.append(cle, element)
        }
      } else {
        entetes.set(cle, valeur)
      }
    }
    const ev = event as unknown as EventAvecWeb
    ev.web = {
      ...ev.web,
      request: new Request(getRequestURL(event), {
        method: 'POST',
        headers: entetes,
        body: brut,
      }),
    }
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'inconnue'

  const [compteurIp, compteurIdentifiant] = await Promise.all([
    incrementer(`otp:ip:${ip}`),
    identifiant
      ? incrementer(`otp:id:${createHash('sha256').update(identifiant).digest('hex')}`)
      : Promise.resolve(0),
  ])

  const verdict = verdictLimiteOtp(compteurIp, compteurIdentifiant)
  if (!verdict.autorise) {
    throw createError({
      statusCode: 429,
      statusMessage: verdict.message,
    })
  }
})

async function incrementer(cle: string): Promise<number> {
  const compteur = await redis.incr(cle)
  if (compteur === 1) {
    await redis.expire(cle, FENETRE_OTP_SECONDES)
  }
  return compteur
}
