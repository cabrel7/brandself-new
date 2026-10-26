import { randomFillSync } from 'node:crypto'
import sharp from 'sharp'

// Toutes les images sont fabriquées avec sharp pendant le test : aucun binaire n'est commité.

const COULEUR_PAR_DEFAUT = { r: 200, g: 80, b: 40 }

/** Orientation EXIF « à tourner de 90° horaire » : 4000×3000 stocké, 3000×4000 affiché. */
export const EXIF_ORIENTATION_PORTRAIT = 6

const NOISE_WIDTH = 4000
const NOISE_HEIGHT = 3000
const NOISE_CHANNELS = 3
// Le bruit pur à qualité 100 pèse ~16 Mo (au-delà de la limite de 10 Mo) : la qualité est
// réglée pour obtenir une photo « lourde mais acceptable » d'environ 7 à 8 Mo.
const NOISE_JPEG_QUALITY = 82
const NOISE_MIN_BYTES = 5 * 1024 * 1024
const NOISE_MAX_BYTES = 9.5 * 1024 * 1024

const HUGE_SIDE = 10_000
// Niveau 1 : ~3 Mo (sous la limite d'octets) et ~4 s ; le niveau 9 prend ~12 s pour 300 Ko.
const HUGE_PNG_COMPRESSION = 1

function fond(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: COULEUR_PAR_DEFAUT } })
}

export function makePng(width = 64, height = 64): Promise<Buffer> {
  return fond(width, height).png().toBuffer()
}

export function makeJpeg(width = 64, height = 64): Promise<Buffer> {
  return fond(width, height).jpeg().toBuffer()
}

export function makeWebp(width = 64, height = 64): Promise<Buffer> {
  return fond(width, height).webp().toBuffer()
}

/** JPEG portant un EXIF d'orientation 6 (et des métadonnées de droit d'auteur à retirer). */
export function makeJpegWithExif(width = 400, height = 300): Promise<Buffer> {
  return fond(width, height)
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Secret Photographe' } })
    .withMetadata({ orientation: EXIF_ORIENTATION_PORTRAIT })
    .toBuffer()
}

/** Photo de 4000×3000, ~7 à 8 Mo (bruit aléatoire), orientation EXIF 6. */
export async function makeHeavyNoiseJpeg(): Promise<Buffer> {
  const brut = Buffer.allocUnsafe(NOISE_WIDTH * NOISE_HEIGHT * NOISE_CHANNELS)
  randomFillSync(brut)
  const jpeg = await sharp(brut, {
    raw: { width: NOISE_WIDTH, height: NOISE_HEIGHT, channels: NOISE_CHANNELS },
  })
    .jpeg({ quality: NOISE_JPEG_QUALITY })
    .withMetadata({ orientation: EXIF_ORIENTATION_PORTRAIT })
    .toBuffer()
  if (jpeg.length < NOISE_MIN_BYTES || jpeg.length > NOISE_MAX_BYTES) {
    throw new Error(`Image de test hors gabarit : ${jpeg.length} octets (attendu 5 à 9,5 Mo).`)
  }
  return jpeg
}

/** PNG gris de 10 000 × 10 000 px (100 MP) : sous la limite d'octets, au-dessus de la limite de pixels. */
export function makeHugePng(): Promise<Buffer> {
  return sharp(Buffer.alloc(HUGE_SIDE * HUGE_SIDE), {
    raw: { width: HUGE_SIDE, height: HUGE_SIDE, channels: 1 },
    limitInputPixels: false,
  })
    .png({ compressionLevel: HUGE_PNG_COMPRESSION })
    .toBuffer()
}

/** En-tête d'un exécutable Windows (« MZ ») : octets magiques non image. */
export function makeMzBytes(length = 2048): Buffer {
  const octets = Buffer.alloc(length)
  octets[0] = 0x4d
  octets[1] = 0x5a
  return octets
}

/** Débute comme un JPEG (FF D8 FF) mais le reste n'est que du bruit. */
export function makeJpegWithGarbage(length = 4096): Buffer {
  const octets = Buffer.allocUnsafe(length)
  randomFillSync(octets)
  octets[0] = 0xff
  octets[1] = 0xd8
  octets[2] = 0xff
  return octets
}

/** JPEG tronqué en tête uniquement (signature + quelques octets) : déchets après les octets magiques. */
export function makeJpegMagicOnly(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
}
