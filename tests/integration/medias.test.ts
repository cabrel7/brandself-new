import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { medias, realisationImages, realisations, vitrines } from '../../shared/db/schema'
import { MEDIA_MAX_BYTES, MEDIA_WIDTHS } from '../../shared/medias'
import { MEDIA_UPLOAD_LIMIT } from '../../shared/limites'
import {
  makeHeavyNoiseJpeg,
  makeHugePng,
  makeJpeg,
  makeJpegWithExif,
  makeJpegMagicOnly,
  makeJpegWithGarbage,
  makeMzBytes,
  makePng,
  makeWebp,
} from '../support/images'
import { fichiersDuMedia, fichiersSous, lireOctets, mediasDir } from './support/disque'
import { rejet } from './support/erreurs'
import { createUser, insertRealisation, insertRealisationImage, insertService, insertVitrineRow } from './support/fabriques'
import { mediasService } from './support/modules'

// Vrai PostgreSQL, vrai disque (dossier temporaire MEDIAS_DIR), vrai Redis. Images fabriquées
// avec sharp pendant le test. Un test par critère : le nom commence par « CAn ».

const TIMEOUT_IMAGE_LOURDE_MS = 120_000

let photoLourde: Buffer
let pngGeant: Buffer

beforeAll(async () => {
  photoLourde = await makeHeavyNoiseJpeg()
  pngGeant = await makeHugePng()
}, TIMEOUT_IMAGE_LOURDE_MS)

async function lignesMedias() {
  return db.select().from(medias)
}

async function aucuneTraceLaissee(): Promise<void> {
  expect(await lignesMedias()).toHaveLength(0)
  expect(await fichiersSous(mediasDir())).toEqual([])
}

/** Les trois variantes d'un média, lues sur le disque, avec leurs métadonnées sharp. */
async function variantesSurDisque(mediaId: string) {
  const fichiers = await fichiersDuMedia(mediaId)
  // Garde-fou anti test « vert à vide » : sans les trois fichiers, les boucles d'assertions ne prouveraient rien.
  expect(fichiers).toHaveLength(MEDIA_WIDTHS.length)
  return Promise.all(
    fichiers.map(async (fichier) => {
      const octets = await lireOctets(fichier)
      const meta = await sharp(octets).metadata()
      return { fichier, octets, meta, grandCote: Math.max(meta.width ?? 0, meta.height ?? 0) }
    }),
  )
}

function versOctets(valeur: unknown): Buffer {
  if (Buffer.isBuffer(valeur)) return valeur
  if (valeur instanceof Uint8Array) return Buffer.from(valeur)
  if (typeof valeur === 'object' && valeur !== null) {
    for (const cle of ['data', 'buffer', 'body', 'contenu']) {
      const interne = (valeur as Record<string, unknown>)[cle]
      if (Buffer.isBuffer(interne) || interne instanceof Uint8Array) return Buffer.from(interne)
    }
  }
  throw new Error('readMediaVariant doit renvoyer les octets de la variante (Buffer ou { data: Buffer }).')
}

