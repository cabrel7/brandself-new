import { isIP } from 'node:net'
import type { H3Event } from 'h3'

const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

type ForwardedFor = string | string[] | undefined

export function resolveClientIp(socketIp: string | undefined, forwardedFor: ForwardedFor): string {
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor.length === 1 ? forwardedFor[0] : undefined
    : forwardedFor

  if (
    socketIp !== undefined
    && LOOPBACK_ADDRESSES.has(socketIp)
    && forwardedIp !== undefined
    && !forwardedIp.includes(',')
    && isIP(forwardedIp) !== 0
  ) {
    return forwardedIp
  }

  return socketIp !== undefined && isIP(socketIp) !== 0 ? socketIp : 'inconnue'
}

export function getClientIp(event: H3Event): string {
  return resolveClientIp(
    event.node.req.socket.remoteAddress,
    event.node.req.headers['x-forwarded-for'],
  )
}
