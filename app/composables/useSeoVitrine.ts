// S12 (#218) : balises SEO et données structurées des pages publiques d'une vitrine.
// Les pages appellent ce composable ; elles n'appellent plus useSeoMeta / useSchemaOrg directement.
// Tout le calcul est dans des fonctions pures (`construireMetasPage`, `construireGrapheVitrine`).
import { useHead, useResponseHeader, useRoute, useSchemaOrg, useSeoMeta, useSiteConfig } from '#imports'
import type { ImagePartageDTO } from '#shared/dto/media'
import { ogLocale, sansBarreFinale } from '#shared/seo'
import type { PageVitrine } from '#shared/seo'
import { construireMetasPage } from '~/utils/seo-page'
import type { VitrineSeoSource } from '~/utils/seo-page'
import { construireGrapheVitrine } from '~/utils/seo-schema'
import type { SchemaLienSource, SchemaRealisationSource, SchemaServiceSource } from '~/utils/seo-schema'

export interface UseSeoVitrineOptions {
  /** `vitrine.value` de `usePublicVitrine` (le DTO public convient tel quel). */
  vitrine: VitrineSeoSource
  page: PageVitrine
  /** Détail d'un service. */
  service?: SchemaServiceSource
  /** Détail d'une réalisation. */
  realisation?: SchemaRealisationSource
  /** Image de partage du service ou de la réalisation (`seo.image` du DTO) ; sinon celle de la vitrine. */
  image?: ImagePartageDTO | null
  /** Seulement si la page les a déjà chargés : aucune requête n'est faite pour le SEO. */
  servicesVisibles?: readonly { titre: string }[]
  titresRealisations?: readonly string[]
  liens?: readonly SchemaLienSource[]
  /** @deprecated Ignoré : l'URL du site vient de `site.url` (nuxt-site-config). */
  siteUrl?: string
}

export function useSeoVitrine(options: UseSeoVitrineOptions): void {
  const { vitrine, page } = options
  // `site.url` : même source que le module (canonique, sitemap, robots). Sans barre finale.
  const siteUrl = sansBarreFinale(useSiteConfig().url ?? '')
  const metas = construireMetasPage({
    siteUrl,
    chemin: useRoute().path,
    page,
    vitrine,
    service: options.service,
    realisation: options.realisation,
    servicesVisibles: options.servicesVisibles,
    titresRealisations: options.titresRealisations,
    image: options.image,
  })

  useSeoMeta({
    title: metas.titre,
    titleTemplate: '%s',
    description: metas.description,
    ogTitle: metas.titre,
    ogDescription: metas.description,
    ogType: metas.ogType,
    ...(metas.ogType === 'profile' ? { profileFirstName: vitrine.prenom, profileLastName: vitrine.nom } : {}),
    ogLocale: ogLocale(vitrine.pays),
    ogSiteName: vitrine.nomAffiche,
    ogUrl: metas.canonique,
    ogImage: [{ url: metas.image.url, width: metas.image.largeur, height: metas.image.hauteur, alt: metas.image.alt }],
    twitterCard: 'summary_large_image',
    twitterTitle: metas.titre,
    twitterDescription: metas.description,
    twitterImage: metas.image.url,
  })

  useSchemaOrg(construireGrapheVitrine({
    siteUrl,
    page,
    urlPage: metas.canonique,
    vitrine,
    servicesVisibles: options.servicesVisibles,
    liens: options.liens,
    service: options.service,
    realisation: options.realisation,
  }) as unknown as Parameters<typeof useSchemaOrg>[0])

  useHead({
    htmlAttrs: { lang: 'fr' },
    link: [{ rel: 'canonical', href: metas.canonique }],
    // Page indexable : aucune balise, le module robots décide (y compris `noindex` en préproduction).
    ...(metas.robots ? { meta: [{ name: 'robots', content: metas.robots }] } : {}),
  })
  // `/@username` n'a pas de route rule (radix3 n'accepte pas `/@*`) : l'en-tête est posé ici, comme la balise.
  if (metas.robots && import.meta.server) useResponseHeader('X-Robots-Tag').value = metas.robots
}
