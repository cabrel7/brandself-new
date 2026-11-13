// S12 (#143, #144, #146, #147, #148, #149) : métadonnées d'une page de vitrine. Fonction pure, sans Vue :
// `useSeoVitrine` ne fait que les poser dans la tête de la page.

import type { ImagePartageDTO, SeoPublicDTO } from '#shared/dto/media'
import { MARQUE } from '#shared/brand'
import {
  choisirImagePartage,
  construireDescriptionAgenda,
  construireDescriptionContact,
  construireDescriptionLienBio,
  construireDescriptionListeRealisations,
  construireDescriptionListeServices,
  construireDescriptionRealisation,
  construireDescriptionService,
  construireTitreAgenda,
  construireTitreContact,
  construireTitreLienBio,
  construireTitreListeRealisations,
  construireTitreListeServices,
  construireTitreRealisation,
  construireTitreService,
  directiveRobotsPage,
  urlCanonique,
} from '#shared/seo'
import type { DirectiveRobots, ImagePartage, PageVitrine } from '#shared/seo'
import type { SchemaRealisationSource, SchemaServiceSource, SchemaVitrineSource } from './seo-schema'

/** Sous-ensemble de `VitrinePubliqueDTO` lu par le SEO : la page passe `vitrine.value` tel quel. */
export interface VitrineSeoSource extends SchemaVitrineSource {
  paysLibelle: string
  /** Titre et description de l'accueil, déjà construits côté serveur (texte saisi au Profil ou repli automatique). */
  seo: SeoPublicDTO
}

export interface ParamsMetasPage {
  siteUrl: string
  /** Chemin réel de la page (`useRoute().path`) : la canonique en est dérivée. */
  chemin: string
  page: PageVitrine
  vitrine: VitrineSeoSource
  service?: SchemaServiceSource
  realisation?: SchemaRealisationSource
  /** Titres des services visibles, seulement s'ils sont déjà chargés par la page. */
  servicesVisibles?: readonly { titre: string }[]
  /** Titres des réalisations visibles, seulement s'ils sont déjà chargés par la page. */
  titresRealisations?: readonly string[]
  /** Image de partage de l'élément (détail) ; sinon celle de la vitrine ; sinon l'image de la marque. */
  image?: ImagePartageDTO | null
}

export interface MetasPage {
  titre: string
  description: string
  /** URL absolue, égale à `og:url`. */
  canonique: string
  ogType: 'profile' | 'website'
  /** `null` : page indexable, le module robots décide. */
  robots: DirectiveRobots | null
  image: ImagePartage
}

function titreDeLaPage(p: ParamsMetasPage): string {
  const v = p.vitrine
  const identite = { nomAffiche: v.nomAffiche, metier: v.metier, ville: v.ville ?? '' }
  switch (p.page) {
    case 'services': return construireTitreListeServices(identite)
    case 'service': return p.service ? construireTitreService(p.service.titre, identite) : v.seo.titre
    case 'realisations': return construireTitreListeRealisations(identite)
    case 'realisation': return p.realisation ? construireTitreRealisation(p.realisation.titre, identite) : v.seo.titre
    case 'agenda': return construireTitreAgenda(identite)
    case 'contact': return construireTitreContact(identite)
    case 'lien-bio': return construireTitreLienBio(identite)
    case 'accueil': return v.seo.titre
  }
}

/** Une description saisie au Profil ne vaut que pour l'accueil : les autres pages ont la leur (pas de contenu dupliqué). */
function descriptionDeLaPage(p: ParamsMetasPage): string {
  const v = p.vitrine
  const identite = { nomAffiche: v.nomAffiche, metier: v.metier, ville: v.ville ?? '' }
  const locale = { nomAffiche: v.nomAffiche, ville: v.ville ?? '', paysLibelle: v.paysLibelle }
  switch (p.page) {
    case 'services': return construireDescriptionListeServices(locale, (p.servicesVisibles ?? []).map((s) => s.titre))
    case 'service':
      return p.service
        ? construireDescriptionService({ titre: p.service.titre, description: p.service.description }, identite)
        : v.seo.description
    case 'realisations': return construireDescriptionListeRealisations(locale, p.titresRealisations ?? [])
    case 'realisation':
      return p.realisation
        ? construireDescriptionRealisation({ titre: p.realisation.titre, description: p.realisation.description }, identite)
        : v.seo.description
    case 'agenda': return construireDescriptionAgenda(locale)
    case 'contact': return construireDescriptionContact(locale)
    case 'lien-bio': return construireDescriptionLienBio(locale)
    case 'accueil': return v.seo.description
  }
}

export function construireMetasPage(p: ParamsMetasPage): MetasPage {
  return {
    titre: titreDeLaPage(p),
    description: descriptionDeLaPage(p),
    canonique: urlCanonique(p.siteUrl, p.chemin),
    ogType: p.page === 'accueil' ? 'profile' : 'website',
    robots: directiveRobotsPage(p.page),
    image: choisirImagePartage(p.image ?? p.vitrine.seo.image, p.siteUrl, MARQUE.nom),
  }
}
