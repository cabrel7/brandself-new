// S12 : tests unitaires du schéma schema.org (pure, sans Vue).
import { describe, expect, it } from 'vitest'
import {
  noeudPersonne,
  noeudService,
  noeudRealisation,
  noeudFil,
  noeudOrganisation,
  noeudWebSite,
  noeudWebPage,
} from '../../app/utils/seo-schema'

function parcoursSansValeurVide(node: unknown): void {
  if (node === null || node === undefined) throw new Error('valeur null/undefined interdite')
  if (typeof node === 'object') {
    for (const valeur of Object.values(node)) {
      if (valeur === undefined || valeur === null || valeur === '') {
        throw new Error(`valeur interdite : ${String(valeur)}`)
      }
      if (typeof valeur === 'object') parcoursSansValeurVide(valeur)
    }
  }
}

describe('noeudPersonne (#154)', () => {
  const vitrine = {
    username: 'dr-cabrel',
    nomAffiche: 'Dr Cabrel Nguesso',
    metier: 'Cardiologue interventionnel',
    ville: 'Douala',
    pays: 'CM',
    accroche: 'Cardiologue à votre écoute.',
    titre: 'Dr',
    photo: { url: 'https://brandself.io/medias/photo.webp' },
    liens: [
      { type: 'reseau', url: 'https://linkedin.com/in/dr-cabrel' },
      { type: 'reseau', url: 'http://exemple.com' },
      { type: 'libre', url: 'https://site.com' },
    ],
  }
  const services = [{ titre: 'Consultation' }, { titre: 'Bilan' }]
  const siteUrl = 'https://brandself.io'

  it('type Person et @id absolu', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(node['@type']).toBe('Person')
    expect(node['@id']).toBe('https://brandself.io/dr-cabrel#personne')
  })

  it('honorificPrefix, jobTitle, adresse', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(node.honorificPrefix).toBe('Dr')
    expect(node.jobTitle).toBe('Cardiologue interventionnel')
    expect(node.address.addressLocality).toBe('Douala')
    expect(node.address.addressCountry).toBe('CM')
  })

  it('knowsAbout limité à 6', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(node.knowsAbout).toEqual(['Consultation', 'Bilan'])
    expect(node.knowsAbout.length).toBeLessThanOrEqual(6)
  })

  it('sameAs uniquement https et type reseau', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(node.sameAs).toEqual(['https://linkedin.com/in/dr-cabrel'])
  })

  it('pas d\'email ni de téléphone', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(node.email).toBeUndefined()
    expect(node.telephone).toBeUndefined()
  })

  it('pas de valeur vide ou undefined', () => {
    const node = noeudPersonne(vitrine, services, siteUrl)
    expect(() => parcoursSansValeurVide(node)).not.toThrow()
  })
})

describe('noeudService (#155)', () => {
  const personneId = 'https://brandself.io/dr-cabrel#personne'

  it('service payant avec offre', () => {
    const node = noeudService(
      {
        titre: 'Consultation',
        description: 'Une consultation cardiaque.',
        type: 'rdv',
        ville: 'Douala',
        pays: 'CM',
        prixMontant: 25000,
        prixDevise: 'XAF',
        tarif: 'payant',
      },
      personneId,
    )
    expect(node['@type']).toBe('Service')
    expect(node.offers).toEqual({ '@type': 'Offer', price: 25000, priceCurrency: 'XAF' })
    expect(node.provider['@id']).toBe(personneId)
    expect(node.areaServed).toEqual([{ '@type': 'City', name: 'Douala' }])
  })

  it('service gratuit : price 0', () => {
    const node = noeudService(
      {
        titre: 'Accueil',
        description: 'Accueil.',
        type: 'rdv',
        ville: 'Douala',
        pays: 'CM',
        prixMontant: null,
        prixDevise: null,
        tarif: 'gratuit',
      },
      personneId,
    )
    expect(node.offers).toEqual({ '@type': 'Offer', price: 0, priceCurrency: 'XAF' })
  })

  it('service devis : pas de clé offers', () => {
    const node = noeudService(
      {
        titre: 'Devis',
        description: 'Devis.',
        type: 'devis',
        ville: 'Douala',
        pays: 'CM',
        prixMontant: null,
        prixDevise: null,
        tarif: 'devis',
      },
      personneId,
    )
    expect(node.offers).toBeUndefined()
  })

  it('pas de valeur vide', () => {
    const node = noeudService(
      {
        titre: 'Consultation',
        description: 'Une consultation.',
        type: 'rdv',
        ville: 'Douala',
        pays: 'CM',
        prixMontant: 10000,
        prixDevise: 'XAF',
        tarif: 'payant',
      },
      personneId,
    )
    expect(() => parcoursSansValeurVide(node)).not.toThrow()
  })
})

describe('noeudRealisation (#155)', () => {
  const personneId = 'https://brandself.io/dr-cabrel#personne'

  it('CreativeWork avec créateur et image', () => {
    const node = noeudRealisation(
      {
        titre: 'Mon projet',
        annee: 2025,
        lieu: 'Douala',
        image: { url: 'https://brandself.io/medias/realisation.webp' },
      },
      personneId,
    )
    expect(node['@type']).toBe('CreativeWork')
    expect(node.creator['@id']).toBe(personneId)
    expect(node.dateCreated).toBe('2025')
    expect(node.locationCreated).toBe('Douala')
    expect(node.image).toBe('https://brandself.io/medias/realisation.webp')
  })

  it('sans année ni lieu', () => {
    const node = noeudRealisation(
      { titre: 'Projet', annee: null, lieu: null, image: null },
      personneId,
    )
    expect(node.dateCreated).toBeNull()
    expect(node.locationCreated).toBeNull()
    expect(node.image).toBeNull()
  })
})

describe('noeudFil (#155)', () => {
  it('BreadcrumbList avec positions', () => {
    const node = noeudFil([
      { name: 'Accueil', item: 'https://brandself.io/' },
      { name: 'Services', item: 'https://brandself.io/dr-cabrel/services' },
    ])
    expect(node['@type']).toBe('BreadcrumbList')
    expect(node.itemListElement).toHaveLength(2)
    expect(node.itemListElement[0].position).toBe(1)
    expect(node.itemListElement[0].name).toBe('Accueil')
    expect(node.itemListElement[1].position).toBe(2)
    expect(node.itemListElement[1].name).toBe('Services')
  })
})

describe('noeudOrganisation et WebSite (#155)', () => {
  const siteUrl = 'https://brandself.io'

  it('Organisation', () => {
    const node = noeudOrganisation(siteUrl, '/og/brandself-logo.png')
    expect(node['@type']).toBe('Organization')
    expect(node.name).toBe('Brandself')
    expect(node.url).toBe(siteUrl)
    expect(node.logo).toBe('/og/brandself-logo.png')
  })

  it('Organisation sans logo', () => {
    const node = noeudOrganisation(siteUrl, null)
    expect(node.logo).toBeNull()
  })

  it('WebSite', () => {
    const node = noeudWebSite(siteUrl)
    expect(node['@type']).toBe('WebSite')
    expect(node.name).toBe('Brandself')
    expect(node.url).toBe(siteUrl)
  })
})

describe('noeudWebPage', () => {
  it('WebPage avec about personne', () => {
    const node = noeudWebPage('https://brandself.io/dr-cabrel#personne', 'https://brandself.io/dr-cabrel')
    expect(node['@type']).toBe('WebPage')
    expect(node.about['@id']).toBe('https://brandself.io/dr-cabrel#personne')
    expect(node.url).toBe('https://brandself.io/dr-cabrel')
  })
})
