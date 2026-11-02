// Constantes, libellés et règles pures des liens d'une vitrine (S6). Source unique partagée
// par le serveur (validation, construction d'URL) et l'interface (studio, page de liens, pied).
// Les libellés de type sont recopiés dans le CHECK de la migration 0007 : garder synchronisé.

export const LIEN_TYPES = ['libre', 'whatsapp', 'reseau', 'email', 'telephone', 'vitrine'] as const
export type LienType = (typeof LIEN_TYPES)[number]

/** Libellé du type, tel qu'affiché sous le lien dans le studio (« WhatsApp · 15 clics »). */
export const LIEN_TYPE_LIBELLES: Record<LienType, string> = {
  libre: 'Lien libre',
  whatsapp: 'WhatsApp',
  reseau: 'Réseau social',
  email: 'Courriel',
  telephone: 'Téléphone',
  vitrine: 'Page de votre vitrine',
}

export interface LienReseau {
  id: string
  libelle: string
  /** Icône Phosphor (CLAUDE.md règle d'interface : une seule famille). */
  icone: string
  /** Domaines acceptés pour vérifier la cohérence plateforme/URL. */
  domaines: readonly string[]
}

export const LIEN_RESEAUX: readonly LienReseau[] = [
  { id: 'linkedin', libelle: 'LinkedIn', icone: 'i-ph-linkedin-logo', domaines: ['linkedin.com', 'lnkd.in'] },
  { id: 'instagram', libelle: 'Instagram', icone: 'i-ph-instagram-logo', domaines: ['instagram.com', 'instagr.am'] },
  { id: 'facebook', libelle: 'Facebook', icone: 'i-ph-facebook-logo', domaines: ['facebook.com', 'fb.me'] },
  { id: 'x', libelle: 'X (Twitter)', icone: 'i-ph-x-logo', domaines: ['x.com', 'twitter.com'] },
  { id: 'tiktok', libelle: 'TikTok', icone: 'i-ph-tiktok-logo', domaines: ['tiktok.com'] },
  { id: 'youtube', libelle: 'YouTube', icone: 'i-ph-youtube-logo', domaines: ['youtube.com', 'youtu.be'] },
]

export function findLienReseau(id: string): LienReseau | undefined {
  return LIEN_RESEAUX.find((reseau) => reseau.id === id)
}

/** Icône d'un réseau connu, sinon l'icône générique du lien. */
export function iconeReseau(plateforme: string | null): string {
  return (plateforme ? findLienReseau(plateforme)?.icone : undefined) ?? 'i-ph-link-simple'
}

/** Libellé d'un réseau connu, sinon son identifiant. */
export function libelleReseau(plateforme: string): string {
  return findLienReseau(plateforme)?.libelle ?? plateforme
}

export interface LienVitrinePage {
  id: string
  libelle: string
  /** Chemin relatif ajouté après `/username`. */
  chemin: string
}

/** Page de repli si l'identifiant est inconnu : l'accueil. */
const PAGE_DEFAUT: LienVitrinePage = { id: 'accueil', libelle: 'Accueil de votre vitrine', chemin: '' }

/** Pages internes atteignables par un lien de type `vitrine` (« accueil, services, réserver… »). */
export const LIEN_VITRINE_PAGES: readonly LienVitrinePage[] = [
  PAGE_DEFAUT,
  { id: 'services', libelle: 'Vos services', chemin: '/services' },
  { id: 'realisations', libelle: 'Vos réalisations', chemin: '/realisations' },
  { id: 'reserver', libelle: 'Prendre rendez-vous', chemin: '/agenda' },
]

export function findLienVitrinePage(id: string): LienVitrinePage | undefined {
  return LIEN_VITRINE_PAGES.find((page) => page.id === id)
}

/** Bornes des champs d'un lien. */
export const LIEN_LIBELLE_MAX = 100
export const LIEN_URL_MAX = 2000
export const LIEN_ADRESSE_MAX = 254
/** Numéro international : 6 à 15 chiffres (recommandation E.164, sans les séparateurs). */
export const LIEN_NUMERO_CHIFFRES_MIN = 6
export const LIEN_NUMERO_CHIFFRES_MAX = 15

