export const PERIODES_STATISTIQUES = [7, 30, 90] as const
export type PeriodeStat = (typeof PERIODES_STATISTIQUES)[number]

export const PAGES_STAT = ['accueil', 'service', 'realisation', 'agenda', 'contact', 'reservation', 'autre'] as const
export type PageStat = (typeof PAGES_STAT)[number]
export const LIBELLES_PAGES: Record<PageStat, string> = {
  accueil: 'Accueil',
  service: 'Service',
  realisation: 'Réalisation',
  agenda: 'Agenda',
  contact: 'Contact',
  reservation: 'Réservation',
  autre: 'Autre page',
}

export const SOURCES_STAT = ['direct', 'interne', 'google', 'bing', 'duckduckgo', 'yahoo', 'facebook',
  'instagram', 'linkedin', 'twitter', 'x', 'youtube', 'tiktok', 'whatsapp', 'telegram',
  'pinterest', 'reddit', 'autre'] as const
export type SourceStat = (typeof SOURCES_STAT)[number]
export const LIBELLES_SOURCES: Record<SourceStat, string> = {
  direct: 'Accès direct', interne: 'Depuis votre vitrine', google: 'Google', bing: 'Bing',
  duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', facebook: 'Facebook', instagram: 'Instagram',
  linkedin: 'LinkedIn', twitter: 'X (Twitter)', x: 'X (Twitter)', youtube: 'YouTube',
  tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram', pinterest: 'Pinterest',
  reddit: 'Reddit', autre: 'Autre source',
}
/** Suffixes d'hôtes appariés (égalité ou fin de chaîne `.{suffixe}`), le plus long d'abord à l'usage. */
export const SOURCES_HOTES: readonly { suffixe: string, source: SourceStat }[] = [
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

export const APPAREILS_STAT = ['mobile', 'tablette', 'ordinateur', 'inconnu'] as const
export type AppareilStat = (typeof APPAREILS_STAT)[number]

/** En-tête de pays, dans l'ordre de priorité. */
export const ENTETES_PAYS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as const
export const PAYS_FORMAT = /^[A-Z]{2}$/

export const VUES_RETENTION_JOURS = 90
export const STATISTIQUES_RETENTION_JOURS = 180
export const AGGREGATION_FENETRE_JOURS = 4
export const STATISTIQUES_PAGES_MAX = 10

export const EMPREINTE_HKDF_INFO = 'brandself-statistiques-visite-v1'
export const EMPREINTE_LONGUEUR = 64
