import { setResponseHeaders, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { NotFoundError } from '#server/exceptions/http'
import { defineApiHandler } from '#server/utils/api'
import { sendMediaVariant } from '#server/utils/media-response'
import { readParamsWith } from '#server/utils/validation'
import { readMediaVariantByFilename, readPartageJpeg } from '#server/services/medias'
import { PARTAGE_FICHIER } from '#shared/medias'

const MIME_PARTAGE = 'image/jpeg'
const STATUT_INTROUVABLE = 404

// Pas de validation stricte ici : un id ou un nom de fichier invalide est un 404 (décidé par le service).
const schemaParams = z.object({ id: z.string(), fichier: z.string() })

/**
 * 404 d'une image, en `no-store`. Nitro remplace le `Cache-Control` de toute ERREUR 404 par `no-cache` (gestionnaire
 * d'erreurs par défaut) : la route répond donc elle-même, avec la même forme JSON que le gestionnaire d'erreurs, pour que
 * nginx ne garde jamais ce 404 plus que son propre `proxy_cache_valid 404` et qu'aucun cache n'en fasse une réponse publique.
 */
function repondreIntrouvable(event: H3Event, erreur: NotFoundError) {
  setResponseStatus(event, STATUT_INTROUVABLE, erreur.code)
  setResponseHeaders(event, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  return { statusCode: STATUT_INTROUVABLE, statusMessage: erreur.code, message: erreur.message, data: { code: erreur.code } }
}

export default defineApiHandler(async (event) => {
  const { id, fichier } = readParamsWith(event, schemaParams)
  try {
    if (fichier === PARTAGE_FICHIER) {
      return sendMediaVariant(event, id, 'partage', await readPartageJpeg(id), MIME_PARTAGE)
    }
    const { data, width } = await readMediaVariantByFilename(id, fichier)
    return sendMediaVariant(event, id, width, data)
  } catch (erreur) {
    if (erreur instanceof NotFoundError) return repondreIntrouvable(event, erreur)
    throw erreur
  }
})