describe('medias — téléversement (CA18 à CA23)', () => {
  it('CA18 should convert a heavy EXIF-rotated JPEG into webp variants (1200x1600) stored under <userId>/<mediaId>', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const resultat = await uploadMedia(a.id, photoLourde)

    const [ligne] = await db.select().from(medias).where(eq(medias.id, resultat.id))
    expect(ligne).toMatchObject({
      userId: a.id,
      mime: 'image/webp',
      largeur: 1200,
      hauteur: 1600,
      chemin: `${a.id}/${resultat.id}`,
      disk: 'local',
    })
    expect(ligne.taille).toBeGreaterThan(0)
  })

  it('CA18 should write 3 webp variants (400, 800, 1600) without EXIF nor orientation, taller than wide', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const { id } = await uploadMedia(a.id, photoLourde)

    const variantes = await variantesSurDisque(id)
    expect(variantes).toHaveLength(MEDIA_WIDTHS.length)
    expect(variantes.map((v) => v.grandCote).sort((x, y) => x - y)).toEqual([...MEDIA_WIDTHS])
    for (const variante of variantes) {
      expect(variante.meta.format).toBe('webp')
      expect(variante.meta.exif).toBeUndefined()
      expect(variante.meta.orientation ?? 1).toBe(1)
      expect(variante.meta.height ?? 0).toBeGreaterThan(variante.meta.width ?? 0)
    }
    const plusGrande = variantes.find((v) => v.grandCote === 1600)
    expect([plusGrande?.meta.width, plusGrande?.meta.height]).toEqual([1200, 1600])
  })

  it('CA18 should strip the EXIF metadata (copyright, orientation) from every variant', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const { id } = await uploadMedia(a.id, await makeJpegWithExif())

    for (const variante of await variantesSurDisque(id)) {
      expect(variante.meta.exif).toBeUndefined()
      expect(variante.octets.includes(Buffer.from('Secret Photographe'))).toBe(false)
    }
  })

  it('CA18 should not use any client-provided name: only generated identifiers appear in the storage tree', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const { id } = await uploadMedia(a.id, await makePng())

    const relatifs = (await fichiersSous(mediasDir())).map((f) => path.relative(mediasDir(), f))
    expect(relatifs).toHaveLength(3)
    for (const relatif of relatifs) {
      expect(relatif.startsWith(`${a.id}${path.sep}`)).toBe(true)
      expect(relatif).toContain(id)
    }
  })

  it.each([
    ['PNG', () => makePng(500, 300)],
    ['WebP', () => makeWebp(500, 300)],
    ['JPEG', () => makeJpeg(500, 300)],
  ])('CA19 should accept a %s and store it as image/webp', async (_format, fabriquer) => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const { id } = await uploadMedia(a.id, await fabriquer())

    const [ligne] = await db.select().from(medias).where(eq(medias.id, id))
    expect(ligne).toMatchObject({ mime: 'image/webp', largeur: 500, hauteur: 300 })
    expect(await fichiersDuMedia(id)).toHaveLength(3)
  })

  it('CA19 should never enlarge a small image: every variant keeps the original 300x200', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const { id } = await uploadMedia(a.id, await makePng(300, 200))

    const [ligne] = await db.select().from(medias).where(eq(medias.id, id))
    expect([ligne.largeur, ligne.hauteur]).toEqual([300, 200])
    for (const variante of await variantesSurDisque(id)) {
      expect([variante.meta.width, variante.meta.height]).toEqual([300, 200])
    }
  })

  it('CA19 should give two simultaneous uploads of the same user distinct identifiers', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    const image = await makePng()

    const resultats = await Promise.all(Array.from({ length: 4 }, () => uploadMedia(a.id, image)))

    expect(new Set(resultats.map((r) => r.id)).size).toBe(4)
    expect(await lignesMedias()).toHaveLength(4)
    expect(await fichiersSous(mediasDir())).toHaveLength(12)
  })

  it.each([
    ['exécutable MZ renommé en .jpg', () => makeMzBytes()],
    ['GIF', () => Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary')],
    ['SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['PDF', () => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')],
    ['RIFF qui n’est pas du WebP (WAVE)', () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)])],
  ])('CA20 should reject %s with TYPE_NON_SUPPORTE and persist nothing', async (_libelle, fabriquer) => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const erreur = await rejet(uploadMedia(a.id, fabriquer()))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TYPE_NON_SUPPORTE')
    expect(erreur.status).toBe(415)
    await aucuneTraceLaissee()
  })

  it('CA21 should reject a file of MEDIA_MAX_BYTES + 1 with FICHIER_TROP_LOURD before any decoding', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    // Signature JPEG valide + zéros : un décodage donnerait IMAGE_ILLISIBLE, pas FICHIER_TROP_LOURD.
    const trop = Buffer.alloc(MEDIA_MAX_BYTES + 1)
    trop[0] = 0xff
    trop[1] = 0xd8
    trop[2] = 0xff

    const erreur = await rejet(uploadMedia(a.id, trop))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('FICHIER_TROP_LOURD')
    expect(erreur.status).toBe(413)
    await aucuneTraceLaissee()
  })

  it('CA21 should check the size before the type (an oversized unknown file is "too heavy", not "unsupported")', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const erreur = await rejet(uploadMedia(a.id, Buffer.alloc(MEDIA_MAX_BYTES + 1)))

    expect(erreur.code).toBe('FICHIER_TROP_LOURD')
  })

  it('CA21 should accept a heavy photo that is under the limit', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    expect(photoLourde.length).toBeLessThan(MEDIA_MAX_BYTES)

    const { id } = await uploadMedia(a.id, photoLourde)

    expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(1)
    expect(await fichiersDuMedia(id)).toHaveLength(MEDIA_WIDTHS.length)
  })

  it.each([
    ['JPEG suivi de déchets', () => makeJpegWithGarbage()],
    ['PNG suivi de déchets', () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), makeJpegWithGarbage(2048).subarray(3)])],
    ['WebP suivi de déchets', () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP'), makeJpegWithGarbage(2048).subarray(3)])],
    ['signature JPEG seule', () => makeJpegMagicOnly()],
  ])('CA22 should reject %s with IMAGE_ILLISIBLE and persist nothing', async (_libelle, fabriquer) => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()

    const erreur = await rejet(uploadMedia(a.id, fabriquer()))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('IMAGE_ILLISIBLE')
    expect(erreur.status).toBe(422)
    await aucuneTraceLaissee()
  })

  it('CA22 should reject a 10000x10000 PNG with IMAGE_TROP_GRANDE and persist nothing', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    expect(pngGeant.length).toBeLessThan(MEDIA_MAX_BYTES)

    const erreur = await rejet(uploadMedia(a.id, pngGeant))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('IMAGE_TROP_GRANDE')
    expect(erreur.status).toBe(422)
    await aucuneTraceLaissee()
  }, TIMEOUT_IMAGE_LOURDE_MS)

  it('CA23 should remove the written files when the database insertion fails (unknown user, no mock)', async () => {
    const { uploadMedia } = await mediasService()
    const image = await makePng(300, 200)

    await expect(uploadMedia(randomUUID(), image)).rejects.toThrow()

    await aucuneTraceLaissee()
  })
})

