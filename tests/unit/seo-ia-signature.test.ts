import { describe, expect, it } from 'vitest'
import { VERSION_SIGNATURE_ATTENDUE, signatureAttendue } from './support/seo-ia'

// Décision #24, groupe A : la signature des entrées du SEO IA décide si le texte généré est « frais ».
// Module PUR (aucune base, aucun réseau) attendu : server/services/ia/seo-regles.ts.
const regles = () => import('../../server/services/ia/seo-regles')

const ENTREES = { metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'CM', accroche: 'Votre cœur entre de bonnes mains' }

interface LigneVitrineSeo {
  titre: string | null
  prenom: string
  nom: string
  bio: string | null
  seoTitre: string | null
  seoDescription: string | null
  metier: string
  ville: string | null
  pays: string | null
  accroche: string | null
  seoIaTitre: string | null
  seoIaDescription: string | null
  seoIaSignature: string | null
  seoIaGenereLe: Date | null
}

/** Ligne de vitrine dont le SEO IA est FRAIS par défaut (signature calculée par la formule de référence). */
function ligne(surcharges: Partial<LigneVitrineSeo> = {}): LigneVitrineSeo {
  return {
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    bio: 'Une présentation de plusieurs phrases.',
    seoTitre: null,
    seoDescription: null,
    ...ENTREES,
    seoIaTitre: 'Cardiologue à Douala',
    seoIaDescription: 'Consultations de cardiologie à Douala pour vous accompagner avec écoute et clarté.',
    seoIaSignature: signatureAttendue(ENTREES),
    seoIaGenereLe: new Date('2026-11-10T10:00:00.000Z'),
    ...surcharges,
  }
}

describe('SEO_SIGNATURE_VERSION', () => {
  it('should be « v1 » (a bump invalidates every stored proposal at once)', async () => {
    const { SEO_SIGNATURE_VERSION } = await regles()

    expect(SEO_SIGNATURE_VERSION).toBe(VERSION_SIGNATURE_ATTENDUE)
  })
})

describe('signatureEntreesSeo (A)', () => {
  it('should be the sha256 hex of [version, metier, ville, pays, accroche] joined by U+001F, each text normalised', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo(ENTREES)).toBe(signatureAttendue(ENTREES))
  })

  it('should be 64 lowercase hexadecimal characters (the vitrines_seo_ia_signature_check format)', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo(ENTREES)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should be stable: same inputs, same signature, on every call', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES })).toBe(signatureEntreesSeo({ ...ENTREES }))
  })

  it.each([
    ['métier', { metier: 'CARDIOLOGUE INTERVENTIONNEL' }],
    ['ville', { ville: 'DOUALA' }],
    ['accroche', { accroche: 'VOTRE CŒUR ENTRE DE BONNES MAINS' }],
  ])('should ignore a change of case in the %s', async (_nom, changement) => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES, ...changement })).toBe(signatureEntreesSeo(ENTREES))
  })

  it('should ignore leading, trailing and repeated whitespace, newlines and tabs included', async () => {
    const { signatureEntreesSeo } = await regles()

    const desordre = {
      metier: '  Cardiologue \t interventionnel\n',
      ville: ' Douala  ',
      pays: 'CM',
      accroche: 'Votre   cœur\nentre de   bonnes mains ',
    }

    expect(signatureEntreesSeo(desordre)).toBe(signatureEntreesSeo(ENTREES))
  })

  it('should treat the composed and the decomposed form of an accent as the same text (NFC)', async () => {
    const { signatureEntreesSeo } = await regles()
    const compose = { ...ENTREES, ville: 'Yaoundé' }
    const decompose = { ...ENTREES, ville: 'Yaoundé' }

    expect(compose.ville).not.toBe(decompose.ville)
    expect(signatureEntreesSeo(decompose)).toBe(signatureEntreesSeo(compose))
  })

  it('should lower-case with the French locale (accented capitals)', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES, ville: 'ÉDÉA' })).toBe(signatureEntreesSeo({ ...ENTREES, ville: 'Édéa' }))
  })

  it('should give a null ville, a null accroche and a null pays the same signature as empty strings', async () => {
    const { signatureEntreesSeo } = await regles()

    const avecNull = { metier: 'Cardiologue', ville: null, pays: null, accroche: null }
    const avecVide = { metier: 'Cardiologue', ville: '', pays: '', accroche: '' }

    expect(signatureEntreesSeo(avecNull)).toBe(signatureEntreesSeo(avecVide))
    expect(signatureEntreesSeo(avecNull)).toBe(signatureAttendue(avecNull))
  })

  it('should give a whitespace-only accroche the same signature as no accroche', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES, accroche: '   \n ' })).toBe(signatureEntreesSeo({ ...ENTREES, accroche: null }))
  })

  it.each([
    ['métier', { metier: 'Pédiatre' }],
    ['ville', { ville: 'Yaoundé' }],
    ['pays', { pays: 'SN' }],
    ['accroche', { accroche: 'Une autre accroche tout à fait différente' }],
  ])('should change when the %s really changes', async (_nom, changement) => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES, ...changement })).not.toBe(signatureEntreesSeo(ENTREES))
  })

  it('should not fold accents: « Pediatre » and « Pédiatre » are two different métiers', async () => {
    const { signatureEntreesSeo } = await regles()

    expect(signatureEntreesSeo({ ...ENTREES, metier: 'Pediatre' })).not.toBe(signatureEntreesSeo({ ...ENTREES, metier: 'Pédiatre' }))
  })

  it('should not collide when text moves from one field to the next (separator between fields)', async () => {
    const { signatureEntreesSeo } = await regles()

    const colle = { metier: 'ab', ville: '', pays: null, accroche: null }
    const separe = { metier: 'a', ville: 'b', pays: null, accroche: null }

    expect(signatureEntreesSeo(colle)).not.toBe(signatureEntreesSeo(separe))
  })

  it('should ignore everything that is not métier, ville, pays or accroche (titre, prénom, nom, bio, saisies SEO)', async () => {
    const { signatureEntreesSeo } = await regles()
    const vitrine = ligne()
    const autre = ligne({ titre: 'pr', prenom: 'Autre', nom: 'Personne', bio: 'Une tout autre présentation.', seoTitre: 'Titre saisi à la main', seoDescription: 'Description saisie à la main' })

    expect(signatureEntreesSeo(autre)).toBe(signatureEntreesSeo(vitrine))
  })
})

