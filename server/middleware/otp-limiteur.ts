import { createHash } from 'node:crypto'
import { OTP_WINDOW_SECONDS, checkOtpLimit } from '../../shared/limiteur'
import { redis } from '../utils/redis'

const OTP_PATHS = new Set([
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/phone-number/send-otp',
])

interface OtpBody {
  email?: string
  phoneNumber?: string
}

interface EventWithWeb {
  web?: { request?: Request; [key: string]: unknown }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST' || !OTP_PATHS.has(event.path)) {
    return
  }

  // Read the body once, then republish it for Better Auth:
  // toWebRequest builds a Request on the raw request stream, which this read
  // consumes (otherwise: « Response body object should not be disturbed »).
  const rawBody = await readRawBody(event).catch(() => null)
  let identifier: string | undefined
  if (typeof rawBody === 'string') {
    try {
      const body = JSON.parse(rawBody) as OtpBody
      identifier = body.email ?? body.phoneNumber
    } catch {
      identifier = undefined
    }
    const headers = new Headers()
    for (const [key, value] of Object.entries(event.node.req.headers)) {
      if (value === undefined) {
        continue
      }
      if (Array.isArray(value)) {
        for (const element of value) {
          headers.append(key, element)
        }
      } else {
        headers.set(key, value)
      }
    }
    const ev = event as unknown as EventWithWeb
    ev.web = {
      ...ev.web,
      request: new Request(getRequestURL(event), {
        method: 'POST',
        headers,
        body: rawBody,
      }),
    }
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'inconnue'

  const [ipCount, identifierCount] = await Promise.all([
    increment(`otp:ip:${ip}`),
    identifier
      ? increment(`otp:id:${createHash('sha256').update(identifier).digest('hex')}`)
      : Promise.resolve(0),
  ])

  const verdict = checkOtpLimit(ipCount, identifierCount)
  if (!verdict.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: verdict.message,
    })
  }
})

async function increment(key: string): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, OTP_WINDOW_SECONDS)
  }
  return count
}
