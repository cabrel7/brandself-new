// S11 : règles pures de statistiques — aucune dépendance serveur, testables isolément.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import { env } from '../../shared/env'
import { PAYS_FORMAT } from '../../shared/statistiques'
import { UAParser } from 'ua-parser-js'
import { isbot } from 'isbot'

/** Clé HMAC pour l'empreinte visiteur : dérivée du secret d'authentification (même motif que TELEPHONE_EMPREINTE_HKDF_INFO). */
const CLE_EMPREINTE = createHash('sha256').update(env.NUXT_BETTER_AUTH_SECRET).digest()

/**
 * Empreinte HMAC-SHA256 journalière et par vitrine.
 * `jourIso` = date civile `AAAA-MM-JJ` dans le fuseau de la vitrine.
 * Le message inclut le jour et l'id de vitrine : changer de jour ou de vitrine change l'empreinte
 * pour une même IP → le comptage quotidien est cloisonné (pas de corrélation inter-jours).
 * L'IP entre dans le message mais N'EST JAMAIS stockée.
 */
export function empreinteVisite(ip: string, vitrineId: string, jourIso: string): string {
  return createHmac('sha256', CLE_EMPREINTE).update(`${jourIso}|${vitrineId}|${ip}`).digest('hex')
}

/** Vérifie qu'une empreinte respecte le format hex64 (jamais une IP brute). */
export function estEmpreinteValide(valeur: string): boolean {
  return /^[a-f0-9]{64}$/.test(valeur)
}

function normalizeHost(hote: string): string {
  return hote.replace(/^www\./i, '')
}

/** Site de la vitrine (sans protocole, sans `www.`), utilisé pour détecter les sources internes. */
function siteOrigine(): string {
  try {
    return normalizeHost(new URL(env.NUXT_PUBLIC_SITE_URL ?? '').hostname)
  } catch {
    return ''
  }
}

export function normaliserPage(chemin: string): { type: string; identifiant: string } {
  const segments = chemin.split('/').filter((s) => s.length > 0)
  // Le premier segment est le username : il est ignoré, la vitrine cible vient du paramètre de route.
  const reste = segments.slice(1)

  // Route @[username] : le username commence par '@' → « autre ».
  if (reste.length === 0) {
    return segments.length === 1 && segments[0]!.startsWith('@') ? { type: 'autre', identifiant: '' } : { type: 'accueil', identifiant: '' }
  }

  const [premier, deuxieme] = reste
  if (!premier) return { type: 'autre', identifiant: '' }

  switch (premier) {
    case 'services':
      return reste.length === 1 ? { type: 'service', identifiant: '' } : { type: 'service', identifiant: deuxieme ?? '' }
    case 'realisations':
      return reste.length === 1 ? { type: 'realisation', identifiant: '' } : { type: 'realisation', identifiant: deuxieme ?? '' }
    case 'agenda':
      return { type: 'agenda', identifiant: '' }
    case 'contact':
      return { type: 'contact', identifiant: '' }
    case 'reserver':
      return { type: 'reservation', identifiant: deuxieme ?? '' }
    default:
      return { type: 'autre', identifiant: '' }
  }
}

export function slugValide(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
}

export type SourceStat = 'direct' | 'interne' | 'google' | 'bing' | 'duckduckgo' | 'yahoo' | 'facebook' | 'instagram' | 'linkedin' | 'twitter' | 'x' | 'youtube' | 'tiktok' | 'whatsapp' | 'telegram' | 'pinterest' | 'reddit' | 'autre'

