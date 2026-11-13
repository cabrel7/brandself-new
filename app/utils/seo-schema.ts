// S12 (#154, #155) : graphe schema.org des pages publiques d'une vitrine. Fonctions pures, sans Vue.
// Toutes les URL et tous les `@id` sont ABSOLUS (siteUrl + chemin). Aucune valeur vide : `nettoyerJsonLd`.
// Ni email ni téléphone (déjà visibles en HTML, pas poussés aux agrégateurs) ; aucun Review / AggregateRating (#156).
// L'Organization et le WebSite du site viennent de `schemaOrg.identity` (nuxt.config.ts), pas d'ici.

import type { Devise } from '#shared/compte'
import { toMajorUnits } from '#shared/devises'
import { SCHEMA_KNOWS_ABOUT_MAX, normaliserChemin, urlAbsolue } from '#shared/seo'
import type { PageVitrine } from '#shared/seo'
import { SERVICE_TYPE_LIBELLES } from '#shared/services'
import type { ServiceType, Tarif } from '#shared/services'
import { TITRE_LABELS } from '#shared/vitrine'
import type { Titre } from '#shared/vitrine'

/** Devise de l'offre d'un service gratuit sans devise renseignée. */
const DEVISE_OFFRE_GRATUITE: Devise = 'XAF'
const TYPE_LIEN_RESEAU = 'reseau'
const PREFIXE_HTTPS = 'https://'
const LIBELLE_FIL_ACCUEIL = 'Accueil'
const LIBELLE_FIL_SERVICES = 'Services'
const LIBELLE_FIL_REALISATIONS = 'Réalisations'

export interface SeoReference {
  '@id': string
}

export interface SeoNoeudPersonne {
  '@type': 'Person'
  '@id': string
  name: string
  givenName?: string
  familyName?: string
  honorificPrefix?: string
  jobTitle?: string
  description?: string
  image?: string
  url: string
  address?: {
    '@type': 'PostalAddress'
    addressLocality?: string
    addressCountry?: string
  }
  knowsAbout?: string[]
  sameAs?: string[]
}

export interface SeoNoeudService {
  '@type': 'Service'
  '@id': string
  name: string
  description?: string
  serviceType?: string
  url: string
  provider: SeoReference
  areaServed?: ({ '@type': 'City', name: string } | { '@type': 'Country', name: string })[]
  offers?: {
    '@type': 'Offer'
    price: number
    priceCurrency: string
  }
}

export interface SeoNoeudRealisation {
  '@type': 'CreativeWork'
  '@id': string
  name: string
  description?: string
  url: string
  creator: SeoReference
  dateCreated?: string
  image?: string
  locationCreated?: { '@type': 'Place', name: string }
}

export interface SeoNoeudFil {
  '@type': 'BreadcrumbList'
  '@id': string
  itemListElement: { '@type': 'ListItem', position: number, name: string, item: string }[]
}

export interface SeoNoeudWebPage {
  '@type': 'WebPage'
  '@id': string
  about: SeoReference
}

export type SeoNoeud = SeoNoeudPersonne | SeoNoeudService | SeoNoeudRealisation | SeoNoeudFil | SeoNoeudWebPage

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------

function purger(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return undefined
  if (typeof valeur === 'string') return valeur.trim() === '' ? undefined : valeur
  if (Array.isArray(valeur)) {
    const liste = valeur.map(purger).filter((element) => element !== undefined)
    return liste.length === 0 ? undefined : liste
  }
  if (typeof valeur === 'object') {
    const entrees = Object.entries(valeur)
      .map(([cle, enfant]) => [cle, purger(enfant)] as const)
      .filter(([, enfant]) => enfant !== undefined)
    // Un objet réduit à son `@type` ne dit plus rien (ex. adresse sans ville ni pays) : supprimé.
    if (entrees.every(([cle]) => cle === '@type')) return undefined
    return Object.fromEntries(entrees)
  }
  return valeur
}

/** Retire récursivement `undefined`, `null`, `''`, tableaux vides et objets vides (`0` et `false` sont conservés). */
export function nettoyerJsonLd<T extends object>(noeud: T): T {
  // `purger` ne renvoie `undefined` que pour un objet vide, impossible ici : un nœud porte toujours `@type` et `@id`/`name`.
  return (purger(noeud) ?? {}) as T
}

