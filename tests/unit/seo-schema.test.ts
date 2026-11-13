// S12 : tests unitaires du graphe schema.org (pur, sans Vue).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  construireGrapheVitrine,
  idPersonne,
  nettoyerJsonLd,
  noeudFil,
  noeudPersonne,
  noeudRealisation,
  noeudService,
  noeudWebPage,
} from '../../app/utils/seo-schema'
import type { SchemaServiceSource, SchemaVitrineSource } from '../../app/utils/seo-schema'

const SITE = 'https://jesuis.pro'
const PERSONNE_ID = 'https://jesuis.pro/dr-cabrel#personne'

function valeursVides(node: unknown, chemin = '$'): string[] {
  if (node === null || node === undefined || node === '') return [chemin]
  if (Array.isArray(node)) {
    return node.length === 0 ? [chemin] : node.flatMap((v, i) => valeursVides(v, `${chemin}[${i}]`))
  }
  if (typeof node === 'object') {
    return Object.entries(node).flatMap(([cle, valeur]) => valeursVides(valeur, `${chemin}.${cle}`))
  }
  return []
}

function urlsNonAbsolues(node: unknown, chemin = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => urlsNonAbsolues(v, `${chemin}[${i}]`))
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([cle, valeur]) => {
    const cible = `${chemin}.${cle}`
    if (['@id', 'url', 'item', 'image'].includes(cle) && typeof valeur === 'string') {
      return /^https?:\/\//.test(valeur) ? [] : [cible]
    }
    return urlsNonAbsolues(valeur, cible)
  })
}

const vitrine: SchemaVitrineSource = {
  username: 'dr-cabrel',
  nomAffiche: 'Dr Cabrel Nguesso',
  prenom: 'Cabrel',
  nom: 'Nguesso',
  titre: 'dr',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  pays: 'CM',
  accroche: 'Cardiologue à votre écoute.',
  photo: { url: '/medias/abc/1600.webp' },
}

