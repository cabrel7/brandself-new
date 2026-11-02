import type { TransactionalEmailType } from '../../../shared/jobs'
import { SUJET_LIBELLES } from '../../../shared/message'
import type { SujetMessage } from '../../../shared/message'
import { TITRES, displayName } from '../../../shared/vitrine'
import type { Titre } from '../../../shared/vitrine'
import { buildReservationIcs } from '../agenda-ics'
import type { EmailAttachment, EmailMessage } from './transport'

type ReservationEmailType = Extract<TransactionalEmailType, `reservation_${string}`>
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

// S7-bis : le contenu d'un email de message n'a pas de service (la page Contact n'en
// mentionne pas) ; les réservations et demandes portent le leur. Le visiteur d'un
// message peut être sans téléphone (facultatif).
export type TransactionalEmailContent = BaseEmailContent & (
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

// Défense en profondeur : une valeur saisie par un visiteur et placée dans l'objet ou sur
// une ligne d'un email ne peut jamais contenir de saut de ligne ni de caractère de contrôle.
function singleLine(value: string): string {
  return value.replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()
}

function asTitre(value: string | null): Titre | null {
  return TITRES.find((titre) => titre === value) ?? null
}

function professionalName(content: BaseEmailContent): string {
  return displayName(asTitre(content.vitrine.titre), content.vitrine.prenom, content.vitrine.nom)
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

export function buildTransactionalEmail(content: TransactionalEmailContent): EmailMessage {
  switch (content.type) {
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