describe('seoIaFraiche (A)', () => {
  it('should return the stored titre and description when the signature matches the current values', async () => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne())).toEqual({
      titre: 'Cardiologue à Douala',
      description: 'Consultations de cardiologie à Douala pour vous accompagner avec écoute et clarté.',
    })
  })

  it('should return null when no proposal was ever generated (null signature)', async () => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne({ seoIaSignature: null, seoIaTitre: null, seoIaDescription: null, seoIaGenereLe: null }))).toBeNull()
  })

  it.each([
    ['métier', { metier: 'Pédiatre' }],
    ['ville', { ville: 'Yaoundé' }],
    ['pays', { pays: 'SN' }],
    ['accroche', { accroche: 'Une accroche toute neuve' }],
    ['accroche retirée', { accroche: null }],
  ])('should return null (stale) once the %s changed since the generation', async (_nom, changement) => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne(changement))).toBeNull()
  })

  it('should stay fresh when only the case or the spacing of the inputs changed', async () => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne({ metier: ' CARDIOLOGUE   interventionnel ', ville: 'douala' }))).not.toBeNull()
  })

  it('should stay fresh when only titre, prénom, nom, bio or the typed SEO texts change', async () => {
    const { seoIaFraiche } = await regles()

    const modifiee = ligne({ titre: null, prenom: 'Autre', nom: 'Autrement', bio: 'Bio modifiée.', seoTitre: 'Un titre saisi', seoDescription: 'Une description saisie' })

    expect(seoIaFraiche(modifiee)).not.toBeNull()
  })

  it('should return null when the signature was computed with another version of the formula', async () => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne({ seoIaSignature: signatureAttendue(ENTREES, 'v0') }))).toBeNull()
  })

  it.each([
    ['titre', { seoIaTitre: null }],
    ['description', { seoIaDescription: null }],
  ])('should return null, never a half proposal, when the signature matches but the %s is missing', async (_nom, manque) => {
    const { seoIaFraiche } = await regles()

    expect(seoIaFraiche(ligne(manque))).toBeNull()
  })

  it('should not mutate the row it reads', async () => {
    const { seoIaFraiche } = await regles()
    const vitrine = ligne()
    const copie = structuredClone(vitrine)

    seoIaFraiche(vitrine)

    expect(vitrine).toEqual(copie)
  })
})
