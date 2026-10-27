import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

// U19 — règles pures des réalisations (server/services/realisations-regles.ts) : aucune base, aucun réseau.
// Imports paresseux : tant que le module n'existe pas (phase RED), chaque test échoue pour la bonne raison.
//
// CONTRAT ATTENDU (à respecter en GREEN) :
//   interface RealisationState { imageMediaId: string | null, galerie: string[], actif: boolean, enVedette: boolean }
//   normalizeRealisationState(etat, patch)   -> état fusionné ET normalisé (R4), NOUVEL objet, entrées intactes ;
//                                               les clés `undefined` du patch sont ignorées ; `galerie` fournie remplace
//                                               toute la galerie, absente laisse l'ancienne ; `imageMediaId: null` est un état valide
//   checkRealisationCoherence(etat)          -> Record<champ, string[]> ; {} si cohérent
//        galerie        : l'image principale (non nulle) apparaît dans la galerie        (R2)
//        enVedette      : enVedette ET NOT actif                                          (R5)
//   mediasARetirer(avant, apres)             -> string[] : (image avant ∪ galerie avant) − (image après ∪ galerie après),
//                                               sans doublon, sans null (R8) ; `avant` et `apres` ont au moins { imageMediaId, galerie }
const regles = () => import('../../server/services/realisations-regles')

interface Etat {
  imageMediaId: string | null
  galerie: string[]
  actif: boolean
  enVedette: boolean
}

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const G3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const VISIBLE: Etat = { imageMediaId: M1, galerie: [], actif: true, enVedette: false }

/** Les messages utilisent l'apostrophe typographique du projet : on tolère les deux. */
const sansTypographie = (texte: string) => texte.replaceAll('’', "'")

describe('normalizeRealisationState (U19, R4)', () => {
  it('should return the state unchanged for an empty patch', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, galerie: [G1, G2], enVedette: true }, {})).toEqual({ ...VISIBLE, galerie: [G1, G2], enVedette: true })
  })

  it('should merge the patch over the state', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState(VISIBLE, { imageMediaId: M2, enVedette: true })).toEqual({ ...VISIBLE, imageMediaId: M2, enVedette: true })
  })

  it('should replace the whole gallery when one is sent, order included, and keep the old one otherwise', async () => {
    const { normalizeRealisationState } = await regles()
    const etat = { ...VISIBLE, galerie: [G1, G2, G3] }

    expect(normalizeRealisationState(etat, { galerie: [G3, G1] }).galerie).toEqual([G3, G1])
    expect(normalizeRealisationState(etat, { galerie: [] }).galerie).toEqual([])
    expect(normalizeRealisationState(etat, { actif: true }).galerie).toEqual([G1, G2, G3])
  })

  it('should ignore patch keys whose value is undefined', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, galerie: [G1] }, { imageMediaId: undefined, galerie: undefined, enVedette: undefined })).toEqual({ ...VISIBLE, galerie: [G1] })
  })

  it('should accept an old state without main image and keep it null when the patch does not touch it', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, imageMediaId: null }, { actif: false })).toMatchObject({ imageMediaId: null, actif: false })
  })

  it('should not mutate its inputs and return a new object', async () => {
    const { normalizeRealisationState } = await regles()
    const etat = Object.freeze({ ...VISIBLE, galerie: Object.freeze([G1]) as unknown as string[] })
    const patch = Object.freeze({ galerie: Object.freeze([G2]) as unknown as string[] })

    const resultat = normalizeRealisationState(etat, patch)

    expect(resultat).not.toBe(etat)
    expect(etat.galerie).toEqual([G1])
    expect(patch.galerie).toEqual([G2])
  })

  it('should withdraw the vedette of a realisation that becomes masked when enVedette is not sent', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, enVedette: true }, { actif: false })).toMatchObject({ actif: false, enVedette: false })
  })

  it('should keep an explicit enVedette true next to actif false so that the coherence check can report it (R5)', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState(VISIBLE, { actif: false, enVedette: true })).toMatchObject({ actif: false, enVedette: true })
  })

  it('should keep an explicit enVedette true on an already masked realisation (R5)', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, actif: false }, { enVedette: true })).toMatchObject({ actif: false, enVedette: true })
  })

  it('should leave the vedette alone when the realisation stays visible, and when it is shown again', async () => {
    const { normalizeRealisationState } = await regles()

    expect(normalizeRealisationState({ ...VISIBLE, enVedette: true }, {})).toMatchObject({ actif: true, enVedette: true })
    expect(normalizeRealisationState({ ...VISIBLE, actif: false }, { actif: true })).toMatchObject({ actif: true, enVedette: false })
  })

  it('should keep the extra fields of the state it receives (a generic merge, not a whitelist of four keys)', async () => {
    const { normalizeRealisationState } = await regles()

    const resultat = normalizeRealisationState({ ...VISIBLE, titre: 'Bilan' }, { actif: false })

    expect(resultat).toMatchObject({ titre: 'Bilan', actif: false })
  })
})

