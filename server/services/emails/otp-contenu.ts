import { MARQUE } from '../../../shared/brand'
import { rendreEmail } from './gabarit'
import type { DocumentEmail } from './gabarit'
import type { EmailMessage } from './transport'

export interface OtpEmailInput {
  destinataire: string
  code: string
  /** Durée de validité du code, en minutes (affichée dans le texte). */
  dureeMinutes: number
  /** URL publique du site (lien du logotype dans le HTML). */
  siteUrl: string
}

export const ERREUR_OTP_CODE_INVALIDE = 'OTP_CODE_INVALIDE'
/** Code de connexion : exactement six chiffres ASCII. */
const CODE_OTP = /^\d{6}$/
const TEXTES_OTP = {
  libelleCode: 'Votre code de connexion',
  cloture: 'À tout de suite,',
  avertissement: 'Ne communiquez ce code à personne.',
} as const

function minutes(n: number): string {
  return `${n} minute${n > 1 ? 's' : ''}`
}

/**
 * Contenu pur de l'e-mail de code de connexion : aucun accès réseau, base ou configuration.
 * Le code n'apparaît ni dans l'objet ni dans le préheader (aperçu visible dans la boîte de réception).
 */
export function buildOtpEmail(input: OtpEmailInput): EmailMessage {
  const { destinataire, code, dureeMinutes, siteUrl } = input
  if (!CODE_OTP.test(code)) throw new Error(ERREUR_OTP_CODE_INVALIDE)
  const duree = minutes(dureeMinutes)
  const document: DocumentEmail = {
    objet: `Votre code de connexion ${MARQUE.nom}`,
    preheader: `Valable ${duree}. ${TEXTES_OTP.avertissement}`,
    siteUrl,
    identite: { type: 'plateforme' },
    salutation: 'Bonjour,',
    elements: [
      { type: 'code', libelle: TEXTES_OTP.libelleCode, code },
      { type: 'encadre', texte: `Il est valable ${duree}. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.` },
    ],
    cloture: TEXTES_OTP.cloture,
    pied: null,
  }
  const { subject, text, html } = rendreEmail(document)
  return { to: destinataire, subject, text, html, attachments: [] }
}
