import { getRequestHeader, sendNoContent, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'

const NOT_MODIFIED = 304
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const WEAK_PREFIX = 'W/'

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').some((candidate) => {
    const value = candidate.trim()
    return value === '*' || value.replace(WEAK_PREFIX, '') === etag
  })
}

/**
 * Réponse d'une variante d'image : le contenu d'un id donné ne change jamais (URL-capacité
 * immuable), d'où le cache d'un an. 304 si l'ETag du navigateur correspond.
 */
export function sendMediaVariant(event: H3Event, mediaId: string, width: number, data: Buffer) {
  const etag = `"${mediaId}-${width}"`
  setResponseHeaders(event, {
    'Content-Type': 'image/webp',
    'Cache-Control': CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  })
  if (matchesEtag(getRequestHeader(event, 'if-none-match'), etag)) {
    return sendNoContent(event, NOT_MODIFIED)
  }
  return data
}
