import { randomUUID } from 'node:crypto'
import { and, eq, notExists, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { medias, realisations, services, vitrines } from '../../shared/db/schema'
import { MEDIA_UPLOAD_LIMIT } from '../../shared/limites'
import { MEDIA_MAX_BYTES, MEDIA_MAX_PIXELS, MEDIA_WIDTHS } from '../../shared/medias'
import type { MediaWidth } from '../../shared/medias'
import {
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  UnsupportedMediaTypeError,
} from '../exceptions/http'
import { db } from '../utils/db'
import {
  deleteMediaFiles,
  deleteUserMediaFiles,
  readMediaVariantFile,
  writeMediaVariant,
} from '../utils/stockage'
import { enforceLimit } from './limiteur'

export type MediaRow = typeof medias.$inferSelect

export type DetectedImageType = 'image/jpeg' | 'image/png' | 'image/webp'

const WEBP_MIME = 'image/webp'
const WEBP_QUALITY = 82
const LOCAL_DISK = 'local'
const MEDIA_ID_RE = /^[A-Za-z0-9_-]+$/
const VARIANT_FILE_RE = /^(\d+)\.webp$/
const PIXEL_LIMIT_MESSAGE_RE = /pixel limit/i

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const RIFF_MARKER = 'RIFF'
const WEBP_MARKER = 'WEBP'
const WEBP_MARKER_OFFSET = 8
const WEBP_MIN_LENGTH = 12

const SHARP_FORMAT_BY_TYPE: Record<DetectedImageType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte)
}

/** Type réel d'une image d'après ses octets magiques (jamais l'extension ni le nom). Pure. */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(buffer, PNG_SIGNATURE)) return 'image/png'
  if (
    buffer.length >= WEBP_MIN_LENGTH
    && buffer.toString('ascii', 0, RIFF_MARKER.length) === RIFF_MARKER
    && buffer.toString('ascii', WEBP_MARKER_OFFSET, WEBP_MIN_LENGTH) === WEBP_MARKER
  ) {
    return 'image/webp'
  }
  return null
}

interface Variant {
  width: MediaWidth
  data: Buffer
  largeur: number
  hauteur: number
}

/** Décode, oriente (EXIF) et produit les 3 variantes WebP sans métadonnées. */
async function buildVariants(data: Buffer, type: DetectedImageType): Promise<Variant[]> {
  try {
    const source = sharp(data, { limitInputPixels: MEDIA_MAX_PIXELS, failOn: 'error' })
    const meta = await source.metadata()
    if (meta.format !== SHARP_FORMAT_BY_TYPE[type]) {
      // Octets magiques et décodeur en désaccord : on ne fait confiance à aucun des deux.
      throw new UnsupportedMediaTypeError()
    }
    const oriented = source.rotate()
    const variants: Variant[] = []
    for (const width of MEDIA_WIDTHS) {
      const { data: output, info } = await oriented
        .clone()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true })
      variants.push({ width, data: output, largeur: info.width, hauteur: info.height })
    }
    return variants
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) throw error
    if (error instanceof Error && PIXEL_LIMIT_MESSAGE_RE.test(error.message)) {
      throw new UnprocessableError('IMAGE_TROP_GRANDE')
    }
    throw new UnprocessableError('IMAGE_ILLISIBLE')
  }
}

/**
 * Téléverse une image : taille -> type -> limite -> décodage -> 3 variantes -> insertion.
 * Si l'insertion échoue, les fichiers déjà écrits sont supprimés (compensation).
 */
