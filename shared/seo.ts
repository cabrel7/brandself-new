// S12 : SEO, GEO et performance. Module PUR (aucun import Nuxt/Nitro, aucun secret) :
// importé par nuxt.config.ts, le serveur, l'application et les tests.
import { MARQUE } from './brand'
import { partageUrl } from './medias'
import { isReserved } from './reserved'

// ---------------------------------------------------------------------------
// Bornes et gabarits de texte
// ---------------------------------------------------------------------------

export const SEO_TITRE_MIN = 30
export const SEO_TITRE_MAX = 70
export const SEO_DESCRIPTION_MIN = 50
export const SEO_DESCRIPTION_MAX = 160
/**
 * Titre généré par l'IA (décision #24) : seul le fragment « ce que fait la personne et où ». Publié sous la forme
 * « {nomAffiche} — {titre IA} » : 50 + séparateur + 17 (« Dr Cabrel Nguesso ») reste dans SEO_TITRE_MAX. Les bornes
 * de la description générée sont celles de la description saisie (SEO_DESCRIPTION_MIN/MAX). Source de vérité des
 * CHECK `vitrines_seo_ia_*` (migration 0027) : garder synchronisées.
 */
export const SEO_IA_TITRE_MIN = 10
export const SEO_IA_TITRE_MAX = 50
export const SITE_DESCRIPTION =
  'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.'
export const SEPARATEUR_TITRE = ' — '
export const ELLIPSE = '…'
export const PAYS_DEFAUT_LOCALE = 'FR'
/** Nombre maximal de titres cités dans la description d'une liste. */
export const DESCRIPTION_TITRES_MAX = 4

// ---------------------------------------------------------------------------
// Cache HTML (microcache nginx) et indexation
// ---------------------------------------------------------------------------

export const CACHE_HTML_TTL_S = 10
export const CACHE_HTML_ROUTES = [
  '/',
  '/tarifs',
  '/:u',
  '/:u/services',
  '/:u/services/:slug',
  '/:u/realisations',
  '/:u/realisations/:slug',
  '/@:u',
] as const

export type DirectiveRobots = 'noindex, follow' | 'noindex, nofollow'

/** Appliquée par `routeRules.robots` (meta + `X-Robots-Tag`). `/@*` : posé par la page elle-même. */
export const NOINDEX_ROUTES: Readonly<Record<string, DirectiveRobots>> = {
  '/studio/**': 'noindex, nofollow',
  '/onboarding': 'noindex, nofollow',
  '/connexion/**': 'noindex, nofollow',
  '/desabonnement': 'noindex, nofollow',
  '/*/reserver/**': 'noindex, nofollow',
  '/*/agenda': 'noindex, follow',
  '/*/contact': 'noindex, follow',
  // Ajoutées après S12 : serveur MCP et découverte OAuth (les clients lisent `/.well-known/oauth-*` : l'en-tête
  // n'empêche aucun accès), routes de Better Auth. `/connexion/**` couvre aussi `/connexion` (radix3).
  '/mcp': 'noindex, nofollow',
  '/.well-known/**': 'noindex, nofollow',
  '/api/auth/**': 'noindex, nofollow',
}
/** `/@*` n'est pas exprimable en route rule (radix3 : pas de joker partiel) : la page pose elle-même la directive. */
export const NOINDEX_LIEN_BIO: DirectiveRobots = 'noindex, follow'

export type PageVitrine =
  | 'accueil'
  | 'services'
  | 'service'
  | 'realisations'
  | 'realisation'
  | 'agenda'
  | 'contact'
  | 'lien-bio'

/** Directive d'une page de vitrine : `null` = indexable (le module robots décide, y compris `noindex` en préproduction). */
export function directiveRobotsPage(page: PageVitrine): DirectiveRobots | null {
  switch (page) {
    case 'agenda': return NOINDEX_ROUTES['/*/agenda'] ?? null
    case 'contact': return NOINDEX_ROUTES['/*/contact'] ?? null
    case 'lien-bio': return NOINDEX_LIEN_BIO
    default: return null
  }
}

