// S12 (#218) : balises SEO et données structurées pour les pages publiques.
// Appelé par chaque page vitrine ; les pages n'appellent plus useSeoMeta / useSchemaOrg directement.
import { useSeoMeta, useHead, useSchemaOrg } from '#imports'
import type { SeoNoeudService, SeoNoeudWebPage } from '~/utils/seo-schema'
import type { SeoPublicDTO } from '#shared/dto/media'
import { ogLocale, construireTitreVitrine, construireDescriptionVitrine } from '#shared/seo'

export interface UseSeoVitrineOptions {
  vitrine: {
    username: string
    nomAffiche: string
    metier: string
    ville: string | null
    pays: string | null
    paysLibelle: string
    titre: string | null
    seoTitre: string | null
    seoDescription: string | null
    accroche: string | null
    bio: string | null
    photo: { url: string } | null
    liens: Array<{ type: string; url: string }>
  }
  page: 'accueil' | 'services' | 'service' | 'realisations' | 'realisation' | 'agenda' | 'contact' | 'lien-bio'
  titre?: string | null        // surcharge : titre de la page (service, réalisation…)
  description?: string | null  // surcharge : description de la page
  image?: SeoPublicDTO['image'] // surcharge : image de partage (service, réalisation, défaut)
  fil?: { name: string, item: string }[] // fil d'Ariane
  schema?: SeoNoeudService | SeoNoeudWebPage // nœuds schema.org supplémentaires
  siteUrl: string
}

/** Titre de la page selon le type. */
function titrePage(options: UseSeoVitrineOptions): string {
  if (options.titre) return options.titre
  const v = options.vitrine
  switch (options.page) {
    case 'accueil': return construireTitreVitrine({ nomAffiche: v.nomAffiche, metier: v.metier, ville: v.ville ?? '', seoTitre: v.seoTitre })
    case 'services': return `Services — ${v.nomAffiche}, ${v.metier} à ${v.ville ?? ''}`
    case 'realisations': return `Réalisations — ${v.nomAffiche}, ${v.metier} à ${v.ville ?? ''}`
    case 'agenda': return `Agenda — ${v.nomAffiche}, ${v.metier} à ${v.ville ?? ''}`
    case 'contact': return `Contact — ${v.nomAffiche}, ${v.metier} à ${v.ville ?? ''}`
    case 'lien-bio': return `${v.nomAffiche} — liens`
    default: return construireTitreVitrine({ nomAffiche: v.nomAffiche, metier: v.metier, ville: v.ville ?? '' })
  }
}

/** Description de la page selon le type. */
function descriptionPage(options: UseSeoVitrineOptions): string {
  if (options.description) return options.description
  const v = options.vitrine
  return construireDescriptionVitrine({
    nomAffiche: v.nomAffiche,
    metier: v.metier,
    ville: v.ville ?? '',
    paysLibelle: v.paysLibelle,
    accroche: v.accroche,
    bio: v.bio,
    seoTitre: v.seoTitre,
    seoDescription: v.seoDescription,
  })
}

/** Image de partage : surcharge, sinon image de la vitrine, sinon défaut. */
function imagePartage(options: UseSeoVitrineOptions): { url: string, largeur: number, hauteur: number, alt: string } | null {
  if (options.image) return options.image
  if (options.vitrine.photo?.url) {
    return { url: options.vitrine.photo.url, largeur: 1200, hauteur: 630, alt: options.vitrine.nomAffiche }
  }
  return null
}

export function useSeoVitrine(options: UseSeoVitrineOptions): void {
  const { vitrine, page, siteUrl, fil, schema } = options
  const titre = titrePage(options)
  const description = descriptionPage(options)
  const image = imagePartage(options)
  const canonique = `${siteUrl}/${vitrine.username}`
  const personneId = `${canonique}#personne`

  useSeoMeta({
    title: titre,
    titleTemplate: '%s',
    description,
    ogTitle: titre,
    ogDescription: description,
    ogType: page === 'accueil' ? 'profile' : 'website',
    ogLocale: ogLocale(vitrine.pays),
    ogSiteName: vitrine.nomAffiche,
    ogUrl: canonique,
    ogImage: image ? [{ url: image.url, width: image.largeur, height: image.hauteur, alt: image.alt }] : undefined,
    twitterCard: 'summary_large_image',
    twitterTitle: titre,
    twitterDescription: description,
    twitterImage: image ? image.url : undefined,
  })

  // Données structurées
  const noeuds: unknown[] = []

  // Personne (toujours sur les pages vitrine)
  noeuds.push({
    '@type': 'Person',
    '@id': personneId,
    name: vitrine.nomAffiche,
    givenName: vitrine.nomAffiche.split(' ')[0],
    familyName: vitrine.nomAffiche.split(' ').slice(1).join(' ') || '',
    honorificPrefix: vitrine.titre ? ['dr', 'pr', 'me', 'm', 'mme'].includes(vitrine.titre.toLowerCase()) ? vitrine.titre : null : null,
    jobTitle: vitrine.metier,
    description: vitrine.accroche ?? '',
    image: vitrine.photo?.url ?? null,
    url: canonique,
    address: {
      '@type': 'PostalAddress',
      addressLocality: vitrine.ville ?? '',
      addressCountry: vitrine.pays ?? '',
    },
    knowsAbout: schema && schema['@type'] === 'Service' ? [schema.name] : [],
    sameAs: vitrine.liens.filter((l) => l.type === 'reseau' && l.url.startsWith('https://')).map((l) => l.url),
  })

  // Service ou Réalisation (détail seulement)
  if (schema) {
    if (schema['@type'] === 'Service') {
      noeuds.push(schema)
    }
    if (schema['@type'] === 'WebPage') {
      noeuds.push({ ...schema, about: { '@id': personneId } })
    }
  }

  // Fil d'Ariane
  if (fil) {
    noeuds.push({
      '@type': 'BreadcrumbList',
      itemListElement: fil.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.item,
      })),
    })
  }

  // Page web
  noeuds.push({ '@type': 'WebPage', about: { '@id': personneId }, url: canonique })

  useSchemaOrg(noeuds as Parameters<typeof useSchemaOrg>[0])

  useHead({
    htmlAttrs: { lang: 'fr' },
    link: [{ rel: 'canonical', href: canonique }],
    meta: [
      { name: 'robots', content: page === 'agenda' || page === 'contact' || page === 'lien-bio' ? 'noindex, follow' : 'index, follow' },
    ],
  })
}
