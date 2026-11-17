import { describe, expect, it } from 'vitest'
import { plateformeDuLien } from '../../shared/plateformes'
import type { LienType } from '../../shared/liens'

const lien = (type: LienType, url: string, plateforme: string | null = null) => ({ type, plateforme, url })

describe('plateformeDuLien', () => {
  it('le type construit par le serveur prime', () => {
    expect(plateformeDuLien(lien('whatsapp', 'https://wa.me/237699000001'))).toBe('whatsapp')
    expect(plateformeDuLien(lien('email', 'mailto:a@b.test'))).toBe('email')
    expect(plateformeDuLien(lien('telephone', 'tel:+237699000002'))).toBe('telephone')
  })

  it('une page interne de la vitrine n’a pas de plateforme', () => {
    expect(plateformeDuLien(lien('vitrine', '/dr-cabrel/services'))).toBeNull()
  })

  it('un réseau utilise sa plateforme renseignée', () => {
    expect(plateformeDuLien(lien('reseau', 'https://www.linkedin.com/in/x', 'linkedin'))).toBe('linkedin')
  })

  it('un réseau sans plateforme est déduit du domaine', () => {
    expect(plateformeDuLien(lien('reseau', 'https://instagram.com/x'))).toBe('instagram')
  })

  it.each([
    ['https://www.instagram.com/x', 'instagram'],
    ['https://facebook.com/x', 'facebook'],
    ['https://fb.com/x', 'facebook'],
    ['https://m.facebook.com/x', 'facebook'],
    ['https://www.linkedin.com/in/x', 'linkedin'],
    ['https://youtube.com/@x', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://www.tiktok.com/@x', 'tiktok'],
    ['https://x.com/x', 'x'],
    ['https://twitter.com/x', 'x'],
    ['https://t.me/x', 'telegram'],
    ['https://wa.me/237699000001', 'whatsapp'],
    ['mailto:a@b.test', 'email'],
    ['tel:+237699000002', 'telephone'],
  ])('lien libre %s -> %s', (url, attendu) => {
    expect(plateformeDuLien(lien('libre', url))).toBe(attendu)
  })

  it('un site web quelconque, une URL mal formée ou un faux domaine donnent null', () => {
    expect(plateformeDuLien(lien('libre', 'https://mon-site.test'))).toBeNull()
    expect(plateformeDuLien(lien('libre', 'pas une url'))).toBeNull()
    expect(plateformeDuLien(lien('libre', 'https://notinstagram.com/x'))).toBeNull()
    expect(plateformeDuLien(lien('libre', 'https://instagram.com.evil.test/x'))).toBeNull()
  })
})
