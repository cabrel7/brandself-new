// S9 (docs/specs/S9-notifications.md §3.5) : message de partage prêt à envoyer. Pur.

export const PARTAGE_WHATSAPP_BASE = 'https://wa.me/?text='
export const PARTAGE_LINKEDIN_BASE = 'https://www.linkedin.com/sharing/share-offsite/?url='

/** Un métier commençant par un acronyme (deux majuscules : « ORL », « IT ») garde sa casse. */
const ACRONYME_REGEX = /^\p{Lu}{2}/u

export interface ShareMessageInput {
  prenom: string
  metier: string
  url: string
  /** La vitrine propose la réservation d'un rendez-vous. */
  reservable: boolean
}

function metierEnMinuscule(metier: string): string {
  const net = metier.trim()
  if (net === '' || ACRONYME_REGEX.test(net)) return net
  return net.charAt(0).toLocaleLowerCase('fr-FR') + net.slice(1)
}

export function buildShareMessage(input: ShareMessageInput): string {
  const presentation = `Bonjour, je suis ${input.prenom.trim()}, ${metierEnMinuscule(input.metier)}.`
  const contenu = input.reservable
    ? 'vous y trouverez mes services et vous pouvez réserver un rendez-vous directement.'
    : 'vous y trouverez mes services et mes réalisations.'
  return `${presentation} Ma vitrine est en ligne : ${contenu} ${input.url}`
}

export function whatsappShareUrl(message: string): string {
  return `${PARTAGE_WHATSAPP_BASE}${encodeURIComponent(message)}`
}

/** LinkedIn n'accepte que l'URL : seul l'URL est encodée. */
export function linkedinShareUrl(url: string): string {
  return `${PARTAGE_LINKEDIN_BASE}${encodeURIComponent(url)}`
}
