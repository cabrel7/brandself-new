import { describe, expect, it } from 'vitest'
import type { medias, services, vitrines } from '../../shared/db/schema'

// U17 — ressources (DTO) des services : liste blanche explicite, paiement forcé, SEO (S3-CA36).
// Imports paresseux : module absent en phase RED = échec propre de chaque test.
//
// CONTRAT ATTENDU : server/resources/service.ts
//   toServiceStudioResource(row, image)                          -> ServiceStudioDTO
//   toServicesCompteursResource(compteurs)                       -> ServicesCompteursDTO
//   toServicePublicCarteResource(row, image)                     -> ServicePublicCarteDTO
//   toServicePublicDetailResource(row, image, vitrine, { paiementEnLigne }) -> ServicePublicDetailDTO
const ressource = () => import('../../server/resources/service')

type ServiceRow = typeof services.$inferSelect
type MediaRow = typeof medias.$inferSelect
type VitrineRow = typeof vitrines.$inferSelect

const ID_SERVICE = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const ID_VITRINE = '9a8b7c6d-1111-4222-8333-444455556666'
const ID_UTILISATEUR = 'utilisateur-secret-12345'
const ID_MEDIA = '5e6f7a8b-aaaa-4bbb-8ccc-ddddeeeeffff'

const CLES_STUDIO = [
  'actif', 'creeLe', 'description', 'dureeMin', 'enVedette', 'id', 'image', 'inclus', 'modifieLe', 'nbSeances',
  'ordre', 'paiementInstructions', 'paiementMode', 'prixDevise', 'prixMontant', 'rythme', 'reservable', 'slug',
  'tarif', 'titre', 'type',
].sort()

const CLES_CARTE = [
  'description', 'dureeMin', 'image', 'nbSeances', 'prixDevise', 'prixMontant', 'reservable', 'rythme', 'slug',
  'tarif', 'titre', 'type',
].sort()

const CLES_DETAIL = [...CLES_CARTE, 'inclus', 'paiementInstructions', 'paiementMode', 'seo'].sort()

function ligne(surcharges: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: ID_SERVICE,
    vitrineId: ID_VITRINE,
    slug: 'consultation-de-cardiologie',
    titre: 'Consultation de cardiologie',
    description: 'Un bilan complet de votre santé cardiaque.',
    imageMediaId: null,
    type: 'rdv',
    nbSeances: null,
    rythme: null,
    dureeMin: 45,
    tarif: 'payant',
    prixMontant: 15000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    paiementInstructions: 'Espèces ou Mobile Money.',
    inclus: ['Examen clinique', 'Compte rendu'],
    reservable: true,
    enVedette: true,
    ordre: 2,
    actif: true,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-02T11:30:00.000Z'),
    ...surcharges,
  }
}

