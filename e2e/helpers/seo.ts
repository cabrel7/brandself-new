// S12 : aides communes aux specs SEO et d'accessibilité (build de production, vitrine de démonstration `dr-cabrel`).
import type { Page } from '@playwright/test'
import { SITE_URL_DEV_DEFAUT } from '../../shared/notifications'
import { OG_IMAGE_HAUTEUR, OG_IMAGE_LARGEUR, sansBarreFinale } from '../../shared/seo'

/** URL publique configurée pour le serveur testé (`NUXT_PUBLIC_SITE_URL`, HTTPS en production). */
export const SITE_URL = sansBarreFinale(process.env.NUXT_PUBLIC_SITE_URL ?? SITE_URL_DEV_DEFAUT)

export const USERNAME_DEMO = 'dr-cabrel'
export const SLUG_SERVICE_DEMO = 'consultation-de-cardiologie'
export const SLUG_REALISATION_DEMO = 'unite-de-catheterisme-chu-de-douala'

export const PAGES_INDEXABLES = [
  '/',
  '/tarifs',
  `/${USERNAME_DEMO}`,
  `/${USERNAME_DEMO}/services`,
  `/${USERNAME_DEMO}/services/${SLUG_SERVICE_DEMO}`,
  `/${USERNAME_DEMO}/realisations`,
  `/${USERNAME_DEMO}/realisations/${SLUG_REALISATION_DEMO}`,
] as const

export const IMAGE_PARTAGE = { largeur: OG_IMAGE_LARGEUR, hauteur: OG_IMAGE_HAUTEUR } as const

/** L'URL publique configurée peut différer de l'hôte réellement testé (ex. `https://ci.example.test`) : on la ramène au `baseURL`. */
export function versServeurDeTest(urlAbsolue: string, baseURL: string): string {
  return urlAbsolue.startsWith(SITE_URL) ? `${sansBarreFinale(baseURL)}${urlAbsolue.slice(SITE_URL.length)}` : urlAbsolue
}

export async function contenuMeta(page: Page, selecteur: string): Promise<string | null> {
  return page.locator(selecteur).first().getAttribute('content')
}

export async function canoniqueDe(page: Page): Promise<string | null> {
  return page.locator('link[rel="canonical"]').first().getAttribute('href')
}

export async function blocsJsonLd(page: Page): Promise<unknown[]> {
  const textes = await page.locator('script[type="application/ld+json"]').allTextContents()
  return textes.map((texte) => JSON.parse(texte) as unknown)
}

/** Dimensions d'un JPEG lues dans son premier marqueur SOF (aucune dépendance image). `null` si illisible. */
export function dimensionsJpeg(octets: Buffer): { largeur: number, hauteur: number } | null {
  const SOI = 0xffd8
  const MARQUEURS_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  if (octets.length < 4 || octets.readUInt16BE(0) !== SOI) return null
  let position = 2
  while (position + 9 < octets.length) {
    if (octets[position] !== 0xff) {
      position += 1
      continue
    }
    const marqueur = octets[position + 1] ?? 0
    if (MARQUEURS_SOF.has(marqueur)) {
      return { hauteur: octets.readUInt16BE(position + 5), largeur: octets.readUInt16BE(position + 7) }
    }
    position += 2 + octets.readUInt16BE(position + 2)
  }
  return null
}

/** Toutes les valeurs de clés d'URL (`@id`, `url`, `item`, `image`, `sameAs`…) d'un nœud JSON-LD, récursivement. */
export function urlsJsonLd(noeud: unknown): string[] {
  const CLES_URL = new Set(['@id', 'url', 'item', 'image', 'logo', 'sameAs'])
  if (Array.isArray(noeud)) return noeud.flatMap(urlsJsonLd)
  if (typeof noeud !== 'object' || noeud === null) return []
  return Object.entries(noeud).flatMap(([cle, valeur]) => {
    if (CLES_URL.has(cle) && typeof valeur === 'string') return [valeur]
    if (CLES_URL.has(cle) && Array.isArray(valeur)) return valeur.filter((v): v is string => typeof v === 'string')
    return urlsJsonLd(valeur)
  })
}
