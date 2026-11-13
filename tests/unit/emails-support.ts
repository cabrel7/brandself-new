import type { Palette } from '../../shared/palettes'
import type { DocumentEmail, ElementEmail, IdentiteEmail } from '../../server/services/emails/gabarit/document'

// Aides des tests du gabarit d'e-mail HTML (décision #26). Pas un test : `*.test.ts` seuls sont collectés.
//
// CONTRAT SUPPOSÉ (le brief nomme les types d'éléments, pas leurs champs ; à confirmer par le backend, une seule
// définition ci-dessous) :
//   titre          { type, texte }                     HTML seul (h1/h2) ; AUCUNE ligne dans le texte (le texte actuel n'a pas de titre)
//   paragraphe     { type, texte }                     texte : la ligne telle quelle
//   texteSaisi     { type, texte }                     texte du visiteur : verbatim dans le texte, lignes échappées jointes par <br> en HTML
//   code           { type, libelle, code }             texte : `${libelle} : ${code}`
//   recapitulatif  { type, lignes: [{ libelle, valeur }] }  texte : `${libelle} : ${valeur}` par ligne ; HTML : table à 2 colonnes
//   liste          { type, lignes: string[] }          texte : `• ${ligne}` par ligne
//   bouton         { type, libelle, url, lignesTexte } texte : lignesTexte ; l'URL DOIT y figurer (LIEN_ABSENT_DU_TEXTE)
//   encadre        { type, texte, url?, lignesTexte? } texte : lignesTexte ?? [texte] ; si `url`, elle DOIT figurer dans ces lignes
//   LignePied      { texte, url? }                     texte : `texte` ; si `url`, elle DOIT figurer dans `texte`
// Texte : salutation, '', blocs séparés par une ligne vide, '', cloture (si non nulle), signature `jesuis.pro` (TOUJOURS,
// pour les deux identités : le texte des e-mails au visiteur reste identique à l'actuel), puis, si `pied`, '', '—', lignes.
// HTML : chaque élément a pour racine une balise portant `data-element="<type>"` (crochet de testabilité).

export const SITE = 'https://jesuis.pro'
export const SITE_DEV = 'http://localhost:3000'

export const ACCENTS: Readonly<Record<Palette, string>> = {
  terracotta: '#B4532F',
  sauge: '#3F6B4F',
  indigo: '#3B3F8C',
  ocre: '#946409',
  bordeaux: '#8A2F45',
}
export const SUR_ACCENT = '#FFFFFF'
export const COULEUR_POINT_LOGO = '#C1512A'

export const IDENTITE_PLATEFORME: IdentiteEmail = { type: 'plateforme' }

export function identitePro(palette: Palette, surcharge: Partial<Extract<IdentiteEmail, { type: 'professionnel' }>> = {}): IdentiteEmail {
  return {
    type: 'professionnel',
    nom: 'Dr Cabrel Nguesso',
    metier: 'Cardiologue',
    palette,
    vitrineUrl: `${SITE}/dr-cabrel`,
    ...surcharge,
  }
}

export function docSimple(surcharge: Partial<DocumentEmail> = {}): DocumentEmail {
  return {
    objet: 'Votre réservation est confirmée',
    preheader: 'Votre rendez-vous est confirmé.',
    siteUrl: SITE,
    identite: IDENTITE_PLATEFORME,
    salutation: 'Bonjour,',
    elements: [{ type: 'paragraphe', texte: 'Votre réservation est confirmée. Nous vous attendons avec plaisir.' }],
    cloture: 'À bientôt,',
    pied: null,
    ...surcharge,
  }
}

export const URL_AGENDA = `${SITE}/dr-cabrel/agenda`
export const URL_COMPTE = `${SITE}/studio/compte`

