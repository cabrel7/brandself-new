// Sécurité d'affichage des e-mails : échappement HTML, nettoyage des caractères de contrôle et
// construction d'URL de même origine. TypeScript pur (tourne sous tsx dans le worker).

export const ERREUR_URL_INTERDITE = 'URL_EMAIL_INTERDITE'

const ENTITES_HTML: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const CARACTERES_A_ECHAPPER = /[&<>"']/g
/** Marques de direction du texte (U+202A-202E, U+2066-2069, LRM/RLM U+200E-200F, ALM U+061C) et séparateurs de ligne Unicode. */
const BIDI_ET_SEPARATEURS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/gu
const CARACTERES_DE_CONTROLE = /\p{Cc}/gu
const CONTROLE_SAUF_SAUT = /(?!\n)\p{Cc}/gu

/** Échappe & < > " ' : à appliquer à TOUT ce qui entre dans le HTML, attributs compris. */
export function echapperHtml(valeur: string): string {
  return valeur.replaceAll(CARACTERES_A_ECHAPPER, (caractere) => ENTITES_HTML[caractere] ?? caractere)
}

/**
 * Retire les caractères de contrôle et les marques bidirectionnelles. La tabulation devient une espace ;
 * le saut de ligne (\n) est conservé (le retour chariot est retiré : CRLF devient LF).
 */
export function nettoyerAffichage(valeur: string): string {
  return valeur
    .replaceAll('\t', ' ')
    .replaceAll(BIDI_ET_SEPARATEURS, '')
    .replaceAll(CONTROLE_SAUF_SAUT, '')
}

/** Nettoyage pour une valeur d'une seule ligne (objet, en-têtes) : aucun saut de ligne ne subsiste. */
export function nettoyerLigne(valeur: string): string {
  return nettoyerAffichage(valeur).replaceAll(CARACTERES_DE_CONTROLE, ' ').replaceAll(/\s*\n\s*/g, ' ').trim()
}

/** Origine (http ou https seulement) d'une URL de site ; lève URL_EMAIL_INTERDITE sinon. */
function origineDuSite(siteUrl: string): string {
  let url: URL
  try {
    url = new URL(siteUrl)
  }
  catch {
    throw new Error(ERREUR_URL_INTERDITE)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(ERREUR_URL_INTERDITE)
  return url.origin
}

type ParametresUrl = Readonly<Record<string, string | number>>

/**
 * URL absolue sur l'origine du site : chemin obligatoirement relatif à la racine (`/…`), segments et
 * paramètres encodés, ancre explicite (paramètre dédié, jamais déduite du chemin).
 */
export function urlEmail(siteUrl: string, chemin: string, query?: ParametresUrl, ancre?: string): string {
  const origine = origineDuSite(siteUrl)
  if (!chemin.startsWith('/')) throw new Error(ERREUR_URL_INTERDITE)
  const segments = chemin.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const entrees = Object.entries(query ?? {})
  const parametres = entrees.map(([cle, valeur]) => `${encodeURIComponent(cle)}=${encodeURIComponent(String(valeur))}`).join('&')
  const fragment = ancre ? `#${encodeURIComponent(ancre)}` : ''
  return `${origine}${segments}${parametres ? `?${parametres}` : ''}${fragment}`
}

/** Vérifie qu'une URL déjà construite est http(s), sans identifiants, sur la MÊME origine que le site. */
export function verifierUrlEmail(siteUrl: string, url: string): string {
  const origine = origineDuSite(siteUrl)
  if (/[\s\p{Cc}]/u.test(url)) throw new Error(ERREUR_URL_INTERDITE)
  let analysee: URL
  try {
    analysee = new URL(url)
  }
  catch {
    throw new Error(ERREUR_URL_INTERDITE)
  }
  const [protocole] = url.split(':')
  const identifiants = analysee.username !== '' || analysee.password !== ''
  if (analysee.origin !== origine || identifiants || !/^https?$/i.test(protocole ?? '')) throw new Error(ERREUR_URL_INTERDITE)
  return url
}
