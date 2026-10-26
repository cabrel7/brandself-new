import { describe, expect, it } from 'vitest'
import { MEDIA_ACCEPTED_MIME, MEDIA_FORM_FIELD, MEDIA_WIDTHS, mediaSrcset, mediaUrl } from '../../shared/medias'

// U9 — mediaUrl / mediaSrcset

const ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

describe('mediaUrl (U9)', () => {
  it.each(MEDIA_WIDTHS)('should build the public path for width %i', (largeur) => {
    expect(mediaUrl(ID, largeur)).toBe(`/medias/${ID}/${largeur}.webp`)
  })

  it('should return a root-relative path (no host, no storage path)', () => {
    expect(mediaUrl(ID, 1600).startsWith('/medias/')).toBe(true)
    expect(mediaUrl(ID, 1600)).not.toContain('storage')
  })
})

describe('mediaSrcset (U9)', () => {
  it('should list every width, smallest first, with its descriptor', () => {
    expect(mediaSrcset(ID)).toBe(
      `/medias/${ID}/400.webp 400w, /medias/${ID}/800.webp 800w, /medias/${ID}/1600.webp 1600w`,
    )
  })

  it('should have as many candidates as published widths', () => {
    expect(mediaSrcset(ID).split(', ')).toHaveLength(MEDIA_WIDTHS.length)
  })
})

describe('contrat d’upload partagé', () => {
  it('should publish 400, 800 and 1600 px, in ascending order', () => {
    expect([...MEDIA_WIDTHS]).toEqual([400, 800, 1600])
  })

  it('should accept JPEG, PNG and WebP only, in the "fichier" multipart field', () => {
    expect([...MEDIA_ACCEPTED_MIME]).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(MEDIA_FORM_FIELD).toBe('fichier')
  })
})