/** Document contenant UN élément de chaque type, un bouton, deux lignes de pied dont une avec lien. */
export function docRiche(identite: IdentiteEmail = IDENTITE_PLATEFORME, siteUrl = SITE): DocumentEmail {
  const agenda = `${siteUrl}/dr-cabrel/agenda`
  const compte = `${siteUrl}/studio/compte`
  const elements: ElementEmail[] = [
    { type: 'titre', texte: 'Votre réservation' },
    { type: 'paragraphe', texte: 'Votre demande a bien été transmise.' },
    { type: 'texteSaisi', texte: 'Bonjour,\nJe voudrais un créneau samedi.' },
    { type: 'code', libelle: 'Votre code de connexion', code: '123456' },
    { type: 'recapitulatif', lignes: [{ libelle: 'Service', valeur: 'Consultation' }, { libelle: 'Date', valeur: 'jeudi 12 novembre 2026 à 10:00' }] },
    { type: 'liste', lignes: ['14:00 — Suivi — Paul Ewane', '15:00 — Bilan — Alice Bella'] },
    { type: 'bouton', libelle: 'Choisir un autre créneau', url: agenda, lignesTexte: ['Vous pouvez choisir un autre créneau :', agenda] },
    { type: 'encadre', texte: 'Ne communiquez ce code à personne.' },
  ]
  return docSimple({
    siteUrl,
    identite,
    elements,
    pied: [
      { texte: 'Vous recevez cet e-mail parce que vous avez réservé.' },
      { texte: `Gérer vos e-mails : ${compte}`, url: compte },
    ],
  })
}

// ---------------------------------------------------------------------------------------------
// Analyse du HTML (regex : aucune bibliothèque d'analyse HTML n'est une dépendance du projet).
// ---------------------------------------------------------------------------------------------

/** Contenu (balise ouvrante exclue) de la première balise portant `data-element="<type>"`, `null` si absente. */
export function extraireElement(html: string, type: string): string | null {
  const ouverture = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*data-element="${type}"[^>]*>`, 'i').exec(html)
  if (!ouverture) return null
  const balise = ouverture[1] as string
  const suite = html.slice(ouverture.index + ouverture[0].length)
  const jalon = new RegExp(`<(/?)${balise}\\b[^>]*>`, 'gi')
  let profondeur = 1
  for (let correspondance = jalon.exec(suite); correspondance; correspondance = jalon.exec(suite)) {
    profondeur += correspondance[1] === '/' ? -1 : 1
    if (profondeur === 0) return suite.slice(0, correspondance.index)
  }
  return suite
}

/** Balise ouvrante (texte complet) de la première balise portant `data-element="<type>"`. */
export function ouvertureElement(html: string, type: string): string | null {
  return new RegExp(`<[a-zA-Z][a-zA-Z0-9]*\\b[^>]*data-element="${type}"[^>]*>`, 'i').exec(html)?.[0] ?? null
}

/** Style en minuscules, sans espace : `Display: none ;` -> `display:none;`. */
export function styleCompact(valeur: string): string {
  return valeur.toLowerCase().replaceAll(/\s+/g, '')
}

export function tousLesHref(html: string): string[] {
  return [...html.matchAll(/\bhref\s*=\s*"([^"]*)"/gi)].map((m) => m[1] as string)
}

const ENTITES: ReadonlyArray<readonly [string, string]> = [
  ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&#x27;', "'"], ['&nbsp;', ' '], ['&amp;', '&'],
]

/** Texte lu par un humain : sans commentaires (dont conditionnels MSO), `<head>`, `<style>`, balises ; entités décodées. */
export function texteVisible(html: string): string {
  let texte = html
    .replaceAll(/<!--[\s\S]*?-->/g, ' ')
    .replaceAll(/<head[\s\S]*?<\/head>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]*>/g, ' ')
  for (const [entite, caractere] of ENTITES) texte = texte.replaceAll(entite, caractere)
  return texte.replaceAll(/\s+/g, ' ').trim()
}

/** Le HTML sans les attributs `href` (seuls endroits où une URL absolue est admise), sans doctype ni espaces de noms XML. */
export function htmlSansLiensAutorises(html: string): string {
  return html
    .replaceAll(/\bhref\s*=\s*"[^"]*"/gi, 'href=""')
    .replaceAll(/<!doctype[^>]*>/gi, '')
    .replaceAll(/\bxmlns(:\w+)?\s*=\s*"[^"]*"/gi, '')
}

// ---------------------------------------------------------------------------------------------
// Contraste WCAG 2.x
// ---------------------------------------------------------------------------------------------

const HEX_COMPOSANTES = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const SEUIL_SRGB = 0.039_28

function luminance(hex: string): number {
  const m = HEX_COMPOSANTES.exec(hex)
  if (!m) throw new Error(`Couleur hexadécimale attendue (#RRGGBB) : ${hex}`)
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => {
    const v = Number.parseInt(c as string, 16) / 255
    return v <= SEUIL_SRGB ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (clair + 0.05) / (sombre + 0.05)
}