describe('medias — suppression et lecture (CA24, CA25)', () => {
  it('CA24 should refuse to delete the media of another user with MEDIA_INTROUVABLE and leave it intact', async () => {
    const { uploadMedia, deleteMedia } = await mediasService()
    const a = await createUser()
    const b = await createUser()
    const { id } = await uploadMedia(a.id, await makePng())

    const erreur = await rejet(deleteMedia(b.id, id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MEDIA_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(1)
    expect(await fichiersDuMedia(id)).toHaveLength(3)
  })

  it('CA24 should delete the row and the 3 files when the owner deletes the media', async () => {
    const { uploadMedia, deleteMedia } = await mediasService()
    const a = await createUser()
    const { id } = await uploadMedia(a.id, await makePng())
    const autre = await uploadMedia(a.id, await makePng())

    await deleteMedia(a.id, id)

    expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(0)
    expect(await fichiersDuMedia(id)).toHaveLength(0)
    expect(await fichiersDuMedia(autre.id)).toHaveLength(3)
  })

  it('CA24 should answer MEDIA_INTROUVABLE for an unknown id and for a second deletion', async () => {
    const { uploadMedia, deleteMedia } = await mediasService()
    const a = await createUser()
    const { id } = await uploadMedia(a.id, await makePng())
    await deleteMedia(a.id, id)

    const inconnu = await rejet(deleteMedia(a.id, randomUUID()))
    const doublon = await rejet(deleteMedia(a.id, id))

    expect(inconnu.code).toBe('MEDIA_INTROUVABLE')
    expect(doublon.code).toBe('MEDIA_INTROUVABLE')
  })

  describe('deleteMediaIfUnreferenced', () => {
    it('CA7 should delete an unreferenced media (row and files)', async () => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const { id } = await uploadMedia(a.id, await makePng())

      await deleteMediaIfUnreferenced(a.id, id)

      expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(0)
      expect(await fichiersDuMedia(id)).toHaveLength(0)
    })

    it.each([
      ['une image de service', async (vitrineId: string, mediaId: string) => insertService(vitrineId, { imageMediaId: mediaId })],
      ['une image de réalisation', async (vitrineId: string, mediaId: string) => insertRealisation(vitrineId, { imageMediaId: mediaId })],
      ['une image de galerie de réalisation', async (vitrineId: string, mediaId: string) => {
        const ligne = await insertRealisation(vitrineId)
        await insertRealisationImage(ligne.id, mediaId, 0)
      }],
    ])('CA7 should keep a media still referenced by %s', async (_libelle, referencer) => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const vitrine = await insertVitrineRow(a.id)
      const { id } = await uploadMedia(a.id, await makePng())
      await referencer(vitrine.id, id)

      await deleteMediaIfUnreferenced(a.id, id)

      expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(1)
      expect(await fichiersDuMedia(id)).toHaveLength(3)
    })

    it('CA42 should keep a gallery image of a realisation, then delete it once the realisation is gone', async () => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const vitrine = await insertVitrineRow(a.id)
      const g1 = await uploadMedia(a.id, await makePng())
      const ligne = await insertRealisation(vitrine.id)
      await insertRealisationImage(ligne.id, g1.id, 0)

      await deleteMediaIfUnreferenced(a.id, g1.id)

      expect(await db.select().from(medias).where(eq(medias.id, g1.id))).toHaveLength(1)
      expect(await fichiersDuMedia(g1.id)).toHaveLength(3)

      await db.delete(realisations).where(eq(realisations.id, ligne.id))
      await deleteMediaIfUnreferenced(a.id, g1.id)

      expect(await db.select().from(medias).where(eq(medias.id, g1.id))).toHaveLength(0)
      expect(await fichiersDuMedia(g1.id)).toHaveLength(0)
    })

    it('CA42 should keep an image that is in a gallery AND the main image of another realisation, with its gallery line', async () => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const vitrine = await insertVitrineRow(a.id)
      const partagee = await uploadMedia(a.id, await makePng())
      const r1 = await insertRealisation(vitrine.id)
      await insertRealisationImage(r1.id, partagee.id, 0)
      await insertRealisation(vitrine.id, { imageMediaId: partagee.id })

      await deleteMediaIfUnreferenced(a.id, partagee.id)

      expect(await db.select().from(medias).where(eq(medias.id, partagee.id))).toHaveLength(1)
      expect(await db.select().from(realisationImages).where(eq(realisationImages.realisationId, r1.id))).toHaveLength(1)
    })

    it('CA7 should keep a media still used as the vitrine photo', async () => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const vitrine = await insertVitrineRow(a.id)
      const { id } = await uploadMedia(a.id, await makePng())
      await db.update(vitrines).set({ photoMediaId: id }).where(eq(vitrines.id, vitrine.id))

      await deleteMediaIfUnreferenced(a.id, id)

      expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(1)
    })

    it('CA24 should never delete the media of another user', async () => {
      const { uploadMedia, deleteMediaIfUnreferenced } = await mediasService()
      const a = await createUser()
      const b = await createUser()
      const { id } = await uploadMedia(a.id, await makePng())

      await deleteMediaIfUnreferenced(b.id, id).catch(() => undefined)

      expect(await db.select().from(medias).where(eq(medias.id, id))).toHaveLength(1)
      expect(await fichiersDuMedia(id)).toHaveLength(3)
    })
  })

  it.each(MEDIA_WIDTHS)('CA25 should read the %i px variant of an existing media', async (largeur) => {
    const { uploadMedia, readMediaVariant } = await mediasService()
    const a = await createUser()
    const { id } = await uploadMedia(a.id, await makePng(2000, 1000))

    const octets = versOctets(await readMediaVariant(id, largeur))

    const meta = await sharp(octets).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(largeur)
  })

  it('CA25 should throw NotFound for a width that is not a published variant (500)', async () => {
    const { uploadMedia, readMediaVariant } = await mediasService()
    const a = await createUser()
    const { id } = await uploadMedia(a.id, await makePng())

    const erreur = await rejet(readMediaVariant(id, 500 as never))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.status).toBe(404)
  })

  it('CA25 should throw NotFound for an unknown media id', async () => {
    const { readMediaVariant } = await mediasService()

    const erreur = await rejet(readMediaVariant(randomUUID(), 800))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MEDIA_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it.each(['../../../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'a:b', 'a/b', ''])('CA25 should refuse the malformed media id %j without reading outside the storage', async (idHostile) => {
    const { readMediaVariant } = await mediasService()

    await expect(readMediaVariant(idHostile, 800)).rejects.toThrow()
  })

  it('CA25 should throw NotFound once the media has been deleted', async () => {
    const { uploadMedia, deleteMedia, readMediaVariant } = await mediasService()
    const a = await createUser()
    const { id } = await uploadMedia(a.id, await makePng())
    await deleteMedia(a.id, id)

    const erreur = await rejet(readMediaVariant(id, 800))

    expect(erreur.status).toBe(404)
  })

  it('should remove the whole folder of a user with deleteAllUserMediaFiles and leave the others untouched', async () => {
    const { uploadMedia, deleteAllUserMediaFiles } = await mediasService()
    const a = await createUser()
    const b = await createUser()
    await uploadMedia(a.id, await makePng())
    await uploadMedia(a.id, await makePng())
    const deB = await uploadMedia(b.id, await makePng())

    await deleteAllUserMediaFiles(a.id)

    expect(existsSync(path.join(mediasDir(), a.id))).toBe(false)
    expect(await fichiersDuMedia(deB.id)).toHaveLength(3)
  })

  it('should not fail when deleteAllUserMediaFiles runs for a user without any file', async () => {
    const { deleteAllUserMediaFiles } = await mediasService()

    await expect(deleteAllUserMediaFiles(randomUUID())).resolves.not.toThrow()
  })
})

