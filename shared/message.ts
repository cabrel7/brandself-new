import { CONTACT_EMAIL_MAX, CONTACT_NOM_MAX } from './agenda'

// S7-bis — domaine « Messages » : sujets du formulaire de contact (les 4 valeurs
// tranchées par le client le 2026-10-31) et bornes du formulaire. Les limites
// transversales (nom, email) restent définies dans shared/agenda.ts : rien n'est dupliqué.

export const SUJETS_MESSAGE = [
  'question_avant_reservation',
  'demande_information',
  'suivi_reservation',
  'autre',
] as const
export type SujetMessage = (typeof SUJETS_MESSAGE)[number]

export const SUJET_LIBELLES: Record<SujetMessage, string> = {
  question_avant_reservation: 'Une question avant de réserver',
  demande_information: 'Une demande d’information',
  suivi_reservation: 'Le suivi d’une réservation',
  autre: 'Autre',
}

export const MESSAGE_MAX = 1000
/** Plafond dur de la liste du studio : les plus récents d'abord (le compteur de non lus reste global). */
export const MESSAGES_LISTE_MAX = 200
export const MESSAGE_NOM_MAX = CONTACT_NOM_MAX
export const MESSAGE_EMAIL_MAX = CONTACT_EMAIL_MAX
/** Garde-fou d'affichage : un E.164 valide tient en 16 caractères, la borne reste souple. */
export const MESSAGE_TELEPHONE_MAX = 20

/** Données d'un message de contact, après validation Zod ; le téléphone facultatif est absent ou null. */
export interface MessageCreateInput {
  nom: string
  email: string
  telephone?: string | null
  sujet: SujetMessage
  message: string
}
