import type { TransactionalEmailType } from '../../../shared/jobs'
import { SUJET_LIBELLES } from '../../../shared/message'
import type { SujetMessage } from '../../../shared/message'
import { TITRES, displayName } from '../../../shared/vitrine'
import type { Titre } from '../../../shared/vitrine'
import { buildReservationIcs } from '../agenda-ics'
import {
  TEXTES_NOTIFICATIONS,
  buildUtilisateurEmail,
  formatJour,
  formatJourComplet,
  formatHeure,
  joinUrl,
  pied,
  singleLine,
} from './notifications-contenus'
import type { UtilisateurEmailContent } from './notifications-contenus'
import type { EmailAttachment, EmailMessage } from './transport'

export type { UtilisateurEmailContent } from './notifications-contenus'

// Le rappel visiteur (S9) n'a ni pièce jointe ni statut ICS : il a son propre type de contenu.
type ReservationEmailType = Exclude<Extract<TransactionalEmailType, `reservation_${string}`>, 'reservation_visiteur_rappel'>
type DemandeEmailType = Extract<TransactionalEmailType, `demande_${string}`>
type MessageEmailType = Extract<TransactionalEmailType, `message_${string}`>

interface EmailVitrine {
  titre: string | null
  prenom: string
  nom: string
  metier: string
  ville: string | null
  fuseau: string
}

interface EmailVisiteur {
  nom: string
  email: string
  telephone: string | null
  motif: string | null
}

interface ServiceEmailInfo {
  titre: string
  dureeMin: number | null
  tarif: string
  prixMontant: number | null
  prixDevise: string | null
  paiementInstructions: string | null
}

interface BaseEmailContent {
  outboxId: string
  generatedAt: Date
  professionnelEmail: string
  vitrine: EmailVitrine
  visiteur: EmailVisiteur
}

/** S9 : rappel envoyé au visiteur avant son rendez-vous (texte seul, sans ICS, sans désabonnement). */
export interface RappelVisiteurContent extends BaseEmailContent {
  type: 'reservation_visiteur_rappel'
  vitrine: EmailVitrine & { username: string }
  service: ServiceEmailInfo
  reservation: {
    id: string
    debut: Date
    fin: Date
    paiementChoisi: string
  }
  /** URL publique du site (`NUXT_PUBLIC_SITE_URL`), lue par l'appelant : le contenu est pur. */
  siteUrl: string
}

// S7-bis : le contenu d'un email de message n'a pas de service (la page Contact n'en
// mentionne pas) ; les réservations et demandes portent le leur. Le visiteur d'un
// message peut être sans téléphone (facultatif).
export type TransactionalEmailContent = RappelVisiteurContent | UtilisateurEmailContent | BaseTransactionalEmailContent

type BaseTransactionalEmailContent = BaseEmailContent & (
  | {
      type: ReservationEmailType
      service: ServiceEmailInfo
      reservation: {
        id: string
        debut: Date
        fin: Date
        paiementChoisi: string
      }
      demande?: never
      message?: never
    }
  | {
      type: DemandeEmailType
      service: ServiceEmailInfo
      demande: { id: string }
      reservation?: never
      message?: never
    }
  | {
      type: MessageEmailType
      service?: never
      demande?: never
      reservation?: never
      message: {
        id: string
        nom: string
        email: string
        telephone: string | null
        sujet: SujetMessage
        texte: string
      }
    }
)

function asTitre(value: string | null): Titre | null {
  return TITRES.find((titre) => titre === value) ?? null
}

function professionalName(content: BaseEmailContent): string {
  return singleLine(displayName(asTitre(content.vitrine.titre), content.vitrine.prenom, content.vitrine.nom))
}

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(date)
}