// ---------------------------------------------------------------------------
// robots.txt et politique des robots d'IA
// ---------------------------------------------------------------------------

// `Disallow` est un préfixe : `/studio` bloquerait la vitrine `/studio-dupont` (seul le mot exact est réservé).
// `/x$` (fin d'URL) + `/x/` ciblent la seule route ; `/api/` et `/.well-known/` ne peuvent pas être un username.
export const ROBOTS_DISALLOW = [
  '/studio$',
  '/studio/',
  '/onboarding$',
  '/onboarding/',
  '/connexion$',
  '/connexion/',
  '/desabonnement$',
  '/desabonnement/',
  '/api/',
  '/mcp$',
  '/mcp/',
  '/.well-known/',
] as const
export const ROBOTS_ALLOW = ['/'] as const
export const ROBOTS_USER_AGENT_TOUS = '*'
export const ROBOTS_IA_POLITIQUES = ['recherche_seulement', 'tout_autoriser', 'tout_bloquer'] as const
export type RobotsIaPolitique = (typeof ROBOTS_IA_POLITIQUES)[number]
export const ROBOTS_IA_POLITIQUE_DEFAUT: RobotsIaPolitique = 'recherche_seulement'
export const ROBOTS_IA_ENTRAINEMENT = [
  'GPTBot',
  'ClaudeBot',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Bytespider',
  'cohere-training-data-crawler',
] as const
export const ROBOTS_IA_RECHERCHE = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Claude-SearchBot',
  'Claude-User',
  'DuckAssistBot',
  'MistralAI-User',
] as const
export const ROBOTS_SITEMAP_CHEMIN = '/sitemap_index.xml'

export interface GroupeRobots {
  userAgent: string[]
  disallow: string[]
  allow: string[]
}