// ---------------------------------------------------------------------------
// Identifiants et URL
// ---------------------------------------------------------------------------

/** Chemin de la vitrine : `/{username}` en minuscules. */
function cheminVitrine(username: string): string {
  return normaliserChemin(`/${username}`)
}

/** URL absolue de l'accueil de la vitrine. */
export function urlVitrine(siteUrl: string, username: string): string {
  return urlAbsolue(siteUrl, cheminVitrine(username))
}

/** `@id` de la personne : identique sur toutes les pages de la vitrine, donc résolu par `provider` / `creator` / `about`. */
export function idPersonne(siteUrl: string, username: string): string {
  return `${urlVitrine(siteUrl, username)}#personne`
}

// ---------------------------------------------------------------------------
// Nœuds
// ---------------------------------------------------------------------------

export interface SchemaVitrineSource {
  username: string
  nomAffiche: string
  prenom: string
  nom: string
  titre: Titre | null
  metier: string
  ville: string | null
  pays: string | null
  accroche: string | null
  photo: { url: string } | null
}

export interface SchemaLienSource {
  type: string
  url: string
}

export function noeudPersonne(
  vitrine: SchemaVitrineSource,
  servicesVisibles: readonly { titre: string }[],
  liens: readonly SchemaLienSource[],
  siteUrl: string,
): SeoNoeudPersonne {
  return nettoyerJsonLd<SeoNoeudPersonne>({
    '@type': 'Person',
    '@id': idPersonne(siteUrl, vitrine.username),
    name: vitrine.nomAffiche,
    givenName: vitrine.prenom,
    familyName: vitrine.nom,
    honorificPrefix: vitrine.titre ? TITRE_LABELS[vitrine.titre] : undefined,
    jobTitle: vitrine.metier,
    description: vitrine.accroche ?? undefined,
    image: vitrine.photo ? urlAbsolue(siteUrl, vitrine.photo.url) : undefined,
    url: urlVitrine(siteUrl, vitrine.username),
    address: {
      '@type': 'PostalAddress',
      addressLocality: vitrine.ville ?? undefined,
      addressCountry: vitrine.pays ?? undefined,
    },
    knowsAbout: servicesVisibles.map((service) => service.titre).slice(0, SCHEMA_KNOWS_ABOUT_MAX),
    sameAs: liens
      .filter((lien) => lien.type === TYPE_LIEN_RESEAU && lien.url.startsWith(PREFIXE_HTTPS))
      .map((lien) => lien.url),
  })
}

export interface SchemaServiceSource {
  titre: string
  description: string | null
  type: ServiceType
  tarif: Tarif
  /** Unité mineure de la devise. */
  prixMontant: number | null
  prixDevise: Devise | null
}

function offreDuService(service: SchemaServiceSource): SeoNoeudService['offers'] {
  if (service.tarif === 'gratuit') {
    return { '@type': 'Offer', price: 0, priceCurrency: service.prixDevise ?? DEVISE_OFFRE_GRATUITE }
  }
  if (service.tarif === 'payant' && service.prixMontant !== null && service.prixDevise !== null) {
    return {
      '@type': 'Offer',
      price: Number(toMajorUnits(service.prixMontant, service.prixDevise)),
      priceCurrency: service.prixDevise,
    }
  }
  return undefined
}

/** `urlPage` : URL absolue de la page du service ; `personneId` : `@id` du nœud Person (`idPersonne`). */
export function noeudService(
  service: SchemaServiceSource,
  vitrine: Pick<SchemaVitrineSource, 'ville' | 'pays'>,
  personneId: string,
  urlPage: string,
): SeoNoeudService {
  return nettoyerJsonLd<SeoNoeudService>({
    '@type': 'Service',
    '@id': `${urlPage}#service`,
    name: service.titre,
    description: service.description ?? undefined,
    serviceType: SERVICE_TYPE_LIBELLES[service.type],
    url: urlPage,
    provider: { '@id': personneId },
    areaServed: [
      { '@type': 'City', name: vitrine.ville ?? '' },
      { '@type': 'Country', name: vitrine.pays ?? '' },
    ],
    offers: offreDuService(service),
  })
}