function formatPrice(service: ServiceEmailInfo): string {
  const { prixDevise, prixMontant, tarif } = service
  if (tarif === 'gratuit') return 'Gratuit'
  if (tarif === 'devis') return 'Sur devis'
  if (prixMontant === null || prixDevise === null) return 'Payant'
  const amount = prixDevise === 'XAF' ? prixMontant : prixMontant / 100
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount)} ${prixDevise}`
}

function paymentLines(service: ServiceEmailInfo, paiementChoisi?: string): string[] {
  const lines = [`Tarif : ${formatPrice(service)}`]
  if (paiementChoisi === 'sur_place') lines.push('Règlement : sur place')
  if (service.paiementInstructions) lines.push(`Instructions : ${service.paiementInstructions}`)
  return lines
}

function reservationRecap(content: Extract<TransactionalEmailContent, { type: ReservationEmailType }>): string[] {
  return [
    `Service : ${content.service.titre}`,
    `Professionnel : ${professionalName(content)}`,
    `Date : ${formatDate(content.reservation.debut, content.vitrine.fuseau)}`,
    ...(content.service.dureeMin === null ? [] : [`Durée : ${content.service.dureeMin} minutes`]),
    ...(content.vitrine.ville ? [`Lieu : ${content.vitrine.ville}`] : []),
    ...paymentLines(content.service, content.reservation.paiementChoisi),
  ]
}

function demandeRecap(content: Extract<TransactionalEmailContent, { type: DemandeEmailType }>): string[] {
  return [
    `Service : ${content.service.titre}`,
    `Professionnel : ${professionalName(content)}`,
    ...(content.vitrine.ville ? [`Ville : ${content.vitrine.ville}`] : []),
    ...paymentLines(content.service),
  ]
}

function addIcsStatus(ics: string, status: 'TENTATIVE' | 'CONFIRMED'): string {
  const marker = 'END:VEVENT\r\n'
  if (!ics.includes(marker)) throw new Error('ICS_INVALIDE')
  return ics.replace(marker, `STATUS:${status}\r\n${marker}`)
}

function reservationAttachment(
  content: Extract<TransactionalEmailContent, { type: ReservationEmailType }>,
): EmailAttachment {
  // Annulation ET refus (S7-bis) : le visiteur tient un événement TENTATIVE depuis
  // l'email de réception — le retrait du créneau retire l'événement de son agenda.
  const cancelled = content.type === 'reservation_visiteur_annulee' || content.type === 'reservation_visiteur_refusee'
  const confirmed = content.type === 'reservation_visiteur_confirmee'
  const method = cancelled ? 'CANCEL' : 'REQUEST'
  let ics = buildReservationIcs({
    reservationId: content.reservation.id,
    sequence: cancelled ? 2 : confirmed ? 1 : 0,
    method,
    generatedAt: content.generatedAt,
    debut: content.reservation.debut,
    fin: content.reservation.fin,
    serviceTitle: content.service.titre,
    location: content.vitrine.ville ?? '',
  })
  if (!cancelled) ics = addIcsStatus(ics, confirmed ? 'CONFIRMED' : 'TENTATIVE')
  return {
    filename: 'reservation.ics',
    content: Buffer.from(ics, 'utf8'),
    contentType: `text/calendar; charset=utf-8; method=${method}`,
  }
}

function visitorReservationEmail(
  content: Extract<TransactionalEmailContent, { type: ReservationEmailType }>,
  subject: string,
  introduction: string,
): EmailMessage {
  return {
    to: content.visiteur.email,
    subject,
    text: [
      'Bonjour,',
      '',
      introduction,
      '',
      ...reservationRecap(content),
      '',
      'À bientôt,',
      'Brandself',
    ].join('\n'),
    attachments: [reservationAttachment(content)],
  }
}

function rappelVisiteurRecap(content: RappelVisiteurContent): string[] {
  const { service, vitrine, reservation } = content
  return [
    `Service : ${singleLine(service.titre)}`,
    `Professionnel : ${professionalName(content)}`,
    `Date : ${formatJourComplet(reservation.debut, vitrine.fuseau)}`,
    ...(service.dureeMin === null ? [] : [`Durée : ${service.dureeMin} minutes`]),
    ...(vitrine.ville ? [`Lieu : ${singleLine(vitrine.ville)}`] : []),
    `Tarif : ${formatPrice(service)}`,
    ...(reservation.paiementChoisi === 'sur_place' ? ['Règlement : sur place'] : []),
  ]
}

/**
 * S9 §5.1 : rappel au visiteur. Minimisation (#100) : ni motif ni téléphone ; pas de « demain »
 * (le rattrapage peut le rendre faux) ; pas d'ICS (l'événement existe déjà dans son agenda) ; pas
 * de List-Unsubscribe (le visiteur l'a demandé pour CE rendez-vous).
 */
function rappelVisiteurEmail(content: RappelVisiteurContent): EmailMessage {
  const { debut } = content.reservation
  const { fuseau, username } = content.vitrine
  const professionnel = professionalName(content)
  return {
    to: content.visiteur.email,
    subject: `Rappel : votre rendez-vous du ${formatJour(debut, fuseau)} à ${formatHeure(debut, fuseau)}`,
    text: [
      'Bonjour,',
      '',
      `Petit rappel : votre rendez-vous avec ${professionnel} approche.`,
      '',
      ...rappelVisiteurRecap(content),
      '',
      `Un empêchement ? Prévenez ${professionnel} dès que possible depuis sa vitrine :`,
      joinUrl(content.siteUrl, `/${username}`),
      '',
      'À bientôt,',
      TEXTES_NOTIFICATIONS.signatureMarque,
      ...pied([TEXTES_NOTIFICATIONS.pied.rappelVisiteur(professionnel)]),
    ].join('\n'),
    attachments: [],
  }
}

export function buildTransactionalEmail(content: TransactionalEmailContent): EmailMessage {
  switch (content.type) {
    case 'reservation_visiteur_rappel':
      return rappelVisiteurEmail(content)
    case 'utilisateur_rappel_journee':
    case 'utilisateur_resume_hebdo':
      return buildUtilisateurEmail(content)
    case 'reservation_professionnel_nouvelle':
      return {
        to: content.professionnelEmail,
        subject: 'Nouvelle réservation reçue',
        text: [
          'Bonjour,',
          '',
          'Vous avez reçu une nouvelle demande de réservation.',
          '',
          ...reservationRecap(content),
          `Visiteur : ${singleLine(content.visiteur.nom)}`,
          `Email : ${content.visiteur.email}`,
          ...(content.visiteur.telephone ? [`Téléphone : ${content.visiteur.telephone}`] : []),
          ...(content.visiteur.motif ? [`Motif : ${content.visiteur.motif}`] : []),
          '',
          'Connectez-vous à votre studio pour la confirmer.',
          '',
          'Brandself',
        ].join('\n'),
        attachments: [],
      }
    case 'reservation_visiteur_recue':
      return visitorReservationEmail(
        content,
        'Votre demande de réservation a bien été reçue',
        'Votre demande a bien été transmise. Elle est en attente de confirmation.',
      )
    case 'reservation_visiteur_confirmee':
      return visitorReservationEmail(
        content,
        'Votre réservation est confirmée',
        'Votre réservation est confirmée. Nous vous attendons avec plaisir.',
      )
    case 'reservation_visiteur_annulee':
      return visitorReservationEmail(
        content,
        'Votre réservation a été annulée',
        'Votre réservation a été annulée. Vous pouvez reprendre rendez-vous depuis la vitrine.',
      )
    case 'reservation_visiteur_refusee':
      // Refus sans blâme : le créneau demandé n'a pas pu être confirmé, un autre est possible.
      return visitorReservationEmail(
        content,
        'Votre demande n’a pas pu être confirmée',
        'Votre demande n’a pas pu être confirmée. Vous pouvez choisir un autre créneau sur la vitrine.',
      )
    case 'demande_professionnel_nouvelle':
      return {
        to: content.professionnelEmail,
        subject: 'Nouvelle demande reçue',
        text: [
          'Bonjour,',
          '',
          'Vous avez reçu une nouvelle demande.',
          '',
          ...demandeRecap(content),
          `Visiteur : ${singleLine(content.visiteur.nom)}`,
          `Email : ${content.visiteur.email}`,
          ...(content.visiteur.telephone ? [`Téléphone : ${content.visiteur.telephone}`] : []),
          ...(content.visiteur.motif ? [`Motif : ${content.visiteur.motif}`] : []),
          '',
          'Répondez directement au visiteur lorsque vous êtes disponible.',
          '',
          'Brandself',
        ].join('\n'),
        attachments: [],
      }
    case 'demande_visiteur_recue':
      return {
        to: content.visiteur.email,
        subject: 'Votre demande a bien été reçue',
        text: [
          'Bonjour,',
          '',
          'Votre demande a bien été transmise au professionnel.',
          '',
          ...demandeRecap(content),
          '',
          'Vous recevrez sa réponse directement.',
          '',
          'À bientôt,',
          'Brandself',
        ].join('\n'),
        attachments: [],
      }
    case 'message_professionnel_nouvelle':
      return messageProfessionnelEmail(content)
  }
}

/** S7-bis : le texte du visiteur est transmis tel quel (email texte pur, jamais de HTML). */
function messageProfessionnelEmail(
  content: Extract<TransactionalEmailContent, { type: MessageEmailType }>,
): EmailMessage {
  const sujetLibelle = SUJET_LIBELLES[content.message.sujet]
  return {
    to: content.professionnelEmail,
    subject: `Nouveau message de ${singleLine(content.message.nom)} — ${sujetLibelle}`,
    text: [
      'Bonjour,',
      '',
      'Vous avez reçu un nouveau message depuis votre vitrine.',
      '',
      `De : ${singleLine(content.message.nom)}`,
      `Email : ${content.message.email}`,
      ...(content.message.telephone ? [`Téléphone : ${content.message.telephone}`] : []),
      `Sujet : ${sujetLibelle}`,
      '',
      content.message.texte,
      '',
      'Vous pouvez répondre directement à votre visiteur depuis votre messagerie.',
      '',
      'Brandself',
    ].join('\n'),
    attachments: [],
  }
}
