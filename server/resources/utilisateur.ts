import { DEVISES, LOCALES, TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import type { Devise, Locale } from '../../shared/compte'
import type { AppareilDTO, MoiDTO } from '../../shared/dto'
import type { DeviceView, MeView } from '../services/utilisateurs'

const USER_AGENT_MAX = 256
const DEFAULT_LOCALE: Locale = 'fr'
const DEFAULT_DEVISE: Devise = 'XAF'
const TEMP_EMAIL_SUFFIX = `@${TEMP_EMAIL_DOMAIN}`

function asLocale(value: string): Locale {
  return LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE
}

function asDevise(value: string): Devise {
  return DEVISES.find((devise) => devise === value) ?? DEFAULT_DEVISE
}

/** Un compte créé par téléphone porte un email technique : il n'est jamais montré. */
function visibleEmail(email: string): string | null {
  return email.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX) ? null : email
}

export function toMoiResource({ user, vitrine }: MeView): MoiDTO {
  return {
    id: user.id,
    email: visibleEmail(user.email),
    telephone: user.phoneNumber,
    locale: asLocale(user.locale),
    devise: asDevise(user.devise),
    fuseau: user.fuseau,
    emailHebdo: user.email_hebdo,
    emailRappelJour: user.email_rappel_jour,
    aUneVitrine: vitrine !== null,
    vitrine: vitrine ? { username: vitrine.username, publiee: vitrine.publieeLe !== null } : null,
  }
}

/** Jamais de jeton, d'adresse IP ni d'identifiant utilisateur. */
export function toAppareilResource(device: DeviceView): AppareilDTO {
  return {
    id: device.id,
    userAgent: device.userAgent === null ? null : device.userAgent.slice(0, USER_AGENT_MAX),
    creeLe: device.createdAt.toISOString(),
    derniereActivite: device.updatedAt.toISOString(),
    expireLe: device.expiresAt.toISOString(),
    actuel: device.actuel,
  }
}