export interface SchemaRealisationSource {
  titre: string
  description: string | null
  annee: number | null
  lieu: string | null
  image: { url: string } | null
}

export function noeudRealisation(
  realisation: SchemaRealisationSource,
  personneId: string,
  urlPage: string,
  siteUrl: string,
): SeoNoeudRealisation {
  return nettoyerJsonLd<SeoNoeudRealisation>({
    '@type': 'CreativeWork',
    '@id': `${urlPage}#realisation`,
    name: realisation.titre,
    description: realisation.description ?? undefined,
    url: urlPage,
    creator: { '@id': personneId },
    dateCreated: realisation.annee === null ? undefined : String(realisation.annee),
    image: realisation.image ? urlAbsolue(siteUrl, realisation.image.url) : undefined,
    locationCreated: realisation.lieu ? { '@type': 'Place', name: realisation.lieu } : undefined,
  })
}

export interface SchemaFilItem {
  name: string
  /** Chemin (`/dr-cabrel/services`) ou URL absolue. */
  item: string
}

export function noeudFil(items: readonly SchemaFilItem[], siteUrl: string, urlPage: string): SeoNoeudFil {
  return nettoyerJsonLd<SeoNoeudFil>({
    '@type': 'BreadcrumbList',
    '@id': `${urlPage}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: urlAbsolue(siteUrl, item.item),
    })),
  })
}

/** Même `@id` que la WebPage créée par nuxt-schema-org (`{canonique}#webpage`) : les deux nœuds fusionnent, un seul WebPage par page. */
export function noeudWebPage(urlPage: string, personneId: string): SeoNoeudWebPage {
  return { '@type': 'WebPage', '@id': `${urlPage}#webpage`, about: { '@id': personneId } }
}

// ---------------------------------------------------------------------------
// Graphe d'une page
// ---------------------------------------------------------------------------

export interface ParamsGrapheVitrine {
  siteUrl: string
  page: PageVitrine
  /** URL canonique ABSOLUE de la page (`urlCanonique`). */
  urlPage: string
  vitrine: SchemaVitrineSource
  /** Titres des services visibles, seulement s'ils sont déjà chargés par la page. */
  servicesVisibles?: readonly { titre: string }[]
  /** Liens de la vitrine, seulement s'ils sont déjà chargés par la page. */
  liens?: readonly SchemaLienSource[]
  service?: SchemaServiceSource
  realisation?: SchemaRealisationSource
}

function filDeLaPage(p: ParamsGrapheVitrine): SchemaFilItem[] {
  const accueil: SchemaFilItem = { name: LIBELLE_FIL_ACCUEIL, item: cheminVitrine(p.vitrine.username) }
  const services: SchemaFilItem = { name: LIBELLE_FIL_SERVICES, item: `${accueil.item}/services` }
  const realisations: SchemaFilItem = { name: LIBELLE_FIL_REALISATIONS, item: `${accueil.item}/realisations` }
  switch (p.page) {
    case 'services': return [accueil, services]
    case 'service': return [accueil, services, { name: p.service?.titre ?? '', item: p.urlPage }]
    case 'realisations': return [accueil, realisations]
    case 'realisation': return [accueil, realisations, { name: p.realisation?.titre ?? '', item: p.urlPage }]
    default: return []
  }
}

/** Nœuds de la page : Person, Service ou CreativeWork (détail), BreadcrumbList (listes et détails), un seul WebPage. */
export function construireGrapheVitrine(p: ParamsGrapheVitrine): SeoNoeud[] {
  const personne = noeudPersonne(p.vitrine, p.servicesVisibles ?? [], p.liens ?? [], p.siteUrl)
  const personneId = personne['@id']
  const noeuds: SeoNoeud[] = [personne]
  if (p.page === 'service' && p.service) noeuds.push(noeudService(p.service, p.vitrine, personneId, p.urlPage))
  if (p.page === 'realisation' && p.realisation) {
    noeuds.push(noeudRealisation(p.realisation, personneId, p.urlPage, p.siteUrl))
  }
  const fil = filDeLaPage(p)
  if (fil.length > 0) noeuds.push(noeudFil(fil, p.siteUrl, p.urlPage))
  noeuds.push(noeudWebPage(p.urlPage, personneId))
  return noeuds
}
