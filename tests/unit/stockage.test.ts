import { describe, expect, it } from 'vitest'

// server/utils/stockage.ts — mediaKey(userId, mediaId, w) : clé construite côté serveur,
// ids validés par ^[A-Za-z0-9_-]+$ (un id hostile ne doit jamais sortir de MEDIAS_DIR).
const stockage = () => import('../../server/utils/stockage')

const USER_ID = 'K3x9QmZ0aB7vT2nLpR5sYw8cD1eFgHjU'
const MEDIA_ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

describe('mediaKey', () => {
  it('should build `${userId}:${mediaId}:${width}.webp`', async () => {
    const { mediaKey } = await stockage()

    expect(mediaKey(USER_ID, MEDIA_ID, 800)).toBe(`${USER_ID}:${MEDIA_ID}:800.webp`)
  })

  it.each([400, 800, 1600] as const)('should embed the width %i', async (largeur) => {
    const { mediaKey } = await stockage()

    expect(mediaKey(USER_ID, MEDIA_ID, largeur).endsWith(`:${largeur}.webp`)).toBe(true)
  })

  it.each([
    ['traversée de dossier', '../../etc/passwd'],
    ['traversée encodée', '..%2f..%2fetc'],
    ['séparateur de chemin', 'a/b'],
    ['séparateur de clé unstorage', 'a:b'],
    ['point', 'a.b'],
    ['espace', 'a b'],
    ['chaîne vide', ''],
    ['octet nul', 'abc\u0000'],
    ['saut de ligne', 'abc\n'],
  ])('should refuse a media id with a %s', async (_libelle, hostile) => {
    const { mediaKey } = await stockage()

    expect(() => mediaKey(USER_ID, hostile, 800)).toThrow()
  })

  it.each([
    ['traversée de dossier', '../autre'],
    ['séparateur de clé unstorage', 'a:b'],
    ['chaîne vide', ''],
  ])('should refuse a user id with a %s', async (_libelle, hostile) => {
    const { mediaKey } = await stockage()

    expect(() => mediaKey(hostile, MEDIA_ID, 800)).toThrow()
  })

  it('should accept identifiers made of letters, digits, hyphen and underscore', async () => {
    const { mediaKey } = await stockage()

    expect(mediaKey('user_ID-01', 'media_ID-02', 400)).toBe('user_ID-01:media_ID-02:400.webp')
  })
})