/** Groupes pour `robots.groups` : `*` toujours ; robots d'entraînement bloqués sauf `tout_autoriser`. */
export function construireGroupesRobots(politique: RobotsIaPolitique = ROBOTS_IA_POLITIQUE_DEFAUT): GroupeRobots[] {
  const groupes: GroupeRobots[] = [
    { userAgent: [ROBOTS_USER_AGENT_TOUS], disallow: [...ROBOTS_DISALLOW], allow: [...ROBOTS_ALLOW] },
  ]
  if (politique === 'recherche_seulement') {
    groupes.push({ userAgent: [...ROBOTS_IA_ENTRAINEMENT], disallow: ['/'], allow: [] })
  }
  if (politique === 'tout_bloquer') {
    groupes.push(
      { userAgent: [...ROBOTS_IA_ENTRAINEMENT], disallow: ['/'], allow: [] },
      { userAgent: [...ROBOTS_IA_RECHERCHE], disallow: ['/'], allow: [] },
    )
  }
  return groupes
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export const SITEMAP_URLS_PAR_CARTE = 5000
export const SITEMAP_CACHE_S = 600
export const SITEMAP_LOT_VITRINES = 500

// ---------------------------------------------------------------------------
// Image de partage et locales
// ---------------------------------------------------------------------------

export const OG_IMAGE_LARGEUR = 1200
export const OG_IMAGE_HAUTEUR = 630
export const OG_IMAGE_QUALITE = 82
export const OG_IMAGE_DEFAUT = '/brand/partage.jpg'
export const OG_LOGO = '/brand/icone.png'
export const OG_LOCALES_PAYS = [
  'CM', 'FR', 'SN', 'CI', 'BE', 'CH', 'CA', 'GA', 'CG', 'CD', 'BJ', 'TG', 'BF', 'ML', 'NE', 'TD', 'RW', 'MG',
] as const

export const SCHEMA_KNOWS_ABOUT_MAX = 6

// ---------------------------------------------------------------------------
// Budgets de performance (Lighthouse CI, mesures du build de production)
// ---------------------------------------------------------------------------

export const BUDGET_LCP_MS = 2500
export const BUDGET_CLS = 0.1
export const BUDGET_TBT_MS = 300
export const BUDGET_JS_KO = 200
export const BUDGET_PAGE_KO = 900
export const BUDGET_TTFB_P95_MS = 400
export const BUDGET_SCORE_SEO = 0.95
export const BUDGET_SCORE_A11Y = 0.95
export const BUDGET_SCORE_BONNES_PRATIQUES = 0.9
export const BUDGET_SCORE_PERF = 0.85
export const LIGHTHOUSE_PASSAGES = 3

// ---------------------------------------------------------------------------
// llms.txt (le module préfixe lui-même « LLM Resources » : pas de section de ce nom)
// ---------------------------------------------------------------------------

export interface LlmsLien {
  title: string
  href: string
  description?: string
}
export interface LlmsSection {
  title: string
  description?: string[]
  links?: LlmsLien[]
}

export const LLMS_SECTIONS: LlmsSection[] = [
  {
    title: 'À propos',
    description: [
      SITE_DESCRIPTION,
      'Chaque professionnel publie sa vitrine à l’adresse /{adresse}. Chaque vitrine présente un profil, des services, des réalisations, des témoignages et des liens, avec des données structurées schema.org (Person, Service).',
    ],
  },
  {
    title: 'Adresses publiques',
    description: [
      'Forme des adresses : /{adresse}, /{adresse}/services, /{adresse}/services/{service}, /{adresse}/realisations, /{adresse}/realisations/{realisation}.',
    ],
    links: [
      { title: 'Tarifs', href: '/tarifs', description: `Les offres et les prix de ${MARQUE.nom}.` },
      { title: 'Plan du site', href: ROBOTS_SITEMAP_CHEMIN, description: 'Toutes les vitrines publiées.' },
    ],
  },
]
export const LLMS_NOTES: string[] = [
  'Les vitrines appartiennent à leurs auteurs : les citer avec leur adresse, ne pas les utiliser pour entraîner un modèle.',
]
export const LLMS_CACHE_S = 3600

// ---------------------------------------------------------------------------
// Texte : troncature, titres, descriptions (fonctions pures)
// ---------------------------------------------------------------------------

function uneLigne(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

function renseigne(texte: string | null | undefined): string | null {
  if (texte === null || texte === undefined) return null
  const propre = uneLigne(texte)
  return propre === '' ? null : propre
}

/** Texte sur une ligne, coupé sur une fin de mot à SEO_DESCRIPTION_MAX caractères au plus (ellipse comprise). */
export function tronquerDescription(texte: string, max: number = SEO_DESCRIPTION_MAX): string {
  const propre = uneLigne(texte)
  if (propre.length <= max) return propre
  const limite = max - ELLIPSE.length
  let coupe = propre.slice(0, limite)
  if (!/\s/.test(propre.charAt(limite))) {
    const dernierEspace = coupe.search(/\s\S*$/)
    if (dernierEspace > 0) coupe = coupe.slice(0, dernierEspace)
  }
  return `${coupe.trimEnd()}${ELLIPSE}`
}

export interface SeoVitrineSource {
  nomAffiche: string
  metier: string
  ville: string
  paysLibelle: string
  accroche?: string | null
  bio?: string | null
  seoTitre?: string | null
  seoDescription?: string | null
}

type SeoVitrineIdentite = Pick<SeoVitrineSource, 'nomAffiche' | 'metier' | 'ville'>

function lieuMetier(v: SeoVitrineIdentite): string {
  const ville = renseigne(v.ville)
  return ville ? `${v.metier} à ${ville}` : v.metier
}

/** Complète un texte trop court (moins de SEO_DESCRIPTION_MIN) avec un complément, puis borne à SEO_DESCRIPTION_MAX. */
function etendre(texte: string, complement: string): string {
  const base = uneLigne(texte)
  return tronquerDescription(base.length >= SEO_DESCRIPTION_MIN ? base : `${base} ${complement}`)
}

/** `{nomAffiche} — {metier} à {ville}` ; `seoTitre` saisi, s'il existe, le remplace. */
export function construireTitreVitrine(v: SeoVitrineIdentite & { seoTitre?: string | null }): string {
  return renseigne(v.seoTitre) ?? `${v.nomAffiche}${SEPARATEUR_TITRE}${lieuMetier(v)}`
}

export function construireTitreListeServices(v: SeoVitrineIdentite): string {
  return `Services${SEPARATEUR_TITRE}${v.nomAffiche}, ${lieuMetier(v)}`
}

export function construireTitreListeRealisations(v: SeoVitrineIdentite): string {
  return `Réalisations${SEPARATEUR_TITRE}${v.nomAffiche}, ${lieuMetier(v)}`
}

export function construireTitreLienBio(v: Pick<SeoVitrineIdentite, 'nomAffiche'>): string {
  return `${v.nomAffiche}${SEPARATEUR_TITRE}liens`
}

/** `{service} — {nomAffiche} — {ville}`. */
export function construireTitreService(titreService: string, v: Pick<SeoVitrineIdentite, 'nomAffiche' | 'ville'>): string {
  return [titreService, v.nomAffiche, renseigne(v.ville)].filter((partie) => partie !== null).join(SEPARATEUR_TITRE)
}

export function construireTitreAgenda(v: SeoVitrineIdentite): string {
  return `Agenda${SEPARATEUR_TITRE}${v.nomAffiche}, ${lieuMetier(v)}`
}

export function construireTitreContact(v: SeoVitrineIdentite): string {
  return `Contact${SEPARATEUR_TITRE}${v.nomAffiche}, ${lieuMetier(v)}`
}

/** `{réalisation} — {nomAffiche}`. */
export function construireTitreRealisation(titreRealisation: string, v: Pick<SeoVitrineIdentite, 'nomAffiche'>): string {
  return `${titreRealisation}${SEPARATEUR_TITRE}${v.nomAffiche}`
}

/**
 * `seoDescription` saisie ; sinon `{metier} à {ville} ({pays}).` + accroche (ou bio) ; sinon gabarit. Jamais vide.
 * Si l'accroche (ou la bio) contient déjà le métier, il n'est pas répété en préfixe.
 */
export function construireDescriptionVitrine(v: SeoVitrineSource): string {
  const saisie = renseigne(v.seoDescription)
  if (saisie) return tronquerDescription(saisie)
  const texte = renseigne(v.accroche) ?? renseigne(v.bio)
  if (texte) {
    const metierDejaCite = texte.toLowerCase().includes(v.metier.trim().toLowerCase())
    if (metierDejaCite) return etendre(texte, `${v.nomAffiche}${localisation(v)}.`)
    return tronquerDescription(`${lieuMetier(v)}${suffixePays(v)}. ${texte}`)
  }
  return tronquerDescription(`${v.nomAffiche}, ${lieuMetier(v)}${suffixePays(v)}.`)
}

/** D'où vient un texte publié : saisi par le professionnel, proposé par l'IA, ou gabarit déterministe. */
export type OrigineSeo = 'personnalise' | 'ia' | 'gabarit'

export interface SeoResolu {
  titre: string
  description: string
  origineTitre: OrigineSeo
  origineDescription: OrigineSeo
}

/** Proposition IA FRAÎCHE (déjà filtrée par `seoIaFraiche`) : le titre est le fragment, sans nom. */
export interface SeoIaProposition {
  titre: string
  description: string
}

/**
 * Trois niveaux, résolus CHAMP PAR CHAMP : texte saisi > proposition IA fraîche > gabarit déterministe.
 * Titre IA : « {nomAffiche} — {titre IA} » seulement s'il tient dans SEO_TITRE_MAX (sinon gabarit).
 * Fonction pure : jamais de titre ni de description vide.
 */
export function resoudreSeoVitrine(source: SeoVitrineSource, ia: SeoIaProposition | null): SeoResolu {
  const sansSaisie = { ...source, seoTitre: null, seoDescription: null }

  let titre: string
  let origineTitre: OrigineSeo
  const titreIa = ia === null ? null : renseigne(ia.titre)
  const titreCombine = titreIa === null ? null : `${source.nomAffiche}${SEPARATEUR_TITRE}${titreIa}`
  if (renseigne(source.seoTitre) !== null) {
    titre = construireTitreVitrine(source)
    origineTitre = 'personnalise'
  } else if (titreCombine !== null && titreCombine.length <= SEO_TITRE_MAX) {
    titre = titreCombine
    origineTitre = 'ia'
  } else {
    titre = construireTitreVitrine(sansSaisie)
    origineTitre = 'gabarit'
  }

  let description: string
  let origineDescription: OrigineSeo
  const descriptionIa = ia === null ? null : renseigne(ia.description)
  if (renseigne(source.seoDescription) !== null) {
    description = construireDescriptionVitrine(source)
    origineDescription = 'personnalise'
  } else if (descriptionIa !== null) {
    description = tronquerDescription(descriptionIa)
    origineDescription = 'ia'
  } else {
    description = construireDescriptionVitrine(sansSaisie)
    origineDescription = 'gabarit'
  }

  return { titre, description, origineTitre, origineDescription }
}

export interface SeoElementSource {
  titre: string
  description?: string | null
  seoDescription?: string | null
}

/** Description saisie, sinon description du service ; trop courte, elle est complétée par `{service} avec {nomAffiche}, {metier} à {ville}.` */
export function construireDescriptionService(s: SeoElementSource, v: SeoVitrineIdentite): string {
  const complement = `${s.titre} avec ${v.nomAffiche}, ${lieuMetier(v)}.`
  const texte = renseigne(s.seoDescription) ?? renseigne(s.description)
  return texte ? etendre(texte, complement) : tronquerDescription(complement)
}

/** Description saisie, sinon description de la réalisation ; trop courte, elle est complétée par `{réalisation}, réalisation de {nomAffiche}, {metier} à {ville}.` */
export function construireDescriptionRealisation(r: SeoElementSource, v: SeoVitrineIdentite): string {
  const complement = `${r.titre}, réalisation de ${v.nomAffiche}, ${lieuMetier(v)}.`
  const texte = renseigne(r.seoDescription) ?? renseigne(r.description)
  return texte ? etendre(texte, complement) : tronquerDescription(complement)
}

type SeoVitrineLocale = Pick<SeoVitrineSource, 'nomAffiche' | 'ville' | 'paysLibelle'>

/** ` (Cameroun)` ou chaîne vide. */
function suffixePays(v: Pick<SeoVitrineSource, 'paysLibelle'>): string {
  const libelle = renseigne(v.paysLibelle)
  return libelle ? ` (${libelle})` : ''
}

/** ` à Douala (Cameroun)`, ` à Douala`, ` (Cameroun)` ou chaîne vide. */
function localisation(v: Pick<SeoVitrineSource, 'ville' | 'paysLibelle'>): string {
  const ville = renseigne(v.ville)
  return `${ville ? ` à ${ville}` : ''}${suffixePays(v)}`
}

/** `a`, `a et b`, `a, b et c` : au plus DESCRIPTION_TITRES_MAX titres non vides. */
function enumeration(titres: readonly string[]): string {
  const liste = titres.map(renseigne).filter((t) => t !== null).slice(0, DESCRIPTION_TITRES_MAX)
  const dernier = liste.pop()
  if (dernier === undefined) return ''
  return liste.length === 0 ? dernier : `${liste.join(', ')} et ${dernier}`
}

/** Liste des services : jamais le métier (déjà dans le titre), titres visibles s'il y en a. Aucun fait inventé. */
export function construireDescriptionListeServices(v: SeoVitrineLocale, titres: readonly string[] = []): string {
  const debut = `Découvrez les services proposés par ${v.nomAffiche}${localisation(v)}`
  const liste = enumeration(titres)
  return etendre(liste ? `${debut} : ${liste}.` : `${debut}, avec le détail de chaque prestation.`, 'Chaque prestation est détaillée.')
}

export function construireDescriptionListeRealisations(v: SeoVitrineLocale, titres: readonly string[] = []): string {
  const debut = `Découvrez les réalisations de ${v.nomAffiche}${localisation(v)}`
  const liste = enumeration(titres)
  return etendre(liste ? `${debut} : ${liste}.` : `${debut}, avec le détail de chaque projet.`, 'Chaque projet est détaillé.')
}

export function construireDescriptionContact(v: SeoVitrineLocale): string {
  return etendre(`Écrivez à ${v.nomAffiche}${localisation(v)} depuis cette page pour poser une question avant de réserver.`, 'Contactez-le simplement.')
}

export function construireDescriptionAgenda(v: SeoVitrineLocale): string {
  return etendre(`Consultez les créneaux disponibles de ${v.nomAffiche}${localisation(v)} et choisissez l’heure qui vous convient.`, 'Réservez simplement.')
}

export function construireDescriptionLienBio(v: SeoVitrineLocale): string {
  return etendre(`Les liens utiles de ${v.nomAffiche}${localisation(v)}, réunis en un seul endroit.`, 'Retrouvez-le facilement.')
}

/** `fr_{pays}` si le pays figure dans OG_LOCALES_PAYS, sinon `fr_FR`. */
export function ogLocale(pays: string | null | undefined): string {
  const code = (pays ?? '').trim().toUpperCase()
  const connu = (OG_LOCALES_PAYS as readonly string[]).includes(code)
  return `fr_${connu ? code : PAYS_DEFAUT_LOCALE}`
}

// ---------------------------------------------------------------------------
// Chemins : cache et canonique
// ---------------------------------------------------------------------------

const USERNAME_SEGMENT = /^@?[A-Za-z0-9-]{3,30}$/
const SLUG_SEGMENT = /^[A-Za-z0-9-]{1,120}$/
const SEGMENT_SERVICES = 'services'
const SEGMENT_REALISATIONS = 'realisations'
const CHEMIN_ACCUEIL = '/'
const CHEMIN_TARIFS = '/tarifs'

function sansQuery(path: string): string {
  const fin = path.search(/[?#]/)
  return fin === -1 ? path : path.slice(0, fin)
}

function segmentsDe(path: string): string[] {
  return sansQuery(path).split('/').filter((segment) => segment !== '')
}

function estSegmentVitrine(segment: string): boolean {
  if (!USERNAME_SEGMENT.test(segment)) return false
  return !isReserved(segment.replace(/^@/, '').toLowerCase())
}

/** Liste blanche #139 : jamais /studio, /api, reserver, agenda, contact, connexion, onboarding, désabonnement, erreurs. */
export function estRouteCacheable(path: string): boolean {
  const propre = sansQuery(path)
  if (propre === CHEMIN_ACCUEIL) return true
  const segments = segmentsDe(propre)
  const [premier, deuxieme, troisieme, ...reste] = segments
  if (premier === undefined || reste.length > 0) return false
  if (segments.length === 1 && `/${premier.toLowerCase()}` === CHEMIN_TARIFS) return true
  if (!estSegmentVitrine(premier)) return false
  if (deuxieme === undefined) return true
  if (deuxieme.startsWith('@') || premier.startsWith('@')) return false
  if (deuxieme === SEGMENT_SERVICES || deuxieme === SEGMENT_REALISATIONS) {
    return troisieme === undefined || SLUG_SEGMENT.test(troisieme)
  }
  return false
}

/** Chemin normalisé : sans query ni fragment, sans barre finale ni doublon, en minuscules ; `/` pour la racine. */
export function normaliserChemin(path: string): string {
  return `/${segmentsDe(path).join('/').toLowerCase()}`
}

/** Chemin canonique (minuscules, sans barre finale, sans query) ou `null` si non applicable / déjà canonique. */
export function cheminCanonique(path: string): string | null {
  const propre = sansQuery(path)
  const segments = segmentsDe(propre)
  const [premier] = segments
  if (premier === undefined || !estSegmentVitrine(premier)) return null
  if ((segments[segments.length - 1] ?? '').includes('.')) return null
  const canonique = normaliserChemin(propre)
  return canonique === propre ? null : canonique
}

// ---------------------------------------------------------------------------
// URL absolues (canonique, og:url, og:image, JSON-LD)
// ---------------------------------------------------------------------------

const URL_ABSOLUE = /^https?:\/\//i

/** URL du site sans barre finale. */
export function sansBarreFinale(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** `siteUrl` + chemin (ou URL déjà absolue, rendue telle quelle). La casse du chemin est conservée. */
export function urlAbsolue(siteUrl: string, chemin: string): string {
  if (URL_ABSOLUE.test(chemin)) return chemin
  const site = sansBarreFinale(siteUrl)
  return chemin.startsWith('/') ? `${site}${chemin}` : `${site}/${chemin}`
}

const LIEN_MARKDOWN_RELATIF = /\]\((\/(?!\/)[^)\s]*)\)/g

/**
 * llms.txt : les liens `[titre](/chemin)` des sections (`LLMS_SECTIONS`) sont relatifs, le module `nuxt-ai-ready`
 * ne résolvant que ses propres liens ; un robot attend des URL absolues. Appliquée à la réponse, au runtime, avec
 * l'URL publique configurée (`NUXT_PUBLIC_SITE_URL`) : l'image de production n'embarque aucun hôte.
 * Les liens déjà absolus et les chemins en texte libre (hors syntaxe de lien) ne sont pas touchés.
 */
export function absolutiserLiensLlms(texte: string, siteUrl: string): string {
  return texte.replace(LIEN_MARKDOWN_RELATIF, (_lien, chemin: string) => `](${urlAbsolue(siteUrl, chemin)})`)
}

/** URL canonique d'une page : chemin réel normalisé (minuscules, sans barre finale ni query), absolue. */
export function urlCanonique(siteUrl: string, chemin: string): string {
  return urlAbsolue(siteUrl, normaliserChemin(chemin))
}

export interface ImagePartage {
  url: string
  largeur: number
  hauteur: number
  alt: string
}

/**
 * Image de partage RELATIVE d'un média (variante `partage`, produite à la première demande par le serveur) ;
 * `null` sans média : `choisirImagePartage` retombe alors sur OG_IMAGE_DEFAUT.
 */
export function construireImagePartage(
  mediaId: string | null | undefined,
  alt: string,
): { url: string, largeur: typeof OG_IMAGE_LARGEUR, hauteur: typeof OG_IMAGE_HAUTEUR, alt: string } | null {
  if (mediaId === null || mediaId === undefined || mediaId === '') return null
  return { url: partageUrl(mediaId), largeur: OG_IMAGE_LARGEUR, hauteur: OG_IMAGE_HAUTEUR, alt }
}

/** Image de partage absolue : variante `partage` du DTO si elle existe, sinon l'image par défaut de la marque. Jamais la photo d'origine. */
export function choisirImagePartage(
  image: { url: string, largeur: number, hauteur: number, alt: string } | null | undefined,
  siteUrl: string,
  altDefaut: string,
): ImagePartage {
  if (image && renseigne(image.url)) {
    return { url: urlAbsolue(siteUrl, image.url), largeur: image.largeur, hauteur: image.hauteur, alt: renseigne(image.alt) ?? altDefaut }
  }
  return { url: urlAbsolue(siteUrl, OG_IMAGE_DEFAUT), largeur: OG_IMAGE_LARGEUR, hauteur: OG_IMAGE_HAUTEUR, alt: altDefaut }
}
