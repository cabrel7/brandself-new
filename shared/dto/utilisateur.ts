import type { Devise, Locale } from '../compte'

export interface MoiDTO {
  id: string
  /** null si l'email est du domaine temporaire (compte créé par téléphone). */
  email: string | null
  telephone: string | null
  locale: Locale
  devise: Devise
  fuseau: string
  /** Résumé hebdomadaire du lundi. */
  emailHebdo: boolean
  /** E-mail du matin avec les rendez-vous du jour. */
  emailRappelJour: boolean
  aUneVitrine: boolean
  vitrine: { username: string, publiee: boolean } | null
}

export interface AppareilDTO {
  id: string
  /** 256 caractères au maximum. */
  userAgent: string | null
  creeLe: string
  derniereActivite: string
  expireLe: string
  actuel: boolean
}
