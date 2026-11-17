// S12 : métadonnées d'une page de vitrine (pur) : canonique par chemin, og:image absolue, titres et descriptions par page.
import { describe, expect, it } from 'vitest'
import { construireMetasPage } from '../../app/utils/seo-page'
import type { ParamsMetasPage, VitrineSeoSource } from '../../app/utils/seo-page'
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN } from '../../shared/seo'

const vitrine: VitrineSeoSource = {
  username: 'dr-cabrel',
  nomAffiche: 'Dr Cabrel Nguesso',
  prenom: 'Cabrel',
  nom: 'Nguesso',
  titre: 'dr',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  pays: 'CM',
  paysLibelle: 'Cameroun',
  accroche: 'Cardiologue interventionnel à Douala, rendez-vous en ligne.',
  photo: { url: '/medias/abc/1600.webp' },
  seo: {
    titre: 'Dr Cabrel Nguesso — Cardiologue interventionnel à Douala',
    description: 'Cardiologue interventionnel à Douala, rendez-vous en ligne.',
    image: null,
  },
}

function metas(patch: Partial<ParamsMetasPage> & Pick<ParamsMetasPage, 'page' | 'chemin'>) {
  return construireMetasPage({ siteUrl: 'https://jesuis.pro', vitrine, ...patch })
}

describe('construireMetasPage', () => {
  it.each([
    ['accueil', '/dr-cabrel'],
    ['services', '/dr-cabrel/services'],
    ['service', '/dr-cabrel/services/consultation'],
    ['realisations', '/dr-cabrel/realisations'],
    ['realisation', '/dr-cabrel/realisations/projet'],
    ['contact', '/dr-cabrel/contact'],
    ['agenda', '/dr-cabrel/agenda'],
    ['lien-bio', '/@dr-cabrel'],
  ] as const)('%s : canonique absolue construite depuis le chemin réel', (page, chemin) => {
    expect(metas({ page, chemin }).canonique).toBe(`https://jesuis.pro${chemin}`)
  })

  it('canonique : minuscules, sans barre finale ni query, site avec barre finale toléré', () => {
    const m = metas({ page: 'services', chemin: '/Dr-Cabrel/Services/?utm_source=wa', siteUrl: 'https://jesuis.pro/' })
    expect(m.canonique).toBe('https://jesuis.pro/dr-cabrel/services')
  })

  it('og:image : image par défaut rendue absolue quand le DTO n’a pas de variante de partage', () => {
    const m = metas({ page: 'accueil', chemin: '/dr-cabrel' })
    expect(m.image).toEqual({ url: 'https://jesuis.pro/brand/partage.jpg', largeur: 1200, hauteur: 630, alt: 'jesuis.pro' })
  })

  it('og:image : jamais la photo d’origine, même quand la vitrine en a une', () => {
    expect(metas({ page: 'accueil', chemin: '/dr-cabrel' }).image.url).not.toContain('/medias/')
  })

  it('og:image : variante de partage de l’élément, sinon de la vitrine', () => {
    const element = { url: '/medias/u/e/partage.jpg', largeur: 1200 as const, hauteur: 630 as const, alt: 'Service' }
    const deVitrine = { ...element, url: '/medias/u/v/partage.jpg' }
    const avecVitrine = { ...vitrine, seo: { ...vitrine.seo, image: deVitrine } }
    expect(metas({ page: 'service', chemin: '/x/services/y', image: element, vitrine: avecVitrine }).image.url)
      .toBe('https://jesuis.pro/medias/u/e/partage.jpg')
    expect(metas({ page: 'services', chemin: '/x/services', vitrine: avecVitrine }).image.url)
      .toBe('https://jesuis.pro/medias/u/v/partage.jpg')
  })

  it('og:type profile sur l’accueil seulement', () => {
    expect(metas({ page: 'accueil', chemin: '/dr-cabrel' }).ogType).toBe('profile')
    expect(metas({ page: 'services', chemin: '/dr-cabrel/services' }).ogType).toBe('website')
  })

  it('robots : indexable = null ; agenda, contact, lien bio = noindex, follow', () => {
    expect(metas({ page: 'accueil', chemin: '/dr-cabrel' }).robots).toBeNull()
    expect(metas({ page: 'lien-bio', chemin: '/@dr-cabrel' }).robots).toBe('noindex, follow')
    expect(metas({ page: 'contact', chemin: '/dr-cabrel/contact' }).robots).toBe('noindex, follow')
  })

  it('titres par page (#143), sans suffixe de marque', () => {
    expect(metas({ page: 'accueil', chemin: '/dr-cabrel' }).titre).toBe('Dr Cabrel Nguesso — Cardiologue interventionnel à Douala')
    expect(metas({ page: 'services', chemin: '/dr-cabrel/services' }).titre).toBe('Services — Dr Cabrel Nguesso, Cardiologue interventionnel à Douala')
    expect(metas({ page: 'lien-bio', chemin: '/@dr-cabrel' }).titre).toBe('Dr Cabrel Nguesso — liens')
    const service = { titre: 'Consultation de cardiologie', description: null, type: 'rdv', tarif: 'devis', prixMontant: null, prixDevise: null } as const
    expect(metas({ page: 'service', chemin: '/dr-cabrel/services/c', service }).titre).toBe('Consultation de cardiologie — Dr Cabrel Nguesso — Douala')
    const realisation = { titre: 'Unité de cathétérisme', description: null, annee: null, lieu: null, image: null }
    expect(metas({ page: 'realisation', chemin: '/dr-cabrel/realisations/u', realisation }).titre).toBe('Unité de cathétérisme — Dr Cabrel Nguesso')
  })

  it('la description saisie au Profil (celle du DTO) ne s’applique qu’à l’accueil', () => {
    const saisie = { ...vitrine, seo: { ...vitrine.seo, description: 'Ma description sur mesure pour Google, rédigée à la main.' } }
    expect(metas({ page: 'accueil', chemin: '/dr-cabrel', vitrine: saisie }).description).toBe(saisie.seo.description)
    for (const [page, chemin] of [['services', '/dr-cabrel/services'], ['contact', '/dr-cabrel/contact'], ['lien-bio', '/@dr-cabrel']] as const) {
      expect(metas({ page, chemin, vitrine: saisie }).description).not.toBe(saisie.seo.description)
    }
  })

  it('descriptions de toutes les pages : entre 50 et 160 caractères, toutes différentes de celle de l’accueil', () => {
    const accueil = metas({ page: 'accueil', chemin: '/dr-cabrel' }).description
    for (const [page, chemin] of [
      ['services', '/dr-cabrel/services'],
      ['realisations', '/dr-cabrel/realisations'],
      ['agenda', '/dr-cabrel/agenda'],
      ['contact', '/dr-cabrel/contact'],
      ['lien-bio', '/@dr-cabrel'],
    ] as const) {
      const { description } = metas({ page, chemin, servicesVisibles: [{ titre: 'Consultation' }], titresRealisations: ['Projet'] })
      expect(description.length).toBeGreaterThanOrEqual(SEO_DESCRIPTION_MIN)
      expect(description.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
      expect(description).not.toBe(accueil)
    }
  })
})
