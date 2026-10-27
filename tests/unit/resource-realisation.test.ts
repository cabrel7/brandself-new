import { describe, expect, it } from 'vitest'
import type { medias, realisations, vitrines } from '../../shared/db/schema'

// U22 — ressources (DTO) des réalisations : liste blanche explicite, galerie ordonnée, SEO (S4-CA39).
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU : server/resources/realisation.ts
//   toRealisationStudioResource(row, image, galerie)                 -> RealisationStudioDTO
//   toRealisationsCompteursResource(compteurs)                       -> RealisationsCompteursDTO
//   toRealisationPublicCarteResource(row, image)                     -> RealisationPublicCarteDTO
//   toRealisationPublicDetailResource(row, image, galerie, vitrine)  -> RealisationPublicDetailDTO
// `galerie` est un tableau de lignes `medias` DÉJÀ dans l'ordre d'affichage : la ressource ne le retrie jamais.
const ressource = () => import('../../server/resources/realisation')

type RealisationRow = typeof realisations.$inferSelect
type MediaRow = typeof medias.$inferSelect
type VitrineRow = typeof vitrines.$inferSelect

const ID_REALISATION = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const ID_VITRINE = '9a8b7c6d-1111-4222-8333-444455556666'
const ID_UTILISATEUR = 'utilisateur-secret-12345'
const ID_MEDIA = '5e6f7a8b-aaaa-4bbb-8ccc-ddddeeeeffff'
const ID_GALERIE = ['ffffffff-0000-4000-8000-000000000003', '88888888-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002']

const CLES_STUDIO = [
  'actif', 'annee', 'creeLe', 'description', 'enVedette', 'galerie', 'id', 'image', 'lieu', 'lien', 'modifieLe',
  'ordre', 'role', 'slug', 'titre',
].sort()

const CLES_CARTE = ['annee', 'description', 'image', 'lieu', 'slug', 'titre'].sort()

const CLES_DETAIL = [...CLES_CARTE, 'galerie', 'lien', 'role', 'seo'].sort()

const CLES_MEDIA = ['hauteur', 'id', 'largeur', 'srcset', 'url']

function ligne(surcharges: Partial<RealisationRow> = {}): RealisationRow {
  return {
    id: ID_REALISATION,
    vitrineId: ID_VITRINE,
    slug: 'unite-de-catheterisme-chu-de-douala',
    titre: 'Unité de cathétérisme, CHU de Douala',
    description: 'Mise en place et coordination d’une unité dédiée aux actes de cardiologie interventionnelle.',
    imageMediaId: ID_MEDIA,
    annee: 2025,
    lieu: 'CHU de Douala',
    role: 'Responsable médical',
    lien: 'https://chu-douala.cm/unite',
    enVedette: true,
    ordre: 2,
    actif: true,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-02T11:30:00.000Z'),
    ...surcharges,
  }
}

function media(id = ID_MEDIA): MediaRow {
  return {
    id,
    userId: ID_UTILISATEUR,
    disk: 'local',
    chemin: `${ID_UTILISATEUR}/${id}`,
    mime: 'image/webp',
    taille: 5000,
    largeur: 1600,
    hauteur: 900,
    createdAt: new Date('2026-03-01T09:00:00.000Z'),
  }
}

function vitrine(surcharges: Partial<VitrineRow> = {}): VitrineRow {
  return {
    id: ID_VITRINE,
    userId: ID_UTILISATEUR,
    username: 'dr-cabrel',
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    metier: 'Cardiologue',
    ville: 'Douala',
    pays: 'CM',
    accroche: null,
    bio: null,
    photoMediaId: null,
    emailContact: 'prive@exemple.com',
    telephone: '+237600000000',
    whatsapp: null,
    palette: 'terracotta',
    seoTitre: null,
    seoDescription: null,
    sectionsMasquees: [],
    fuseau: 'Africa/Douala',
    pasCreneauMin: 15,
    preavisHeures: 24,
    horizonJours: 30,
    publieeLe: new Date('2026-03-01T00:00:00.000Z'),
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...surcharges,
  } as VitrineRow
}

const galerie = () => ID_GALERIE.map((id) => media(id))