export async function uploadMedia(userId: string, data: Buffer): Promise<MediaRow> {
  if (data.length > MEDIA_MAX_BYTES) throw new PayloadTooLargeError()
  const type = detectImageType(data)
  if (!type) throw new UnsupportedMediaTypeError()

  await enforceLimit(`media-upload:${userId}`, MEDIA_UPLOAD_LIMIT.limit, MEDIA_UPLOAD_LIMIT.windowS)

  const variants = await buildVariants(data, type)
  const principal = variants[variants.length - 1]
  if (!principal) throw new UnprocessableError('IMAGE_ILLISIBLE')
  const id = randomUUID()
  try {
    for (const variant of variants) {
      await writeMediaVariant(userId, id, variant.width, variant.data)
    }
    const [row] = await db
      .insert(medias)
      .values({
        id,
        userId,
        disk: LOCAL_DISK,
        chemin: `${userId}/${id}`,
        mime: WEBP_MIME,
        taille: principal.data.length,
        largeur: principal.largeur,
        hauteur: principal.hauteur,
      })
      .returning()
    if (!row) throw new Error('Insertion du média sans résultat.')
    return row
  } catch (error) {
    await deleteMediaFiles(userId, id).catch((cleanupError: unknown) => {
      console.error({ medias: 'compensation échouée', nom: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError })
    })
    throw error
  }
}

/** Supprime un média de l'utilisateur (ligne puis fichiers). Média d'autrui ou inconnu : MEDIA_INTROUVABLE. */
export async function deleteMedia(userId: string, mediaId: string): Promise<void> {
  const deleted = await db
    .delete(medias)
    .where(and(eq(medias.id, mediaId), eq(medias.userId, userId)))
    .returning({ id: medias.id })
  if (deleted.length === 0) {
    throw new NotFoundError('MEDIA_INTROUVABLE')
  }
  await deleteMediaFiles(userId, mediaId)
}

/**
 * Supprime un média seulement si plus rien ne le référence (photo de vitrine, image de service
 * ou de réalisation). Un seul DELETE conditionnel : pas de fenêtre entre vérification et suppression.
 */
export async function deleteMediaIfUnreferenced(userId: string, mediaId: string): Promise<void> {
  const deleted = await db
    .delete(medias)
    .where(
      and(
        eq(medias.id, mediaId),
        eq(medias.userId, userId),
        notExists(db.select({ one: sql`1` }).from(vitrines).where(eq(vitrines.photoMediaId, mediaId))),
        notExists(db.select({ one: sql`1` }).from(services).where(eq(services.imageMediaId, mediaId))),
        notExists(db.select({ one: sql`1` }).from(realisations).where(eq(realisations.imageMediaId, mediaId))),
      ),
    )
    .returning({ id: medias.id })
  if (deleted.length > 0) {
    await deleteMediaFiles(userId, mediaId)
  }
}

function isMediaWidth(width: number): width is MediaWidth {
  return (MEDIA_WIDTHS as readonly number[]).includes(width)
}

/** Octets d'une variante publique. Id mal formé, largeur non publiée, média absent : 404. */
export async function readMediaVariant(mediaId: string, width: number): Promise<Buffer> {
  if (!MEDIA_ID_RE.test(mediaId) || !isMediaWidth(width)) {
    throw new NotFoundError('MEDIA_INTROUVABLE')
  }
  const [row] = await db.select({ userId: medias.userId }).from(medias).where(eq(medias.id, mediaId)).limit(1)
  if (!row) {
    throw new NotFoundError('MEDIA_INTROUVABLE')
  }
  const data = await readMediaVariantFile(row.userId, mediaId, width)
  if (!data) {
    throw new NotFoundError('MEDIA_INTROUVABLE')
  }
  return data
}

export interface MediaVariantFile {
  data: Buffer
  width: MediaWidth
}

/** Variante demandée par nom de fichier (`800.webp`). Nom invalide : 404, jamais 400. */
export async function readMediaVariantByFilename(mediaId: string, filename: string): Promise<MediaVariantFile> {
  const match = VARIANT_FILE_RE.exec(filename)
  const width = match ? Number(match[1]) : Number.NaN
  if (!isMediaWidth(width)) {
    throw new NotFoundError('MEDIA_INTROUVABLE')
  }
  return { data: await readMediaVariant(mediaId, width), width }
}

/** Efface le dossier d'un utilisateur. À appeler APRÈS le commit de la suppression du compte. */
export async function deleteAllUserMediaFiles(userId: string): Promise<void> {
  await deleteUserMediaFiles(userId)
}