function media(): MediaRow {
  return {
    id: ID_MEDIA,
    userId: ID_UTILISATEUR,
    disk: 'local',
    chemin: `${ID_UTILISATEUR}/${ID_MEDIA}`,
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

const HORS_LIGNE = { paiementEnLigne: false }
const EN_LIGNE = { paiementEnLigne: true }

describe('toServiceStudioResource (U17)', () => {
  it('should expose exactly the keys of ServiceStudioDTO and nothing of the ORM row', async () => {
    const { toServiceStudioResource } = await ressource()

    const dto = toServiceStudioResource(ligne(), media())

    expect(Object.keys(dto).sort()).toEqual(CLES_STUDIO)
    for (const interdite of ['vitrineId', 'imageMediaId', 'createdAt', 'updatedAt']) {
      expect(dto).not.toHaveProperty(interdite)
    }
  })

  it('should copy the business fields, rename the dates and serialise them as ISO strings', async () => {
    const { toServiceStudioResource } = await ressource()

    const dto = toServiceStudioResource(ligne(), null)

    expect(dto).toMatchObject({
      id: ID_SERVICE,
      slug: 'consultation-de-cardiologie',
      titre: 'Consultation de cardiologie',
      type: 'rdv',
      dureeMin: 45,
      tarif: 'payant',
      prixMontant: 15000,
      prixDevise: 'XAF',
      paiementMode: 'sur_place',
      paiementInstructions: 'Espèces ou Mobile Money.',
      inclus: ['Examen clinique', 'Compte rendu'],
      reservable: true,
      enVedette: true,
      actif: true,
      ordre: 2,
      creeLe: '2026-03-01T10:00:00.000Z',
      modifieLe: '2026-03-02T11:30:00.000Z',
    })
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
  })

  it('should return a null image without media and a MediaDTO with the 1600 url with one', async () => {
    const { toServiceStudioResource } = await ressource()

    expect(toServiceStudioResource(ligne(), null).image).toBeNull()
    const avec = toServiceStudioResource(ligne({ imageMediaId: ID_MEDIA }), media())
    expect(Object.keys(avec.image ?? {}).sort()).toEqual(['hauteur', 'id', 'largeur', 'srcset', 'url'])
    expect(avec.image).toMatchObject({ id: ID_MEDIA, url: `/medias/${ID_MEDIA}/1600.webp`, largeur: 1600, hauteur: 900 })
    expect(JSON.stringify(avec)).not.toContain(ID_UTILISATEUR)
  })

  it('should keep the null columns as null and the inclus list as a copy', async () => {
    const { toServiceStudioResource } = await ressource()
    const row = ligne({ type: 'devis', tarif: 'devis', dureeMin: null, prixMontant: null, prixDevise: null, paiementMode: null, paiementInstructions: null, description: null, inclus: [] })

    const dto = toServiceStudioResource(row, null)

    expect(dto).toMatchObject({ dureeMin: null, prixMontant: null, prixDevise: null, paiementMode: null, paiementInstructions: null, description: null, inclus: [] })
    dto.inclus.push('modifié')
    expect(row.inclus).toEqual([])
  })

  it('should narrow the text columns to the closed lists (an unknown stored value never reaches the DTO as is)', async () => {
    const { toServiceStudioResource } = await ressource()

    const dto = toServiceStudioResource(ligne({ type: 'valeur-corrompue', tarif: 'valeur-corrompue', rythme: 'valeur-corrompue', paiementMode: 'valeur-corrompue' }), null)

    expect(['rdv', 'accompagnement', 'atelier', 'devis']).toContain(dto.type)
    expect(['gratuit', 'payant', 'devis']).toContain(dto.tarif)
    expect([null, 'hebdomadaire', 'bimensuel', 'mensuel', 'libre']).toContain(dto.rythme)
    expect([null, 'en_ligne', 'sur_place', 'au_choix']).toContain(dto.paiementMode)
  })
})

describe('toServicesCompteursResource (U17)', () => {
  it('should expose the four counters and nothing else', async () => {
    const { toServicesCompteursResource } = await ressource()

    expect(toServicesCompteursResource({ total: 6, visibles: 5, enVedette: 3, vedetteMax: 3 })).toEqual({ total: 6, visibles: 5, enVedette: 3, vedetteMax: 3 })
  })
})

describe('toServicePublicCarteResource (U17)', () => {
  it('should expose exactly the keys of ServicePublicCarteDTO', async () => {
    const { toServicePublicCarteResource } = await ressource()

    const dto = toServicePublicCarteResource(ligne(), media())

    expect(Object.keys(dto).sort()).toEqual(CLES_CARTE)
  })

  it('should never expose an identifier, the order, the vedette flag, the visibility, the dates or the owner', async () => {
    const { toServicePublicCarteResource } = await ressource()

    const json = JSON.stringify(toServicePublicCarteResource(ligne(), media()))

    for (const secret of [ID_SERVICE, ID_VITRINE, ID_UTILISATEUR, '"ordre"', '"enVedette"', '"actif"', '"creeLe"', '"modifieLe"', '"createdAt"', '"vitrineId"', '"imageMediaId"', '"chemin"', '"paiementMode"', '"paiementInstructions"', '"inclus"']) {
      expect(json).not.toContain(secret)
    }
  })

  it('should carry what a card needs: slug, title, description, type, duration, sessions, price and bookability', async () => {
    const { toServicePublicCarteResource } = await ressource()

    const dto = toServicePublicCarteResource(ligne({ type: 'accompagnement', nbSeances: 6, rythme: 'hebdomadaire', dureeMin: 30, reservable: false }), null)

    expect(dto).toMatchObject({
      slug: 'consultation-de-cardiologie',
      titre: 'Consultation de cardiologie',
      type: 'accompagnement',
      nbSeances: 6,
      rythme: 'hebdomadaire',
      dureeMin: 30,
      tarif: 'payant',
      prixMontant: 15000,
      prixDevise: 'XAF',
      reservable: false,
      image: null,
    })
  })
})

describe('toServicePublicDetailResource (U17)', () => {
  it('should expose exactly the keys of ServicePublicDetailDTO, with seo = { titre, description }', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne(), media(), vitrine(), HORS_LIGNE)

    expect(Object.keys(dto).sort()).toEqual(CLES_DETAIL)
    expect(Object.keys(dto.seo).sort()).toEqual(['description', 'titre'])
  })

  it('should never leak the owner, the vitrine contact details or internal fields (whitelist, no spread)', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const json = JSON.stringify(toServicePublicDetailResource(ligne(), media(), vitrine(), EN_LIGNE))

    for (const secret of [ID_SERVICE, ID_VITRINE, ID_UTILISATEUR, 'prive@exemple.com', '+237600000000', '"ordre"', '"enVedette"', '"actif"', '"vitrineId"', '"createdAt"', '"preavisHeures"', '"chemin"']) {
      expect(json).not.toContain(secret)
    }
  })

  it.each(['en_ligne', 'au_choix'])('should force sur_place when online payment is off and the stored mode is %s', async (paiementMode) => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne({ paiementMode }), null, vitrine(), HORS_LIGNE)

    expect(dto.paiementMode).toBe('sur_place')
  })

  it.each(['en_ligne', 'au_choix', 'sur_place'])('should keep the stored mode %s when online payment is on', async (paiementMode) => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne({ paiementMode }), null, vitrine(), EN_LIGNE)

    expect(dto.paiementMode).toBe(paiementMode)
  })

  it('should keep a null payment mode null (a free service has no payment, whatever the flag)', async () => {
    const { toServicePublicDetailResource } = await ressource()
    const gratuit = ligne({ tarif: 'gratuit', prixMontant: null, prixDevise: null, paiementMode: null, paiementInstructions: null })

    expect(toServicePublicDetailResource(gratuit, null, vitrine(), HORS_LIGNE).paiementMode).toBeNull()
    expect(toServicePublicDetailResource(gratuit, null, vitrine(), EN_LIGNE).paiementMode).toBeNull()
  })

  it('should compose the SEO title as "<titre> — <nomAffiche>"', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne(), null, vitrine(), HORS_LIGNE)

    expect(dto.seo.titre).toBe('Consultation de cardiologie — Dr Cabrel Nguesso')
  })

  it('should leave out the title prefix of the display name when the vitrine has none', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne(), null, vitrine({ titre: null }), HORS_LIGNE)

    expect(dto.seo.titre).toBe('Consultation de cardiologie — Cabrel Nguesso')
  })

  it('should use a short description as is for seo.description', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne({ description: 'Un bilan court.' }), null, vitrine(), HORS_LIGNE)

    expect(dto.seo.description).toBe('Un bilan court.')
  })

  it('should keep a description of exactly 160 characters untouched', async () => {
    const { toServicePublicDetailResource } = await ressource()
    const description = `${'a'.repeat(79)} ${'b'.repeat(80)}`
    expect(description).toHaveLength(160)

    expect(toServicePublicDetailResource(ligne({ description }), null, vitrine(), HORS_LIGNE).seo.description).toBe(description)
  })

  it('should cut a 300-character description to at most 160 characters on a word boundary', async () => {
    const { toServicePublicDetailResource } = await ressource()
    const description = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    expect(description.length).toBeGreaterThan(160)

    const seo = toServicePublicDetailResource(ligne({ description }), null, vitrine(), HORS_LIGNE).seo.description

    expect(seo.length).toBeLessThanOrEqual(160)
    expect(seo.length).toBeGreaterThan(100)
    const coupe = seo.replace(/[\s….]+$/u, '')
    expect(description.startsWith(coupe)).toBe(true)
    expect(description.charAt(coupe.length)).toMatch(/\s/)
  })

  it('should still cut at 160 characters when the description has no space at all', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const seo = toServicePublicDetailResource(ligne({ description: 'a'.repeat(400) }), null, vitrine(), HORS_LIGNE).seo.description

    expect(seo.length).toBeLessThanOrEqual(160)
    expect(seo.length).toBeGreaterThan(0)
  })

  it('should flatten line breaks of the description in seo.description (a meta description is one line)', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const seo = toServicePublicDetailResource(ligne({ description: 'Première ligne.\n\nSeconde ligne.' }), null, vitrine(), HORS_LIGNE).seo.description

    expect(seo).not.toMatch(/[\r\n]/)
  })

  it.each([null, ''])('should fall back to "<titre> avec <nomAffiche>, <metier> à <ville>." when the description is %j', async (description) => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne({ description }), null, vitrine(), HORS_LIGNE)

    expect(dto.seo.description).toBe('Consultation de cardiologie avec Dr Cabrel Nguesso, Cardiologue à Douala.')
  })

  it('should expose the inclus list and the payment instructions on the detail', async () => {
    const { toServicePublicDetailResource } = await ressource()

    const dto = toServicePublicDetailResource(ligne(), null, vitrine(), HORS_LIGNE)

    expect(dto.inclus).toEqual(['Examen clinique', 'Compte rendu'])
    expect(dto.paiementInstructions).toBe('Espèces ou Mobile Money.')
  })
})