describe('medias — limitation (CA26)', () => {
  it('CA26 should throw TooManyRequestsError on the 31st upload within the hour, without storing it', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    const image = await makePng()
    for (let i = 0; i < MEDIA_UPLOAD_LIMIT.limit; i += 1) {
      await uploadMedia(a.id, image)
    }

    const erreur = await rejet(uploadMedia(a.id, image))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(erreur.status).toBe(429)
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(await lignesMedias()).toHaveLength(MEDIA_UPLOAD_LIMIT.limit)
    expect(await fichiersSous(mediasDir())).toHaveLength(MEDIA_UPLOAD_LIMIT.limit * MEDIA_WIDTHS.length)
  }, TIMEOUT_IMAGE_LOURDE_MS)

  it('CA26 should not limit another user', async () => {
    const { uploadMedia } = await mediasService()
    const a = await createUser()
    const b = await createUser()
    const image = await makePng()
    for (let i = 0; i < MEDIA_UPLOAD_LIMIT.limit; i += 1) {
      await uploadMedia(a.id, image)
    }

    await rejet(uploadMedia(a.id, image))

    const { id } = await uploadMedia(b.id, image)
    expect(await fichiersDuMedia(id)).toHaveLength(MEDIA_WIDTHS.length)
  }, TIMEOUT_IMAGE_LOURDE_MS)
})