export const SOURCES_HOTES: readonly { suffixe: string; source: SourceStat }[] = [
  { suffixe: 'google.com', source: 'google' }, { suffixe: 'google.fr', source: 'google' },
  { suffixe: 'google.co.uk', source: 'google' }, { suffixe: 'google.de', source: 'google' },
  { suffixe: 'google.cm', source: 'google' }, { suffixe: 'bing.com', source: 'bing' },
  { suffixe: 'duckduckgo.com', source: 'duckduckgo' }, { suffixe: 'yahoo.com', source: 'yahoo' },
  { suffixe: 'facebook.com', source: 'facebook' }, { suffixe: 'fb.me', source: 'facebook' },
  { suffixe: 'instagram.com', source: 'instagram' }, { suffixe: 'linkedin.com', source: 'linkedin' },
  { suffixe: 'twitter.com', source: 'twitter' }, { suffixe: 'x.com', source: 'x' },
  { suffixe: 't.co', source: 'x' }, { suffixe: 'youtube.com', source: 'youtube' },
  { suffixe: 'youtu.be', source: 'youtube' }, { suffixe: 'tiktok.com', source: 'tiktok' },
  { suffixe: 'whatsapp.com', source: 'whatsapp' }, { suffixe: 'telegram.org', source: 'telegram' },
  { suffixe: 't.me', source: 'telegram' }, { suffixe: 'pinterest.com', source: 'pinterest' },
  { suffixe: 'reddit.com', source: 'reddit' },
]

export function classifierSource(origine: string | null, cheminCourant: string, siteOrigin?: string): SourceStat {
  if (!origine || origine === cheminCourant) return 'direct'

  let hote: string
  try {
    hote = new URL(origine).hostname
  } catch {
    return 'autre'
  }

  const hoteNet = normalizeHost(hote)
  const site = siteOrigin ?? siteOrigine()
  const origineMemeDomaine = hoteNet === site
  if (origineMemeDomaine) return 'interne'

  // Liste bornée des hôtes connus, le plus long suffixe d'abord.
  for (const { suffixe, source } of SOURCES_HOTES) {
    if (hoteNet === suffixe || hoteNet.endsWith(`.${suffixe}`)) return source
  }
  return 'autre'
}

export type AppareilStat = 'mobile' | 'tablette' | 'ordinateur' | 'inconnu'

export function classifierAppareil(userAgent: string | null): AppareilStat {
  if (!userAgent) return 'inconnu'
  const resultat = UAParser(userAgent)
  const type = resultat.device?.type
  switch (type) {
    case 'mobile': return 'mobile'
    case 'tablet': return 'tablette'
    default: return 'ordinateur'
  }
}

/** Un UA absent est traité comme un robot (aucun navigateur honnête n'en envoie pas). */
export function estRobot(userAgent: string | null): boolean {
  if (!userAgent) return true
  return isbot(userAgent)
}

export const ENTETES_PAYS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as const

export function paysDepuisEntetes(headers: Record<string, string | string[] | undefined>): string | null {
  for (const entete of ENTETES_PAYS) {
    const valeur = headers[entete]
    if (typeof valeur === 'string') {
      if (PAYS_FORMAT.test(valeur)) return valeur
      return null
    }
    if (Array.isArray(valeur) && valeur.length > 0 && typeof valeur[0] === 'string' && PAYS_FORMAT.test(valeur[0])) {
      return valeur[0]
    }
  }
  return null
}

export type PeriodeStat = 7 | 30 | 90
export const PERIODES_STATISTIQUES: readonly PeriodeStat[] = [7, 30, 90]

export function periodesAutorisees(joursMax: number): PeriodeStat[] {
  return PERIODES_STATISTIQUES.filter((p) => p <= joursMax)
}

/**
 * Bornes de la période statistique dans le fuseau de la vitrine.
 * `todayLocal` = aujourd'hui (date civile) dans le fuseau de la vitrine.
 * Retourne [debut, fin] : `fin` = aujourd'hui inclus (bornes inclusives au niveau des dates civiles).
 */
export function bornesPeriodeLocale(
  periode: PeriodeStat,
  fuseau: string,
): { debut: string; fin: string } {
  const today = Temporal.Now.zonedDateTimeISO(fuseau).startOfDay()
  const fin = today.add({ days: 1 }).startOfDay().toPlainDate().toString()
  const debut = today.subtract({ days: periode - 1 }).startOfDay().toPlainDate().toString()
  return { debut, fin }
}

function hmacEgal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export { hmacEgal }
