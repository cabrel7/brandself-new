// S12 : SEO, GEO et performance. Module PUR (aucun import Nuxt/Nitro, aucun secret) :
// importé par nuxt.config.ts, le serveur, l'application et les tests.
import { isReserved } from './reserved'

// ---------------------------------------------------------------------------
// Bornes et gabarits de texte
// ---------------------------------------------------------------------------

export const SEO_TITRE_MIN = 30
export const SEO_TITRE_MAX = 70
export const SEO_DESCRIPTION_MIN = 50
export const SEO_DESCRIPTION_MAX = 160
export const SITE_NOM = 'Brandself'
export const SITE_DESCRIPTION =
  'Une vitrine en ligne pour les professionnels : être trouvé, être compris, être contacté ou réservé.'
export const SEPARATEUR_TITRE = ' — '
export const TITRE_TEMPLATE_BRANDSELF = '%s · Brandself'
export const TITRE_ACCUEIL_BRANDSELF = 'Brandself — votre vitrine en ligne'
export const ELLIPSE = '…'
export const PAYS_DEFAUT_LOCALE = 'FR'

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
}
export const NOINDEX_LIEN_BIO: DirectiveRobots = 'noindex, follow'

// ---------------------------------------------------------------------------
// robots.txt et politique des robots d'IA
// ---------------------------------------------------------------------------

export const ROBOTS_DISALLOW = ['/studio', '/onboarding', '/connexion', '/desabonnement', '/api/'] as const
export const ROBOTS_ALLOW = ['/'] as const
export const ROBOTS_USER_AGENT_TOUS = '*'
export const ROBOTS_IA_POLITIQUES = ['recherche_seulement', 'tout_autoriser'] as const
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
export const OG_IMAGE_DEFAUT = '/og/brandself-partage.jpg'
export const OG_LOGO = '/og/brandself-logo.png'
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
      { title: 'Tarifs', href: '/tarifs', description: 'Les offres et les prix de Brandself.' },
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
  return `${v.metier} à ${v.ville}`
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
  return [titreService, v.nomAffiche, v.ville].join(SEPARATEUR_TITRE)
}

/** `{réalisation} — {nomAffiche}`. */
export function construireTitreRealisation(titreRealisation: string, v: Pick<SeoVitrineIdentite, 'nomAffiche'>): string {
  return `${titreRealisation}${SEPARATEUR_TITRE}${v.nomAffiche}`
}

/** `seoDescription` saisie ; sinon `{metier} à {ville} ({pays}).` + accroche (ou bio) ; sinon gabarit. Jamais vide. */
export function construireDescriptionVitrine(v: SeoVitrineSource): string {
  const saisie = renseigne(v.seoDescription)
  if (saisie) return tronquerDescription(saisie)
  const texte = renseigne(v.accroche) ?? renseigne(v.bio)
  if (texte) return tronquerDescription(`${lieuMetier(v)} (${v.paysLibelle}). ${texte}`)
  return tronquerDescription(`${v.nomAffiche}, ${lieuMetier(v)} (${v.paysLibelle}).`)
}

export interface SeoElementSource {
  titre: string
  description?: string | null
  seoDescription?: string | null
}

/** Description saisie, sinon description du service tronquée, sinon `{service} avec {nomAffiche}, {metier} à {ville}.` */
export function construireDescriptionService(s: SeoElementSource, v: SeoVitrineIdentite): string {
  const texte = renseigne(s.seoDescription) ?? renseigne(s.description)
  if (texte) return tronquerDescription(texte)
  return tronquerDescription(`${s.titre} avec ${v.nomAffiche}, ${lieuMetier(v)}.`)
}

/** Description saisie, sinon description de la réalisation tronquée, sinon `{réalisation}, réalisation de {nomAffiche}, {metier} à {ville}.` */
export function construireDescriptionRealisation(r: SeoElementSource, v: SeoVitrineIdentite): string {
  const texte = renseigne(r.seoDescription) ?? renseigne(r.description)
  if (texte) return tronquerDescription(texte)
  return tronquerDescription(`${r.titre}, réalisation de ${v.nomAffiche}, ${lieuMetier(v)}.`)
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

/** Chemin canonique (minuscules, sans barre finale, sans query) ou `null` si non applicable / déjà canonique. */
export function cheminCanonique(path: string): string | null {
  const propre = sansQuery(path)
  const segments = segmentsDe(propre)
  const [premier] = segments
  if (premier === undefined || !estSegmentVitrine(premier)) return null
  if ((segments[segments.length - 1] ?? '').includes('.')) return null
  const canonique = `/${segments.join('/').toLowerCase()}`
  return canonique === propre ? null : canonique
}
