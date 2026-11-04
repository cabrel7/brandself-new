/** S12 : image Open Graph (variante `partage`). `url` absolue. */
export interface ImagePartageDTO {
  url: string
  largeur: 1200
  hauteur: 630
  alt: string
}

/** S12 : métadonnées SEO d'une page publique. `image` null : l'application utilise OG_IMAGE_DEFAUT. */
export interface SeoPublicDTO {
  titre: string
  description: string
  image: ImagePartageDTO | null
}

/** S12 : entrée du sitemap. `loc` relatif, `lastmod` ISO 8601. */
export interface SitemapUrlDTO {
  loc: string
  lastmod: string
}

export interface MediaDTO {
  id: string
  url: string
  srcset: string
  largeur: number
  hauteur: number
}