describe('noeudPersonne (#154, CA10)', () => {
  const liens = [
    { type: 'reseau', url: 'https://linkedin.com/in/dr-cabrel' },
    { type: 'reseau', url: 'http://exemple.com' },
    { type: 'libre', url: 'https://site.com' },
  ]
  const services = [{ titre: 'Consultation' }, { titre: 'Bilan' }]

  it('type Person et @id absolu stable', () => {
    const node = noeudPersonne(vitrine, services, liens, SITE)
    expect(node['@type']).toBe('Person')
    expect(node['@id']).toBe(PERSONNE_ID)
    expect(node.url).toBe('https://jesuis.pro/dr-cabrel')
  })

  it('idPersonne : tolère la barre finale du site et la casse du username', () => {
    expect(idPersonne('https://jesuis.pro/', 'Dr-Cabrel')).toBe(PERSONNE_ID)
    expect(idPersonne('https://jesuis.pro', 'dr-cabrel')).toBe(PERSONNE_ID)
  })

  it('givenName/familyName viennent de prenom/nom, honorificPrefix a la bonne casse', () => {
    const node = noeudPersonne(vitrine, services, liens, SITE)
    expect(node.givenName).toBe('Cabrel')
    expect(node.familyName).toBe('Nguesso')
    expect(node.name).toBe('Dr Cabrel Nguesso')
    expect(node.honorificPrefix).toBe('Dr')
  })

  it('jobTitle, adresse, image absolue', () => {
    const node = noeudPersonne(vitrine, services, liens, SITE)
    expect(node.jobTitle).toBe('Cardiologue interventionnel')
    expect(node.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Douala', addressCountry: 'CM' })
    expect(node.image).toBe('https://jesuis.pro/medias/abc/1600.webp')
  })

  it('knowsAbout limité à 6 titres', () => {
    const beaucoup = Array.from({ length: 9 }, (_, i) => ({ titre: `Service ${i}` }))
    expect(noeudPersonne(vitrine, beaucoup, [], SITE).knowsAbout).toHaveLength(6)
  })

  it('sameAs : seulement les liens reseau en https', () => {
    expect(noeudPersonne(vitrine, services, liens, SITE).sameAs).toEqual(['https://linkedin.com/in/dr-cabrel'])
  })

  it('ni email ni téléphone', () => {
    const node: Record<string, unknown> = { ...noeudPersonne(vitrine, services, liens, SITE) }
    expect(node.email).toBeUndefined()
    expect(node.telephone).toBeUndefined()
  })

  it('sans titre, ville, pays, photo, services ni liens : aucune clé vide', () => {
    const nu = { ...vitrine, titre: null, ville: null, pays: null, photo: null, accroche: null }
    const node = noeudPersonne(nu, [], [], SITE)
    expect(valeursVides(node)).toEqual([])
    expect(node).not.toHaveProperty('address')
    expect(node).not.toHaveProperty('honorificPrefix')
    expect(node).not.toHaveProperty('knowsAbout')
    expect(node).not.toHaveProperty('sameAs')
  })
})

describe('noeudService (#155, CA11)', () => {
  const urlPage = 'https://jesuis.pro/dr-cabrel/services/consultation'
  const source = (patch: Partial<SchemaServiceSource>): SchemaServiceSource => ({
    titre: 'Consultation',
    description: 'Une consultation cardiaque.',
    type: 'rdv',
    tarif: 'payant',
    prixMontant: 25000,
    prixDevise: 'XAF',
    ...patch,
  })

  it('payant XAF : prix en unités majeures, provider = @id de la personne, areaServed ville + pays', () => {
    const node = noeudService(source({}), vitrine, PERSONNE_ID, urlPage)
    expect(node['@type']).toBe('Service')
    expect(node.offers).toEqual({ '@type': 'Offer', price: 25000, priceCurrency: 'XAF' })
    expect(node.provider['@id']).toBe(PERSONNE_ID)
    expect(node.areaServed).toEqual([{ '@type': 'City', name: 'Douala' }, { '@type': 'Country', name: 'CM' }])
    expect(node.serviceType).toBe('Rendez-vous ponctuel')
  })

  it('payant EUR : 4500 centimes = 45', () => {
    const node = noeudService(source({ prixMontant: 4500, prixDevise: 'EUR' }), vitrine, PERSONNE_ID, urlPage)
    expect(node.offers).toEqual({ '@type': 'Offer', price: 45, priceCurrency: 'EUR' })
  })

  it('gratuit : price 0', () => {
    const node = noeudService(source({ tarif: 'gratuit', prixMontant: null, prixDevise: null }), vitrine, PERSONNE_ID, urlPage)
    expect(node.offers?.price).toBe(0)
  })

  it('devis : aucune clé offers', () => {
    const node = noeudService(source({ tarif: 'devis', type: 'devis', prixMontant: null, prixDevise: null }), vitrine, PERSONNE_ID, urlPage)
    expect(node).not.toHaveProperty('offers')
  })

  it('description absente : clé omise, aucune valeur vide', () => {
    const node = noeudService(source({ description: null }), { ville: null, pays: null }, PERSONNE_ID, urlPage)
    expect(node).not.toHaveProperty('description')
    expect(node).not.toHaveProperty('areaServed')
    expect(valeursVides(node)).toEqual([])
  })
})

describe('noeudRealisation (#155)', () => {
  const urlPage = 'https://jesuis.pro/dr-cabrel/realisations/projet'

  it('CreativeWork : créateur par @id, image absolue, lieu en Place', () => {
    const node = noeudRealisation(
      { titre: 'Mon projet', description: 'Un projet.', annee: 2025, lieu: 'Douala', image: { url: '/medias/r/1600.webp' } },
      PERSONNE_ID, urlPage, SITE,
    )
    expect(node['@type']).toBe('CreativeWork')
    expect(node.creator['@id']).toBe(PERSONNE_ID)
    expect(node.dateCreated).toBe('2025')
    expect(node.locationCreated).toEqual({ '@type': 'Place', name: 'Douala' })
    expect(node.image).toBe('https://jesuis.pro/medias/r/1600.webp')
  })

  it('sans année, lieu ni image : clés omises', () => {
    const node = noeudRealisation({ titre: 'Projet', description: null, annee: null, lieu: null, image: null }, PERSONNE_ID, urlPage, SITE)
    expect(valeursVides(node)).toEqual([])
    expect(node).not.toHaveProperty('dateCreated')
    expect(node).not.toHaveProperty('image')
    expect(node).not.toHaveProperty('locationCreated')
  })
})

describe('noeudFil et noeudWebPage', () => {
  it('BreadcrumbList : positions, items rendus absolus', () => {
    const node = noeudFil(
      [{ name: 'Accueil', item: '/dr-cabrel' }, { name: 'Services', item: 'https://jesuis.pro/dr-cabrel/services' }],
      SITE, 'https://jesuis.pro/dr-cabrel/services',
    )
    expect(node.itemListElement.map((e) => e.position)).toEqual([1, 2])
    expect(node.itemListElement.map((e) => e.item)).toEqual(['https://jesuis.pro/dr-cabrel', 'https://jesuis.pro/dr-cabrel/services'])
    expect(node['@id']).toBe('https://jesuis.pro/dr-cabrel/services#breadcrumb')
  })

  it('WebPage : @id {page}#webpage (fusionne avec celui du module), about = personne', () => {
    const node = noeudWebPage('https://jesuis.pro/dr-cabrel/contact', PERSONNE_ID)
    expect(node['@id']).toBe('https://jesuis.pro/dr-cabrel/contact#webpage')
    expect(node.about['@id']).toBe(PERSONNE_ID)
  })
})

describe('nettoyerJsonLd', () => {
  it('retire récursivement null, undefined, chaînes vides, tableaux et objets vides ; garde 0 et false', () => {
    const propre = nettoyerJsonLd({
      '@type': 'Thing',
      a: '', b: null, c: undefined, d: [], e: ['', 'x'], f: 0, g: false,
      h: { '@type': 'Sub', vide: '' },
      i: { '@id': 'https://x.test/#i' },
    })
    expect(propre).toEqual({ '@type': 'Thing', e: ['x'], f: 0, g: false, i: { '@id': 'https://x.test/#i' } })
  })
})

describe('construireGrapheVitrine (CA13 côté pur)', () => {
  const base = { siteUrl: SITE, vitrine, servicesVisibles: [{ titre: 'Consultation' }] }
  const service: SchemaServiceSource = {
    titre: 'Consultation', description: 'Une consultation.', type: 'rdv', tarif: 'payant', prixMontant: 25000, prixDevise: 'XAF',
  }

  function types(noeuds: { '@type': string }[]): string[] {
    return noeuds.map((n) => n['@type'])
  }

  it('accueil : Person + WebPage, pas de fil', () => {
    const graphe = construireGrapheVitrine({ ...base, page: 'accueil', urlPage: 'https://jesuis.pro/dr-cabrel' })
    expect(types(graphe)).toEqual(['Person', 'WebPage'])
  })

  it('liste des services : fil à 2 éléments', () => {
    const graphe = construireGrapheVitrine({ ...base, page: 'services', urlPage: 'https://jesuis.pro/dr-cabrel/services' })
    const fil = graphe.find((n) => n['@type'] === 'BreadcrumbList')
    expect(fil && 'itemListElement' in fil ? fil.itemListElement : []).toHaveLength(2)
  })

  it('détail d’un service : Service rattaché au même @id que la personne, fil à 3 éléments, un seul WebPage', () => {
    const graphe = construireGrapheVitrine({
      ...base, page: 'service', service, urlPage: 'https://jesuis.pro/dr-cabrel/services/consultation',
    })
    expect(types(graphe)).toEqual(['Person', 'Service', 'BreadcrumbList', 'WebPage'])
    const ids = graphe.map((n) => n['@id'])
    const noeudSvc = graphe.find((n) => n['@type'] === 'Service')
    expect(noeudSvc && 'provider' in noeudSvc ? noeudSvc.provider['@id'] : null).toBe(PERSONNE_ID)
    expect(ids).toContain(PERSONNE_ID)
    const fil = graphe.find((n) => n['@type'] === 'BreadcrumbList')
    expect(fil && 'itemListElement' in fil ? fil.itemListElement : []).toHaveLength(3)
  })

  it('détail d’une réalisation : CreativeWork.creator résolu', () => {
    const graphe = construireGrapheVitrine({
      ...base,
      page: 'realisation',
      realisation: { titre: 'Projet', description: null, annee: 2024, lieu: null, image: null },
      urlPage: 'https://jesuis.pro/dr-cabrel/realisations/projet',
    })
    expect(types(graphe)).toEqual(['Person', 'CreativeWork', 'BreadcrumbList', 'WebPage'])
    const oeuvre = graphe.find((n) => n['@type'] === 'CreativeWork')
    expect(oeuvre && 'creator' in oeuvre ? oeuvre.creator['@id'] : null).toBe(PERSONNE_ID)
  })

  it('toutes les URL et @id sont absolus, aucune valeur vide, sur toutes les pages', () => {
    for (const page of ['accueil', 'services', 'realisations', 'agenda', 'contact', 'lien-bio'] as const) {
      const graphe = construireGrapheVitrine({ ...base, page, urlPage: `https://jesuis.pro/dr-cabrel/${page}` })
      expect(urlsNonAbsolues(graphe)).toEqual([])
      expect(valeursVides(graphe)).toEqual([])
    }
  })
})

describe('aucun Review / AggregateRating / ProfessionalService (CA12)', () => {
  it('le code du graphe ne les produit pas', () => {
    const source = readFileSync(new URL('../../app/utils/seo-schema.ts', import.meta.url), 'utf8')
    for (const interdit of ['Review', 'AggregateRating', 'ProfessionalService']) {
      expect(source).not.toContain(`'${interdit}'`)
    }
  })
})
