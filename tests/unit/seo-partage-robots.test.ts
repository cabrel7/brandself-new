// S12 (vérification) : image de partage dans les DTO publics et préfixes `Disallow` de robots.txt. Fonctions pures.
import { describe, expect, it } from 'vitest'
import type { medias, realisations, services, vitrines } from '../../shared/db/schema'
import { RESERVED_USERNAMES, isReserved } from '../../shared/reserved'
import {
  OG_IMAGE_HAUTEUR,
  OG_IMAGE_LARGEUR,
  ROBOTS_DISALLOW,
  choisirImagePartage,
  construireGroupesRobots,
  construireImagePartage,
} from '../../shared/seo'
import { PARTAGE_FICHIER, partageUrl } from '../../shared/medias'

const ID_MEDIA = '5e6f7a8b-aaaa-4bbb-8ccc-ddddeeeeffff'
const SITE = 'https://jesuis.pro'

describe('construireImagePartage', () => {
  it('should point to the partage variant of the media, 1200x630, with the given alt', () => {
    expect(construireImagePartage(ID_MEDIA, 'Dr Cabrel')).toEqual({
      url: `/medias/${ID_MEDIA}/${PARTAGE_FICHIER}`,
      largeur: OG_IMAGE_LARGEUR,
      hauteur: OG_IMAGE_HAUTEUR,
      alt: 'Dr Cabrel',
    })
    expect(partageUrl(ID_MEDIA)).toBe(`/medias/${ID_MEDIA}/partage.jpg`)
    expect(OG_IMAGE_LARGEUR).toBe(1200)
    expect(OG_IMAGE_HAUTEUR).toBe(630)
  })

  it('should return null without media so the brand default image stays the fallback', () => {
    expect(construireImagePartage(null, 'x')).toBeNull()
    expect(construireImagePartage(undefined, 'x')).toBeNull()
    expect(construireImagePartage('', 'x')).toBeNull()
    expect(choisirImagePartage(construireImagePartage(null, 'x'), SITE, 'jesuis.pro').url).toBe(`${SITE}/brand/partage.jpg`)
  })

  it('should be made absolute by choisirImagePartage', () => {
    const image = choisirImagePartage(construireImagePartage(ID_MEDIA, 'Alt'), SITE, 'jesuis.pro')
    expect(image.url).toBe(`${SITE}/medias/${ID_MEDIA}/partage.jpg`)
    expect(image.largeur).toBe(1200)
    expect(image.hauteur).toBe(630)
  })
})