describe('toRealisationStudioResource (U22)', () => {
  it('should expose exactly the keys of RealisationStudioDTO and nothing of the ORM row', async () => {
    const { toRealisationStudioResource } = await ressource()

    const dto = toRealisationStudioResource(ligne(), media(), galerie())

    expect(Object.keys(dto).sort()).toEqual(CLES_STUDIO)
    for (const interdite of ['vitrineId', 'imageMediaId', 'createdAt', 'updatedAt']) {
      expect(dto).not.toHaveProperty(interdite)
    }
  })

  it('should copy the business fields, rename the dates and serialise them as ISO strings', async () => {
    const { toRealisationStudioResource } = await ressource()

    const dto = toRealisationStudioResource(ligne(), null, [])

    expect(dto).toMatchObject({
      id: ID_REALISATION,
      slug: 'unite-de-catheterisme-chu-de-douala',
      titre: 'Unité de cathétérisme, CHU de Douala',
      annee: 2025,
      lieu: 'CHU de Douala',
      role: 'Responsable médical',
      lien: 'https://chu-douala.cm/unite',
      enVedette: true,
      actif: true,
      ordre: 2,
      creeLe: '2026-03-01T10:00:00.000Z',
      modifieLe: '2026-03-02T11:30:00.000Z',
    })
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
  })

  it('should return a null image without media and a MediaDTO with the 1600 url with one', async () => {
    const { toRealisationStudioResource } = await ressource()

    expect(toRealisationStudioResource(ligne({ imageMediaId: null }), null, []).image).toBeNull()
    const avec = toRealisationStudioResource(ligne(), media(), [])
    expect(Object.keys(avec.image ?? {}).sort()).toEqual(CLES_MEDIA)
    expect(avec.image).toMatchObject({ id: ID_MEDIA, url: `/medias/${ID_MEDIA}/1600.webp`, largeur: 1600, hauteur: 900 })
    expect(JSON.stringify(avec)).not.toContain(ID_UTILISATEUR)
  })

  it('should keep the gallery in the order it receives (it never re-sorts by id) and map each image to a MediaDTO', async () => {
    const { toRealisationStudioResource } = await ressource()
    expect([...ID_GALERIE].sort()).not.toEqual(ID_GALERIE)

    const dto = toRealisationStudioResource(ligne(), media(), galerie())

    expect(dto.galerie.map((m) => m.id)).toEqual(ID_GALERIE)
    for (const image of dto.galerie) {
      expect(Object.keys(image).sort()).toEqual(CLES_MEDIA)
      expect(image.url).toBe(`/medias/${image.id}/1600.webp`)
    }
  })

  it('should answer an empty gallery as an empty array, never null or undefined', async () => {
    const { toRealisationStudioResource } = await ressource()

    expect(toRealisationStudioResource(ligne(), media(), []).galerie).toEqual([])
  })

  it('should keep the null columns as null', async () => {
    const { toRealisationStudioResource } = await ressource()

    const dto = toRealisationStudioResource(ligne({ description: null, annee: null, lieu: null, role: null, lien: null }), media(), [])

    expect(dto).toMatchObject({ description: null, annee: null, lieu: null, role: null, lien: null })
  })

  it('should never leak the owner, a disk path or the vitrine identifier', async () => {
    const { toRealisationStudioResource } = await ressource()

    const json = JSON.stringify(toRealisationStudioResource(ligne(), media(), galerie()))

    for (const secret of [ID_UTILISATEUR, ID_VITRINE, '"chemin"', '"disk"', '"userId"', '"vitrineId"']) {
      expect(json).not.toContain(secret)
    }
  })
})

describe('toRealisationsCompteursResource (U22)', () => {
  it('should expose the four counters and nothing else', async () => {
    const { toRealisationsCompteursResource } = await ressource()

    expect(toRealisationsCompteursResource({ total: 4, visibles: 3, enVedette: 2, vedetteMax: 3 })).toEqual({ total: 4, visibles: 3, enVedette: 2, vedetteMax: 3 })
  })
})

describe('toRealisationPublicCarteResource (U22)', () => {
  it('should expose exactly the keys of RealisationPublicCarteDTO', async () => {
    const { toRealisationPublicCarteResource } = await ressource()

    expect(Object.keys(toRealisationPublicCarteResource(ligne(), media())).sort()).toEqual(CLES_CARTE)
  })

  it('should never expose an identifier, the order, the vedette flag, the visibility, the dates, the role, the link or the owner', async () => {
    const { toRealisationPublicCarteResource } = await ressource()

    const json = JSON.stringify(toRealisationPublicCarteResource(ligne(), media()))

    for (const secret of [ID_REALISATION, ID_VITRINE, ID_UTILISATEUR, '"ordre"', '"enVedette"', '"actif"', '"creeLe"', '"modifieLe"', '"createdAt"', '"vitrineId"', '"imageMediaId"', '"chemin"', '"role"', '"lien"', '"galerie"']) {
      expect(json).not.toContain(secret)
    }
  })

  it('should carry what a card needs: slug, title, description, image, year and place', async () => {
    const { toRealisationPublicCarteResource } = await ressource()

    const dto = toRealisationPublicCarteResource(ligne(), null)

    expect(dto).toEqual({
      slug: 'unite-de-catheterisme-chu-de-douala',
      titre: 'Unité de cathétérisme, CHU de Douala',
      description: 'Mise en place et coordination d’une unité dédiée aux actes de cardiologie interventionnelle.',
      image: null,
      annee: 2025,
      lieu: 'CHU de Douala',
    })
  })
})

