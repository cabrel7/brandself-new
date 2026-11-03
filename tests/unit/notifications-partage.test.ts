import { describe, expect, it } from 'vitest'
import {
  PARTAGE_LINKEDIN_BASE,
  PARTAGE_WHATSAPP_BASE,
  buildShareMessage,
  linkedinShareUrl,
  whatsappShareUrl,
} from '../../shared/partage'

// S9 §3.5 / CA57 : message de partage prêt à envoyer. Fonctions pures de shared/partage.ts.

const URL_VITRINE = 'https://brandself.io/dr-cabrel'
const BASE = { prenom: 'Cabrel', metier: 'Cardiologue', url: URL_VITRINE, reservable: true }

describe('buildShareMessage', () => {
  it('should build exactly the reservable text of the spec, lower-casing the first letter of the job (CA57)', () => {
    expect(buildShareMessage(BASE)).toBe(
      'Bonjour, je suis Cabrel, cardiologue. Ma vitrine est en ligne : vous y trouverez mes services et vous pouvez réserver un rendez-vous directement. https://brandself.io/dr-cabrel',
    )
  })

  it('should build the non-reservable text with services and réalisations', () => {
    expect(buildShareMessage({ ...BASE, reservable: false })).toBe(
      'Bonjour, je suis Cabrel, cardiologue. Ma vitrine est en ligne : vous y trouverez mes services et mes réalisations. https://brandself.io/dr-cabrel',
    )
  })

  it('should always end with the URL, alone after a single space', () => {
    for (const reservable of [true, false]) {
      const message = buildShareMessage({ ...BASE, reservable })

      expect(message.endsWith(` ${URL_VITRINE}`)).toBe(true)
      expect(message.split(URL_VITRINE)).toHaveLength(2)
    }
  })

  it.each([
    ['ORL', 'ORL'],
    ['IT consultant', 'IT consultant'],
    ['RH', 'RH'],
    ['Coach RH', 'coach RH'],
    ['Cardiologue interventionnel', 'cardiologue interventionnel'],
    ['Médecin généraliste', 'médecin généraliste'],
    ['Énergéticien', 'énergéticien'],
    ['avocat', 'avocat'],
    ['Éa', 'éa'],
    ['A', 'a'],
  ])('should write the job %j as %j', (metier, attendu) => {
    expect(buildShareMessage({ ...BASE, metier })).toContain(`Bonjour, je suis Cabrel, ${attendu}. Ma vitrine`)
  })

  it('should trim stray spaces around the first name and the job (no double space in the sentence)', () => {
    const message = buildShareMessage({ ...BASE, prenom: '  Cabrel ', metier: ' Cardiologue  ' })

    expect(message).toContain('Bonjour, je suis Cabrel, cardiologue. Ma vitrine')
    expect(message).not.toMatch(/ {2}/)
  })

  it('should keep apostrophes, accents and symbols of the first name intact (no HTML, no escaping)', () => {
    const message = buildShareMessage({ ...BASE, prenom: "Jean-Pierre d'Éthiopie & fils" })

    expect(message).toContain("Bonjour, je suis Jean-Pierre d'Éthiopie & fils, cardiologue.")
    expect(message).not.toContain('&amp;')
  })

  it('should stay a single line of plain text (no newline, no tab)', () => {
    expect(buildShareMessage(BASE)).not.toMatch(/[\n\r\t]/)
  })

  it('should not throw on an empty job and still end with the URL', () => {
    const message = buildShareMessage({ ...BASE, metier: '' })

    expect(message.endsWith(URL_VITRINE)).toBe(true)
  })
})

describe('whatsappShareUrl', () => {
  it('should prefix the wa.me base and percent-encode the whole message', () => {
    const message = buildShareMessage(BASE)

    expect(whatsappShareUrl(message)).toBe(`${PARTAGE_WHATSAPP_BASE}${encodeURIComponent(message)}`)
    expect(PARTAGE_WHATSAPP_BASE).toBe('https://wa.me/?text=')
  })

  it('should round-trip the message through decodeURIComponent', () => {
    const message = buildShareMessage(BASE)

    expect(decodeURIComponent(whatsappShareUrl(message).slice(PARTAGE_WHATSAPP_BASE.length))).toBe(message)
  })

  it('should encode characters that would break the query string (space, &, #, ?, +, %, newline)', () => {
    const url = whatsappShareUrl('a b&c#d?e+f%g\nh')
    const requete = url.slice(PARTAGE_WHATSAPP_BASE.length)

    expect(requete).not.toMatch(/[ &#?+\n]/)
    expect(decodeURIComponent(requete)).toBe('a b&c#d?e+f%g\nh')
  })

  it('should encode an empty message as an empty query value', () => {
    expect(whatsappShareUrl('')).toBe(PARTAGE_WHATSAPP_BASE)
  })
})

describe('linkedinShareUrl', () => {
  it('should encode the URL only (LinkedIn accepts no message)', () => {
    expect(linkedinShareUrl(URL_VITRINE)).toBe(`${PARTAGE_LINKEDIN_BASE}${encodeURIComponent(URL_VITRINE)}`)
    expect(PARTAGE_LINKEDIN_BASE).toBe('https://www.linkedin.com/sharing/share-offsite/?url=')
  })

  it('should round-trip the URL and never carry the share message', () => {
    const lien = linkedinShareUrl(URL_VITRINE)

    expect(decodeURIComponent(lien.slice(PARTAGE_LINKEDIN_BASE.length))).toBe(URL_VITRINE)
    expect(lien).not.toContain('Bonjour')
  })

  it('should encode a URL carrying a query string so that it stays one parameter', () => {
    const lien = linkedinShareUrl('https://brandself.io/dr-cabrel?a=1&b=2')
    const valeur = lien.slice(PARTAGE_LINKEDIN_BASE.length)

    expect(valeur).not.toMatch(/[&?=/]/)
    expect(decodeURIComponent(valeur)).toBe('https://brandself.io/dr-cabrel?a=1&b=2')
  })
})