describe('checkRealisationCoherence (U19, R2 et R5)', () => {
  it.each([
    ['une réalisation visible sans galerie', VISIBLE],
    ['une galerie de six images', { ...VISIBLE, galerie: [G1, G2, G3, randomUUID(), randomUUID(), randomUUID()] }],
    ['une vedette visible', { ...VISIBLE, enVedette: true }],
    ['une réalisation masquée hors vedette', { ...VISIBLE, actif: false }],
    ['une ligne ancienne sans image principale', { ...VISIBLE, imageMediaId: null }],
    ['une ligne ancienne sans image mais avec une galerie', { ...VISIBLE, imageMediaId: null, galerie: [G1] }],
  ])('should report nothing for %s', async (_libelle, etat) => {
    const { checkRealisationCoherence } = await regles()

    expect(checkRealisationCoherence(etat)).toEqual({})
  })

  it('should refuse the main image inside the gallery, on the field galerie, with the exact French message (R2, S4-CA14)', async () => {
    const { checkRealisationCoherence } = await regles()

    const erreurs = checkRealisationCoherence({ ...VISIBLE, galerie: [G1, M1] })

    expect(Object.keys(erreurs)).toEqual(['galerie'])
    expect(erreurs.galerie?.map(sansTypographie)).toEqual(["Cette image est déjà l'image principale."])
  })

  it('should refuse a masked realisation in vedette with the exact French message (R5)', async () => {
    const { checkRealisationCoherence } = await regles()

    const erreurs = checkRealisationCoherence({ ...VISIBLE, actif: false, enVedette: true })

    expect(erreurs).toEqual({ enVedette: ['Une réalisation masquée ne peut pas être en vedette.'] })
  })

  it('should accumulate the errors of both rules at once', async () => {
    const { checkRealisationCoherence } = await regles()

    const erreurs = checkRealisationCoherence({ ...VISIBLE, galerie: [M1], actif: false, enVedette: true })

    expect(Object.keys(erreurs).sort()).toEqual(['enVedette', 'galerie'])
  })

  it('should check the MERGED state: a swap (G1 becomes the image, M1 enters the gallery) is coherent, a half swap is not', async () => {
    const { normalizeRealisationState, checkRealisationCoherence } = await regles()
    const avant = { ...VISIBLE, imageMediaId: M1, galerie: [G1] }

    const echange = normalizeRealisationState(avant, { imageMediaId: G1, galerie: [M1] })
    const demiEchange = normalizeRealisationState(avant, { imageMediaId: G1 })

    expect(checkRealisationCoherence(echange)).toEqual({})
    expect(Object.keys(checkRealisationCoherence(demiEchange))).toEqual(['galerie'])
  })
})

describe('mediasARetirer (U19, R8)', () => {
  const avant = { imageMediaId: M1, galerie: [G1, G2] }

  const trie = (ids: string[]) => [...ids].sort()

  it('should answer nothing when nothing changed', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer(avant, { imageMediaId: M1, galerie: [G1, G2] })).toEqual([])
  })

  it('should answer nothing when the gallery is only reordered', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer(avant, { imageMediaId: M1, galerie: [G2, G1] })).toEqual([])
  })

  it('should answer nothing for an exchange between the main image and the gallery (S4-CA21)', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer({ imageMediaId: M1, galerie: [G1] }, { imageMediaId: G1, galerie: [M1] })).toEqual([])
  })

  it('should answer the old main image when it is replaced by a new one', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer(avant, { imageMediaId: M2, galerie: [G1, G2] })).toEqual([M1])
  })

  it('should answer only the old main image when a gallery image is promoted to main image (G1 leaves the gallery but stays used)', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer(avant, { imageMediaId: G1, galerie: [G2] })).toEqual([M1])
  })

  it('should answer the images left out of a replaced gallery (S4-CA20)', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer({ imageMediaId: M1, galerie: [G1, G2, G3] }, { imageMediaId: M1, galerie: [G3, G1] })).toEqual([G2])
  })

  it('should answer every gallery image when the gallery is emptied (S4-CA20)', async () => {
    const { mediasARetirer } = await regles()

    expect(trie(mediasARetirer({ imageMediaId: M1, galerie: [G3, G1] }, { imageMediaId: M1, galerie: [] }))).toEqual(trie([G1, G3]))
  })

  it('should answer nothing when images are only added', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer({ imageMediaId: M1, galerie: [] }, { imageMediaId: M1, galerie: [G1, G2, G3] })).toEqual([])
  })

  it('should answer the old image AND the left-out gallery images together, each once', async () => {
    const { mediasARetirer } = await regles()

    const resultat = mediasARetirer({ imageMediaId: M1, galerie: [G1, G2] }, { imageMediaId: M2, galerie: [G2, G3] })

    expect(trie(resultat)).toEqual(trie([M1, G1]))
  })

  it('should never contain null, whatever side the null comes from (a legacy row without image)', async () => {
    const { mediasARetirer } = await regles()

    expect(mediasARetirer({ imageMediaId: null, galerie: [G1] }, { imageMediaId: M2, galerie: [G1] })).toEqual([])
    expect(mediasARetirer({ imageMediaId: M1, galerie: [] }, { imageMediaId: null, galerie: [] })).toEqual([M1])
    expect(mediasARetirer({ imageMediaId: null, galerie: [] }, { imageMediaId: null, galerie: [] })).toEqual([])
  })

  it('should never contain a duplicate, even from an inconsistent previous state where the image was also in the gallery', async () => {
    const { mediasARetirer } = await regles()

    const resultat = mediasARetirer({ imageMediaId: M1, galerie: [M1, G1] }, { imageMediaId: M2, galerie: [] })

    expect(trie(resultat)).toEqual(trie([M1, G1]))
    expect(new Set(resultat).size).toBe(resultat.length)
  })

  it('should not mutate its inputs', async () => {
    const { mediasARetirer } = await regles()
    const a = Object.freeze({ imageMediaId: M1, galerie: Object.freeze([G1]) as unknown as string[] })
    const b = Object.freeze({ imageMediaId: M2, galerie: Object.freeze([]) as unknown as string[] })

    expect(trie(mediasARetirer(a, b))).toEqual(trie([M1, G1]))
  })
})
