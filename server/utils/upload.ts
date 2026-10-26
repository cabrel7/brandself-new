import { getRequestHeader, readMultipartFormData } from 'h3'
import type { H3Event } from 'h3'
import { MEDIA_FORM_FIELD, MEDIA_MAX_BYTES, MULTIPART_OVERHEAD_BYTES } from '../../shared/medias'
import { BadRequestError, LengthRequiredError, PayloadTooLargeError } from '../exceptions/http'

const MAX_REQUEST_BYTES = MEDIA_MAX_BYTES + MULTIPART_OVERHEAD_BYTES

/**
 * Lit la partie `fichier` d'un envoi multipart. `Content-Length` est vérifié AVANT de lire le
 * corps : absent -> 411, trop grand -> 413 (le serveur ne met jamais en mémoire un corps énorme).
 * Le nom de fichier du client n'est jamais utilisé.
 */
export async function readMediaUpload(event: H3Event): Promise<Buffer> {
  const header = getRequestHeader(event, 'content-length')
  const length = header === undefined ? Number.NaN : Number(header)
  if (!Number.isInteger(length) || length < 0) throw new LengthRequiredError()
  if (length > MAX_REQUEST_BYTES) throw new PayloadTooLargeError()

  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.name === MEDIA_FORM_FIELD && part.data.length > 0)
  if (!file) throw new BadRequestError('FICHIER_MANQUANT')
  return file.data
}
