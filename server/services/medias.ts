import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

// Octets magiques pour détecter le vrai type d'image, indépendamment de l'extension.
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

function detectMime(buffer: Buffer): string | null {
  if (
    buffer.length >= JPEG_MAGIC.length &&
    buffer[0] === JPEG_MAGIC[0] &&
    buffer[1] === JPEG_MAGIC[1] &&
    buffer[2] === JPEG_MAGIC[2]
  ) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= PNG_MAGIC.length &&
    buffer[0] === PNG_MAGIC[0] &&
    buffer[1] === PNG_MAGIC[1] &&
    buffer[2] === PNG_MAGIC[2] &&
    buffer[3] === PNG_MAGIC[3]
  ) {
    return 'image/png'
  }
  // WebP : RIFF + WEBP à l'offset 8
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

const MAX_SIZE = 10 * 1024 * 1024 // 10 Mo
const STORAGE_DIR = path.resolve(process.cwd(), 'storage/medias')
const VARIANT_WIDTHS = [800, 400, 200]

export interface MediaMeta {
  id: string
  chemin: string
  mime: string
  taille: number
  largeur?: number
  hauteur?: number
}

function mediaPath(userId: string, mediaId: string, variant?: number): string {
  const dir = path.join(STORAGE_DIR, userId)
  const suffix = variant ? `-${variant}w` : ''
  return path.join(dir, `${mediaId}${suffix}.webp`)
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function uploadMedia(
  userId: string,
  buffer: Buffer,
): Promise<MediaMeta> {
  const mime = detectMime(buffer)
  if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error('Type de fichier non supporté. Formats acceptés : JPEG, PNG, WebP.')
  }
  if (buffer.length > MAX_SIZE) {
    throw new Error('Fichier trop lourd. Taille maximale : 10 Mo.')
  }

  const mediaId = crypto.randomUUID()
  await ensureDir(path.join(STORAGE_DIR, userId))

  // sharp : corrige l'orientation EXIF, retire les métadonnées EXIF, convertit en WebP.
  const pipeline = sharp(buffer, {}).rotate().webp({ quality: 85 })

  const metadata = await pipeline.metadata()
  const largeur = metadata.width ?? 0
  const hauteur = metadata.height ?? 0

  // Variante originale (redimensionnée si nécessaire pour rester raisonnable).
  const originalBuffer = await pipeline
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .toBuffer()

  await fs.writeFile(mediaPath(userId, mediaId), originalBuffer)

  // Variantes de tailles.
  for (const width of VARIANT_WIDTHS) {
    if (largeur <= width) {
      continue
    }
    const variantBuffer = await sharp(buffer, {})
      .rotate()
      .resize({ width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    await fs.writeFile(mediaPath(userId, mediaId, width), variantBuffer)
  }

  return {
    id: mediaId,
    chemin: mediaPath(userId, mediaId),
    mime: 'image/webp',
    taille: originalBuffer.length,
    largeur,
    hauteur,
  }
}

export async function deleteMedia(userId: string, mediaId: string): Promise<void> {
  const paths: string[] = [mediaPath(userId, mediaId), ...VARIANT_WIDTHS.map((w) => mediaPath(userId, mediaId, w))]
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => undefined)))
}

export async function getMediaStream(userId: string, mediaId: string, variant?: number): Promise<fs.FileHandle> {
  const handle = await fs.open(mediaPath(userId, mediaId, variant), 'r')
  return handle
}
