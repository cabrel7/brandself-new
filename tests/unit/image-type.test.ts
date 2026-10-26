import { describe, expect, it } from 'vitest'
import { makeJpeg, makeMzBytes, makePng, makeWebp } from '../support/images'

// U2 — detectImageType(buf) : pure, octets magiques uniquement (jamais l'extension ni le nom).
// Import paresseux : le module existe déjà mais n'exporte pas encore la fonction (phase RED).
const mediasService = () => import('../../server/services/medias')

/** La spec ne fixe pas 'jpeg' ou 'image/jpeg' : on compare le sous-type. */
function sousType(resultat: string | null | undefined): string | null {
  return resultat ? resultat.replace(/^image\//, '') : null
}

describe('detectImageType (U2)', () => {
  it('should recognise a real JPEG', async () => {
    const { detectImageType } = await mediasService()

    expect(sousType(detectImageType(await makeJpeg()))).toBe('jpeg')
  })

  it('should recognise a real PNG', async () => {
    const { detectImageType } = await mediasService()

    expect(sousType(detectImageType(await makePng()))).toBe('png')
  })

  it('should recognise a real WebP', async () => {
    const { detectImageType } = await mediasService()

    expect(sousType(detectImageType(await makeWebp()))).toBe('webp')
  })

  it.each([
    ['exécutable Windows (MZ)', () => makeMzBytes()],
    ['GIF', () => Buffer.from('GIF89a', 'ascii')],
    ['PDF', () => Buffer.from('%PDF-1.7', 'ascii')],
    ['SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['HTML', () => Buffer.from('<!DOCTYPE html><html></html>')],
    ['RIFF WAVE (pas du WebP)', () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])],
    ['ZIP', () => Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('should return null for %s', async (_libelle, fabriquer) => {
    const { detectImageType } = await mediasService()

    expect(detectImageType(fabriquer()) ?? null).toBeNull()
  })

  it.each([
    ['tampon vide', Buffer.alloc(0)],
    ['1 octet', Buffer.from([0xff])],
    ['2 octets de JPEG (signature incomplète)', Buffer.from([0xff, 0xd8])],
    ['3 octets de PNG (signature incomplète)', Buffer.from([0x89, 0x50, 0x4e])],
    ['RIFF sans le marqueur WEBP (11 octets)', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEB')])],
  ])('should return null (and never throw) for %s', async (_libelle, tampon) => {
    const { detectImageType } = await mediasService()

    expect(() => detectImageType(tampon)).not.toThrow()
    expect(detectImageType(tampon) ?? null).toBeNull()
  })

  it('should decide from the leading bytes only (JPEG signature followed by garbage is still "jpeg")', async () => {
    const { detectImageType } = await mediasService()

    const tampon = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32, 0x41)])

    expect(sousType(detectImageType(tampon))).toBe('jpeg')
  })
})