describe('toRealisationPublicDetailResource (U22)', () => {
  it('should expose exactly the keys of RealisationPublicDetailDTO, with seo = { titre, description }', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const dto = toRealisationPublicDetailResource(ligne(), media(), galerie(), vitrine())

    expect(Object.keys(dto).sort()).toEqual(CLES_DETAIL)
    expect(Object.keys(dto.seo).sort()).toEqual(['description', 'titre'])
  })

  it('should never leak the owner, the vitrine contact details or internal fields (whitelist, no spread)', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const json = JSON.stringify(toRealisationPublicDetailResource(ligne(), media(), galerie(), vitrine()))

    for (const secret of [ID_REALISATION, ID_VITRINE, ID_UTILISATEUR, 'prive@exemple.com', '+237600000000', '"ordre"', '"enVedette"', '"actif"', '"vitrineId"', '"createdAt"', '"creeLe"', '"modifieLe"', '"preavisHeures"', '"chemin"', '"imageMediaId"']) {
      expect(json).not.toContain(secret)
    }
  })

  it('should expose the role, the link and the gallery in the order received, each image as a MediaDTO', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const dto = toRealisationPublicDetailResource(ligne(), media(), galerie(), vitrine())

    expect(dto.role).toBe('Responsable médical')
    expect(dto.lien).toBe('https://chu-douala.cm/unite')
    expect(dto.galerie.map((m) => m.id)).toEqual(ID_GALERIE)
    expect(Object.keys(dto.galerie[0] ?? {}).sort()).toEqual(CLES_MEDIA)
    expect(dto.image?.url).toBe(`/medias/${ID_MEDIA}/1600.webp`)
  })

  it('should keep a null role, link and an empty gallery as they are', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const dto = toRealisationPublicDetailResource(ligne({ role: null, lien: null }), null, [], vitrine())

    expect(dto).toMatchObject({ role: null, lien: null, galerie: [], image: null })
  })

  it('should compose the SEO title as "<titre> — <nomAffiche>" (S4-CA39)', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    expect(toRealisationPublicDetailResource(ligne(), null, [], vitrine()).seo.titre).toBe('Unité de cathétérisme, CHU de Douala — Dr Cabrel Nguesso')
  })

  it('should leave out the title prefix of the display name when the vitrine has none', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    expect(toRealisationPublicDetailResource(ligne(), null, [], vitrine({ titre: null })).seo.titre).toBe('Unité de cathétérisme, CHU de Douala — Cabrel Nguesso')
  })

  it('should use a short description as is for seo.description', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    expect(toRealisationPublicDetailResource(ligne({ description: 'Un projet court.' }), null, [], vitrine()).seo.description).toBe('Un projet court.')
  })

  it('should keep a description of exactly 160 characters untouched', async () => {
    const { toRealisationPublicDetailResource } = await ressource()
    const description = `${'a'.repeat(79)} ${'b'.repeat(80)}`
    expect(description).toHaveLength(160)

    expect(toRealisationPublicDetailResource(ligne({ description }), null, [], vitrine()).seo.description).toBe(description)
  })

  it('should cut a 300-character description to at most 160 characters on a word boundary', async () => {
    const { toRealisationPublicDetailResource } = await ressource()
    const description = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    expect(description.length).toBeGreaterThan(160)

    const seo = toRealisationPublicDetailResource(ligne({ description }), null, [], vitrine()).seo.description

    expect(seo.length).toBeLessThanOrEqual(160)
    expect(seo.length).toBeGreaterThan(100)
    const coupe = seo.replace(/[\s….]+$/u, '')
    expect(description.startsWith(coupe)).toBe(true)
    expect(description.charAt(coupe.length)).toMatch(/\s/)
  })

  it('should still cut at 160 characters when the description has no space at all', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const seo = toRealisationPublicDetailResource(ligne({ description: 'a'.repeat(400) }), null, [], vitrine()).seo.description

    expect(seo.length).toBeLessThanOrEqual(160)
    expect(seo.length).toBeGreaterThan(0)
  })

  it('should flatten line breaks of the description in seo.description (a meta description is one line)', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const seo = toRealisationPublicDetailResource(ligne({ description: 'Première ligne.\n\nSeconde ligne.' }), null, [], vitrine()).seo.description

    expect(seo).not.toMatch(/[\r\n]/)
    expect(seo).toContain('Première ligne.')
  })

  it.each([[null], [''], ['   '], ['\n\t ']])('should fall back to "<titre>, une réalisation de <nomAffiche>, <metier> à <ville>." when the description is %j', async (description) => {
    const { toRealisationPublicDetailResource } = await ressource()

    const dto = toRealisationPublicDetailResource(ligne({ description }), null, [], vitrine())

    expect(dto.seo.description).toBe('Unité de cathétérisme, CHU de Douala, une réalisation de Dr Cabrel Nguesso, Cardiologue à Douala.')
  })

  it('should leave out " à <ville>" in the fallback when the vitrine has no city', async () => {
    const { toRealisationPublicDetailResource } = await ressource()

    const dto = toRealisationPublicDetailResource(ligne({ description: null }), null, [], vitrine({ ville: null }))

    expect(dto.seo.description).toBe('Unité de cathétérisme, CHU de Douala, une réalisation de Dr Cabrel Nguesso, Cardiologue.')
  })
})
