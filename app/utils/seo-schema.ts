// S12 (#154, #155) : graphe schema.org pour les pages publiques. Pures, sans Vue, URL absolues.

export interface SeoNoeudPersonne {
  '@type': 'Person'
  '@id': string
  name: string
  givenName: string
  familyName: string
  honorificPrefix: string | null
  jobTitle: string
  description: string
  image: string | null
  url: string
  address: {
    '@type': 'PostalAddress'
    addressLocality: string
    addressCountry: string
  }
  knowsAbout: string[]
  sameAs: string[]
}

export interface SeoNoeudService {
  '@type': 'Service'
  name: string
  description: string
  serviceType: string
  provider: { '@id': string }
  areaServed: { '@type': 'City', name: string }[]
  offers?: {
    '@type': 'Offer'
    price: number
    priceCurrency: string
  }
}

export interface SeoNoeudRealisation {
  '@type': 'CreativeWork'
  name: string
  creator: { '@id': string }
  dateCreated: string | null
  image: string | null
  locationCreated: string | null
}

export interface SeoNoeudFil {
  '@type': 'BreadcrumbList'
  itemListElement: { '@type': 'ListItem', position: number, name: string, item: string }[]
}

export interface SeoNoeudOrganisation {
  '@type': 'Organization'
  name: string
  url: string
  logo: string | null
}

export interface SeoNoeudWebSite {
  '@type': 'WebSite'
  name: string
  url: string
}

export interface SeoNoeudWebPage {
  '@type': 'WebPage'
  about: { '@id': string }
  url: string
}

/** Titre honorifique extrait du titre (Dr, Pr, Me, M, Mme). */
function extraireHonorifique(titre: string | null): string | null {
  if (!titre) return null
  return ['dr', 'pr', 'me', 'm', 'mme'].includes(titre.toLowerCase()) ? titre : null
}

/** Nom et prénom séparés pour le JSON-LD Person. */
function separerNomPrenom(nomAffiche: string): { givenName: string, familyName: string } {
  const parties = nomAffiche.trim().split(/\s+/)
  const givenName = parties[0] ?? ''
  const familyName = parties.length > 1 ? parties.slice(1).join(' ') : ''
  return { givenName, familyName }
}

export function noeudPersonne(
  vitrine: {
    username: string
    nomAffiche: string
    metier: string
    ville: string | null
    pays: string | null
    accroche: string | null
    titre: string | null
    photo: { url: string } | null
    liens: Array<{ type: string, url: string }>
  },
  servicesVisibles: { titre: string }[],
  siteUrl: string,
): SeoNoeudPersonne {
  const canonique = `${siteUrl}/${vitrine.username}`
  const { givenName, familyName } = separerNomPrenom(vitrine.nomAffiche)
  const liensReseau = vitrine.liens
    .filter((l) => l.type === 'reseau' && l.url.startsWith('https://'))
    .map((l) => l.url)

  return {
    '@type': 'Person',
    '@id': `${canonique}#personne`,
    name: vitrine.nomAffiche,
    givenName,
    familyName,
    honorificPrefix: extraireHonorifique(vitrine.titre),
    jobTitle: vitrine.metier,
    description: vitrine.accroche ?? '',
    image: vitrine.photo?.url ?? null,
    url: canonique,
    address: {
      '@type': 'PostalAddress',
      addressLocality: vitrine.ville ?? '',
      addressCountry: vitrine.pays ?? '',
    },
    knowsAbout: servicesVisibles.map((s) => s.titre).slice(0, 6),
    sameAs: liensReseau,
  }
}

export function noeudService(
  service: {
    titre: string
    description: string
    type: string
    ville: string
    pays: string | null
    prixMontant: number | null
    prixDevise: string | null
    tarif: 'gratuit' | 'payant' | 'devis'
  },
  personneId: string,
): SeoNoeudService {
  const node: SeoNoeudService = {
    '@type': 'Service',
    name: service.titre,
    description: service.description,
    serviceType: service.type,
    provider: { '@id': personneId },
    areaServed: [{ '@type': 'City', name: service.ville }],
  }
  if (service.prixMontant !== null && service.prixDevise !== null && service.tarif === 'payant') {
    node.offers = {
      '@type': 'Offer',
      price: service.prixMontant,
      priceCurrency: service.prixDevise,
    }
  } else if (service.tarif === 'gratuit') {
    node.offers = { '@type': 'Offer', price: 0, priceCurrency: service.prixDevise ?? 'XAF' }
  }
  return node
}

export function noeudRealisation(
  realisation: {
    titre: string
    annee: number | null
    lieu: string | null
    image: { url: string } | null
  },
  personneId: string,
): SeoNoeudRealisation {
  return {
    '@type': 'CreativeWork',
    name: realisation.titre,
    creator: { '@id': personneId },
    dateCreated: realisation.annee ? String(realisation.annee) : null,
    image: realisation.image?.url ?? null,
    locationCreated: realisation.lieu ?? null,
  }
}

export function noeudFil(items: { name: string, item: string }[]): SeoNoeudFil {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  }
}

export function noeudOrganisation(siteUrl: string, logo: string | null): SeoNoeudOrganisation {
  return {
    '@type': 'Organization',
    name: 'Brandself',
    url: siteUrl,
    logo,
  }
}

export function noeudWebSite(siteUrl: string): SeoNoeudWebSite {
  return { '@type': 'WebSite', name: 'Brandself', url: siteUrl }
}

export function noeudWebPage(personneId: string, url: string): SeoNoeudWebPage {
  return { '@type': 'WebPage', about: { '@id': personneId }, url }
}