/** Garde le signe « + » initial et les chiffres ; retire espaces, tirets, parenthèses et points. */
export function normaliserNumero(numero: string): string {
  const signe = numero.startsWith('+') ? '+' : ''
  return signe + numero.replace(/[^0-9]/g, '')
}

/** Chiffres du numéro, sans le signe international. */
function chiffresNumero(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

/**
 * Les champs propres à chaque type de lien (ceux du formulaire) : le type fixé à la
 * création détermine lesquels sont acceptés (cohérence type/champs).
 */
export const LIEN_CHAMPS_PAR_TYPE: Record<LienType, readonly ('url' | 'numero' | 'adresse' | 'plateforme' | 'page')[]> = {
  libre: ['url'],
  whatsapp: ['numero'],
  reseau: ['plateforme', 'url'],
  email: ['adresse'],
  telephone: ['numero'],
  vitrine: ['page'],
}

export interface LienSource {
  type: LienType
  username: string
  /** Champs du formulaire ; le type détermine celui qui compte. */
  url?: string
  numero?: string
  adresse?: string
  plateforme?: string
  page?: string
}

/**
 * URL finale du lien, TOUJOURS construite côté serveur pour les types construits :
 * `https://wa.me/<chiffres>`, `mailto:<adresse>`, `tel:<numéro normalisé>`,
 * `/<username><chemin>` pour une page interne. Les types `libre` et `reseau` passent
 * une URL https validée telle quelle (jamais `javascript:` ni autre schéma).
 */
export function construireUrlLien(source: LienSource): string {
  switch (source.type) {
    case 'libre':
      return source.url ?? ''
    case 'reseau':
      return source.url ?? ''
    case 'whatsapp':
      return `https://wa.me/${chiffresNumero(source.numero ?? '')}`
    case 'email':
      return `mailto:${source.adresse ?? ''}`
    case 'telephone':
      return `tel:${normaliserNumero(source.numero ?? '')}`
    case 'vitrine': {
      const page = findLienVitrinePage(source.page ?? '') ?? PAGE_DEFAUT
      return `/${source.username}${page.chemin}`
    }
  }
}

/** Hôte d'une URL (sans « www. »), ou null si l'URL est mal formée. */
export function hoteUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** La plateforme dont un des domaines correspond à l'hôte de l'URL. */
export function plateformeDepuisUrl(url: string): string | null {
  const hote = hoteUrl(url)
  if (!hote) return null
  const reseau = LIEN_RESEAUX.find((candidat) => candidat.domaines.some((domaine) => hote === domaine || hote.endsWith(`.${domaine}`)))
  return reseau?.id ?? null
}

/** La cohérence plateforme/URL est imposée à la création et à la modification (icône du pied). */
export function verifierReseauUrl(url: string, plateforme: string): boolean {
  return plateformeDepuisUrl(url) === plateforme
}

export const ICON_LIEN = 'i-ph-link-simple'

/** Numéro E.164 extrait d'un lien wa.me (pré-remplissage du formulaire de modification). */
export function numeroDepuisWhatsappUrl(url: string): string {
  return chiffresNumero(url.replace(/^https?:\/\/wa\.me\//, ''))
}

/** Adresse extraite d'un lien mailto (pré-remplissage du formulaire de modification). */
export function adresseDepuisMailtoUrl(url: string): string {
  return url.replace(/^mailto:/, '')
}

/** Numéro normalisé extrait d'un lien tel (pré-remplissage du formulaire de modification). */
export function numeroDepuisTelUrl(url: string): string {
  return url.replace(/^tel:/, '')
}

/** Identifiant de page interne extrait d'un lien relatif `/username<chemin>` (pré-remplissage). */
export function pageDepuisVitrineUrl(username: string, url: string): string | null {
  if (!url.startsWith('/')) return null

  let suffixe: string
  if (username) {
    const racine = `/${username}`
    if (url !== racine && !url.startsWith(`${racine}/`)) return null
    suffixe = url.slice(racine.length)
  }
  else {
    const segments = url.split('/').filter(Boolean)
    if (segments.length === 0) return null
    suffixe = segments.length === 1 ? '' : `/${segments.slice(1).join('/')}`
  }

  const page = LIEN_VITRINE_PAGES.find((candidate) => candidate.chemin === suffixe)
  return page?.id ?? null
}