describe('DTO publics : seo.image', () => {
  type VitrineRow = typeof vitrines.$inferSelect
  type MediaRow = typeof medias.$inferSelect
  type ServiceRow = typeof services.$inferSelect
  type RealisationRow = typeof realisations.$inferSelect

  const DATE = new Date('2026-11-10T10:00:00.000Z')
  const vitrine: VitrineRow = {
    id: 'v1', userId: 'u1', username: 'dr-cabrel', titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso',
    metier: 'Cardiologue', ville: 'Douala', pays: 'CM', accroche: null, bio: null, photoMediaId: ID_MEDIA,
    emailContact: null, telephone: null, whatsapp: null, palette: 'terracotta', seoTitre: null, seoDescription: null,
    seoIaTitre: null, seoIaDescription: null, seoIaSignature: null, seoIaGenereLe: null,
    sectionsMasquees: [], etapesIgnorees: [], partageeLe: null, fuseau: 'Africa/Douala',
    pasCreneauMin: 30, preavisHeures: 2, horizonJours: 60, publieeLe: DATE, createdAt: DATE, updatedAt: DATE,
  }
  const media: MediaRow = {
    id: ID_MEDIA, userId: 'u1', disk: 'local', chemin: `u1/${ID_MEDIA}`, mime: 'image/webp', taille: 1, largeur: 1600, hauteur: 900, createdAt: DATE,
  }
  const service: ServiceRow & { masqueParPlan: boolean } = {
    masqueParPlan: false, id: 's1', vitrineId: 'v1', slug: 'consultation', titre: 'Consultation', description: 'Un bilan complet.',
    imageMediaId: ID_MEDIA, type: 'rdv', nbSeances: null, rythme: null, dureeMin: 30, tarif: 'gratuit', prixMontant: null,
    prixDevise: null, paiementMode: null, paiementInstructions: null, inclus: [], reservable: true, enVedette: false,
    ordre: 1, actif: true, source: 'utilisateur', createdAt: DATE, updatedAt: DATE,
  }
  const realisation: RealisationRow & { masqueParPlan: boolean } = {
    masqueParPlan: false, id: 'r1', vitrineId: 'v1', slug: 'unite', titre: 'Unité', description: 'Un projet.',
    imageMediaId: ID_MEDIA, annee: 2025, lieu: 'Douala', role: null, lien: null, enVedette: false, ordre: 1,
    actif: true, source: 'utilisateur', createdAt: DATE, updatedAt: DATE,
  }

  it('vitrine : variante partage de la photo, null sans photo', async () => {
    const { toVitrinePublicResource } = await import('../../server/resources/vitrine')
    const avec = toVitrinePublicResource({ vitrine, photo: media }, false)
    expect(avec.seo.image).toEqual({
      url: `/medias/${ID_MEDIA}/partage.jpg`, largeur: 1200, hauteur: 630, alt: 'Dr Cabrel Nguesso',
    })
    expect(toVitrinePublicResource({ vitrine, photo: null }, false).seo.image).toBeNull()
  })

  it('service : variante partage de son image, null sans image', async () => {
    const { toServicePublicDetailResource } = await import('../../server/resources/service')
    const options = { paiementEnLigne: false }
    const avec = toServicePublicDetailResource(service, media, vitrine, options)
    expect(avec.seo.image?.url).toBe(`/medias/${ID_MEDIA}/partage.jpg`)
    expect(avec.seo.image?.alt).toBe('Consultation')
    expect(toServicePublicDetailResource(service, null, vitrine, options).seo.image).toBeNull()
  })

  it('réalisation : variante partage de son image, null sans image', async () => {
    const { toRealisationPublicDetailResource } = await import('../../server/resources/realisation')
    const avec = toRealisationPublicDetailResource(realisation, media, [], vitrine)
    expect(avec.seo.image?.url).toBe(`/medias/${ID_MEDIA}/partage.jpg`)
    expect(avec.seo.image?.alt).toBe('Unité')
    expect(toRealisationPublicDetailResource(realisation, null, [], vitrine).seo.image).toBeNull()
  })
})

/** Interprétation d'une ligne `Disallow` (préfixe, `$` = fin d'URL) comme le fait Google. */
function bloque(regle: string, chemin: string): boolean {
  if (regle.endsWith('$')) return chemin === regle.slice(0, -1)
  return chemin.startsWith(regle)
}

describe('robots : Disallow par préfixe', () => {
  const disallow = construireGroupesRobots('recherche_seulement')[0]?.disallow ?? []
  const bloqueTout = (chemin: string): boolean => disallow.some((regle) => bloque(regle, chemin))

  it.each([
    '/studio-dupont', '/studio-dupont/services', '/onboarding-conseil', '/connexion-pro', '/desabonnement-test',
    '/mcp-conseil', '/apiary', '/api-expert', '/dr-cabrel', '/dr-cabrel/services/consultation',
  ])('should not block the showcase %s', (chemin) => {
    expect(bloqueTout(chemin)).toBe(false)
  })

  it.each([
    '/studio', '/studio/', '/studio/services', '/onboarding', '/onboarding/etape', '/connexion', '/connexion/code',
    '/desabonnement', '/desabonnement/abc', '/mcp', '/mcp/', '/api/auth/session', '/.well-known/oauth-protected-resource',
  ])('should block the technical route %s', (chemin) => {
    expect(bloqueTout(chemin)).toBe(true)
  })

  it('should only target reserved first segments (or /.well-known)', () => {
    for (const regle of ROBOTS_DISALLOW) {
      const segment = regle.replace(/^\//, '').split(/[/$]/)[0] ?? ''
      expect(segment === '.well-known' || isReserved(segment), regle).toBe(true)
    }
    expect(RESERVED_USERNAMES).toContain('studio')
  })
})
