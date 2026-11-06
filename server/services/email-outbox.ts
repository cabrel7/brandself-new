import { randomUUID } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import { and, asc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import { TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import {
  abonnements,
  demandes,
  emailsTransactionnels,
  messages,
  paiements,
  reservations,
  services,
  users,
  vitrines,
} from '../../shared/db/schema'
import { env } from '../../shared/env'
import { isValidTimeZone } from '../../shared/fuseau'
import {
  TRANSACTIONAL_EMAIL_BACKOFF_MS,
  TRANSACTIONAL_EMAIL_MAX_ATTEMPTS,
  TRANSACTIONAL_EMAIL_TYPES,
} from '../../shared/jobs'
import type { TransactionalEmailType } from '../../shared/jobs'
import { SUJETS_MESSAGE } from '../../shared/message'
import type { SujetMessage } from '../../shared/message'
import {
  RAPPEL_JOURNEE_STATUTS,
  RESUME_PERIODE_JOURS,
  SUGGESTION_RESUME_DEFAUT,
} from '../../shared/notifications'
import type { CodeAnnulation, EmailCategorie, PreferenceEmail } from '../../shared/notifications'
import { ABONNEMENT_FUSEAU_REPLI, PERIODES_MOIS } from '../../shared/plans'
import type { PeriodeMois } from '../../shared/plans'
import { getMoyenPaiement } from '../config/paiements'
import { db } from '../utils/db'
import { signUnsubscribeToken } from './desabonnement'
import { buildTransactionalEmail } from './emails/contenus'
import type { TransactionalEmailContent } from './emails/contenus'
import type { RendezVousJournee } from './emails/notifications-contenus'
import {
  EmailTransportError,
  transactionalEmailTransport,
} from './emails/transport'
import type { EmailTransport } from './emails/transport'
import { choisirSuggestion, compterActivite } from './notifications/activite'
import { debutSemaineIso, journeeLocale, periodeResume } from './notifications/fenetres'
import { analyserOccurrenceRappel, evaluerPertinence } from './notifications/pertinence'
import { getCompteursResume } from './statistiques'

const PROCESSING_LEASE_MS = 60_000
const OUTBOX_BATCH_SIZE = 100
const IDEMPOTENCY_KEY_PREFIX = 'brandself-email-'
/** Clé d'occurrence des e-mails ponctuels (S7) : une seule ligne par (entité, type). */
const OCCURRENCE_VIDE = ''

type TransactionCallback = Parameters<typeof db.transaction>[0]
export type DbTransaction = Parameters<TransactionCallback>[0]
export type EmailEntityType = 'reservation' | 'demande' | 'message' | 'utilisateur' | 'abonnement' | 'paiement'
export type EmailOutboxRow = typeof emailsTransactionnels.$inferSelect

// Les e-mails planifiés (S9) ont leurs propres chargeurs : le rappel visiteur n'a ni pièce jointe ni ICS.
type ReservationEmailType = Exclude<Extract<TransactionalEmailType, `reservation_${string}`>, 'reservation_visiteur_rappel'>
type DemandeEmailType = Extract<TransactionalEmailType, `demande_${string}`>
type MessageEmailType = Extract<TransactionalEmailType, `message_${string}`>

export class EmailOutboxProcessingError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'EmailOutboxProcessingError'
    this.code = code
  }
}

function isTransactionalEmailType(value: string): value is TransactionalEmailType {
  return (TRANSACTIONAL_EMAIL_TYPES as readonly string[]).includes(value)
}

function isReservationEmailType(value: TransactionalEmailType): value is ReservationEmailType {
  return value.startsWith('reservation_') && value !== 'reservation_visiteur_rappel'
}

function isDemandeEmailType(value: TransactionalEmailType): value is DemandeEmailType {
  return value.startsWith('demande_')
}

function isMessageEmailType(value: TransactionalEmailType): value is MessageEmailType {
  return value.startsWith('message_')
}

function assertEventMatchesEntity(type: TransactionalEmailType, entiteType: EmailEntityType): void {
  if (!type.startsWith(`${entiteType}_`)) throw new EmailOutboxProcessingError('OUTBOX_INCOHERENTE')
}

/**
 * Événements immédiats (S7) : une ligne par (entité, type), clé d'occurrence vide. La cible d'`ON CONFLICT`
 * comporte les 4 colonnes de l'index unique (migration 0020) : l'ancienne cible à 3 colonnes échoue en 42P10.
 * `disponibleLe` fixe l'instant d'envoi (l'horloge de l'appelant) ; sans lui, la base pose `now()`.
 */
export async function insertTransactionalEmailEvents(
  tx: DbTransaction,
  entiteType: EmailEntityType,
  entiteId: string,
  types: readonly TransactionalEmailType[],
  disponibleLe?: Date,
): Promise<void> {
  if (types.length === 0) return
  for (const type of types) assertEventMatchesEntity(type, entiteType)
  await tx
    .insert(emailsTransactionnels)
    .values(types.map((type) => ({
      id: randomUUID(),
      type,
      entiteType,
      entiteId,
      occurrence: OCCURRENCE_VIDE,
      ...(disponibleLe ? { prochaineTentative: disponibleLe } : {}),
    })))
    .onConflictDoNothing({
      target: [
        emailsTransactionnels.entiteType,
        emailsTransactionnels.entiteId,
        emailsTransactionnels.type,
        emailsTransactionnels.occurrence,
      ],
    })
}

/** E-mail planifié (S9) : `occurrence` est la clé d'idempotence métier, `prochaineTentative` l'heure d'envoi. */
export interface ScheduledEmailEvent {
  entiteType: EmailEntityType
  entiteId: string
  type: TransactionalEmailType
  occurrence: string
  prochaineTentative: Date
  categorie: EmailCategorie
  /** Instant de création de la ligne (le rattrapage se mesure depuis lui) ; défaut : `now()` de la base. */
  creeLe?: Date
}

/** Insère des e-mails planifiés ; une occurrence déjà présente est ignorée. Renvoie le nombre de lignes créées. */
export async function insertScheduledEmailEvents(
  tx: DbTransaction,
  events: readonly ScheduledEmailEvent[],
): Promise<number> {
  if (events.length === 0) return 0
  for (const event of events) {
    assertEventMatchesEntity(event.type, event.entiteType)
    if (event.occurrence === OCCURRENCE_VIDE) throw new EmailOutboxProcessingError('OUTBOX_INCOHERENTE')
  }
  const inserted = await tx
    .insert(emailsTransactionnels)
    .values(events.map((event) => ({
      id: randomUUID(),
      type: event.type,
      entiteType: event.entiteType,
      entiteId: event.entiteId,
      occurrence: event.occurrence,
      categorie: event.categorie,
      prochaineTentative: event.prochaineTentative,
      ...(event.creeLe ? { createdAt: event.creeLe, updatedAt: event.creeLe } : {}),
    })))
    .onConflictDoNothing({
      target: [
        emailsTransactionnels.entiteType,
        emailsTransactionnels.entiteId,
        emailsTransactionnels.type,
        emailsTransactionnels.occurrence,
      ],
    })
    .returning({ id: emailsTransactionnels.id })
  return inserted.length
}

/** Insère un e-mail planifié ; `false` si cette occurrence existait déjà (rejeu, deux passes). */
export async function insertScheduledEmailEvent(tx: DbTransaction, event: ScheduledEmailEvent): Promise<boolean> {
  return (await insertScheduledEmailEvents(tx, [event])) > 0
}

/**
 * Annule, dans la transaction de l'appelant, les lignes `en_attente` d'une entité et d'un type (annulation d'un
 * rendez-vous). Une ligne déjà prise par un worker (`en_cours`) est laissée à la revalidation de l'envoi.
 */
export async function cancelPendingEmailEvents(
  tx: DbTransaction,
  cible: { entiteType: EmailEntityType, entiteId: string, type: TransactionalEmailType },
  code: CodeAnnulation,
  now: Date,
): Promise<number> {
  const cancelled = await tx
    .update(emailsTransactionnels)
    .set({ statut: 'annule', erreurCode: code, prochaineTentative: null, updatedAt: now })
    .where(and(
      eq(emailsTransactionnels.entiteType, cible.entiteType),
      eq(emailsTransactionnels.entiteId, cible.entiteId),
      eq(emailsTransactionnels.type, cible.type),
      eq(emailsTransactionnels.statut, 'en_attente'),
    ))
    .returning({ id: emailsTransactionnels.id })
  return cancelled.length
}

/** Destinataire d'un compte professionnel : l'e-mail du compte s'il est réel, sinon l'e-mail de contact, sinon `null`. */
export function resolveRecipient(emailContact: string | null, accountEmail: string): string | null {
  if (!accountEmail.toLowerCase().endsWith(`@${TEMP_EMAIL_DOMAIN}`)) return accountEmail
  const contact = emailContact?.trim()
  return contact || null
}

function professionalRecipient(emailContact: string | null, accountEmail: string): string {
  const recipient = resolveRecipient(emailContact, accountEmail)
  if (recipient === null) throw new EmailOutboxProcessingError('DESTINATAIRE_ABSENT')
  return recipient
}

async function loadReservationContent(
  row: EmailOutboxRow,
  type: ReservationEmailType,
): Promise<TransactionalEmailContent> {
  const [result] = await db
    .select({
      reservation: {
        id: reservations.id,
        nom: reservations.nom,
        email: reservations.email,
        telephone: reservations.telephone,
        note: reservations.note,
        debut: reservations.debut,
        fin: reservations.fin,
        paiementChoisi: reservations.paiementChoisi,
      },
      service: {
        titre: services.titre,
        dureeMin: services.dureeMin,
        tarif: services.tarif,
        prixMontant: services.prixMontant,
        prixDevise: services.prixDevise,
        paiementInstructions: services.paiementInstructions,
      },
      vitrine: {
        titre: vitrines.titre,
        prenom: vitrines.prenom,
        nom: vitrines.nom,
        metier: vitrines.metier,
        ville: vitrines.ville,
        fuseau: vitrines.fuseau,
        emailContact: vitrines.emailContact,
      },
      accountEmail: users.email,
    })
    .from(reservations)
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .innerJoin(users, eq(users.id, vitrines.userId))
    .where(eq(reservations.id, row.entiteId))
    .limit(1)
  if (!result) throw new EmailOutboxProcessingError('ENTITE_INTROUVABLE')

  return {
    type,
    outboxId: row.id,
    generatedAt: row.createdAt,
    professionnelEmail: professionalRecipient(result.vitrine.emailContact, result.accountEmail),
    vitrine: result.vitrine,
    service: result.service,
    visiteur: {
      nom: result.reservation.nom,
      email: result.reservation.email,
      telephone: result.reservation.telephone,
      motif: result.reservation.note,
    },
    reservation: {
      id: result.reservation.id,
      debut: result.reservation.debut,
      fin: result.reservation.fin,
      paiementChoisi: result.reservation.paiementChoisi,
    },
  }
}

async function loadDemandeContent(
  row: EmailOutboxRow,
  type: DemandeEmailType,
): Promise<TransactionalEmailContent> {
  const [result] = await db
    .select({
      demande: {
        id: demandes.id,
        nom: demandes.nom,
        email: demandes.email,
        telephone: demandes.telephone,
        message: demandes.message,
      },
      service: {
        titre: services.titre,
        dureeMin: services.dureeMin,
        tarif: services.tarif,
        prixMontant: services.prixMontant,
        prixDevise: services.prixDevise,
        paiementInstructions: services.paiementInstructions,
      },
      vitrine: {
        titre: vitrines.titre,
        prenom: vitrines.prenom,
        nom: vitrines.nom,
        metier: vitrines.metier,
        ville: vitrines.ville,
        fuseau: vitrines.fuseau,
        emailContact: vitrines.emailContact,
      },
      accountEmail: users.email,
    })
    .from(demandes)
    .innerJoin(services, eq(services.id, demandes.serviceId))
    .innerJoin(vitrines, eq(vitrines.id, demandes.vitrineId))
    .innerJoin(users, eq(users.id, vitrines.userId))
    .where(eq(demandes.id, row.entiteId))
    .limit(1)
  if (!result) throw new EmailOutboxProcessingError('ENTITE_INTROUVABLE')

  return {
    type,
    outboxId: row.id,
    generatedAt: row.createdAt,
    professionnelEmail: professionalRecipient(result.vitrine.emailContact, result.accountEmail),
    vitrine: result.vitrine,
    service: result.service,
    visiteur: {
      nom: result.demande.nom,
      email: result.demande.email,
      telephone: result.demande.telephone,
      motif: result.demande.message,
    },
    demande: { id: result.demande.id },
  }
}

async function loadMessageContent(
  row: EmailOutboxRow,
  type: MessageEmailType,
): Promise<TransactionalEmailContent> {
  const [result] = await db
    .select({
      message: {
        id: messages.id,
        nom: messages.nom,
        email: messages.email,
        telephone: messages.telephone,
        sujet: messages.sujet,
        texte: messages.message,
      },
      vitrine: {
        titre: vitrines.titre,
        prenom: vitrines.prenom,
        nom: vitrines.nom,
        metier: vitrines.metier,
        ville: vitrines.ville,
        fuseau: vitrines.fuseau,
        emailContact: vitrines.emailContact,
      },
      accountEmail: users.email,
    })
    .from(messages)
    .innerJoin(vitrines, eq(vitrines.id, messages.vitrineId))
    .innerJoin(users, eq(users.id, vitrines.userId))
    .where(eq(messages.id, row.entiteId))
    .limit(1)
  if (!result) throw new EmailOutboxProcessingError('ENTITE_INTROUVABLE')
  const sujet = sujetDeMessage(result.message.sujet)

  return {
    type,
    outboxId: row.id,
    generatedAt: row.createdAt,
    professionnelEmail: professionalRecipient(result.vitrine.emailContact, result.accountEmail),
    vitrine: result.vitrine,
    visiteur: {
      nom: result.message.nom,
      email: result.message.email,
      telephone: result.message.telephone,
      motif: null,
    },
    message: {
      id: result.message.id,
      nom: result.message.nom,
      email: result.message.email,
      telephone: result.message.telephone,
      sujet,
      texte: result.message.texte,
    },
  }
}

function sujetDeMessage(value: string): SujetMessage {
  if ((SUJETS_MESSAGE as readonly string[]).includes(value)) return value as SujetMessage
  throw new EmailOutboxProcessingError('SUJET_MESSAGE_INCONNU')
}

/**
 * Résultat de la préparation d'un envoi : soit le contenu à envoyer, soit le code d'annulation (la ligne n'est
 * plus pertinente : aucun envoi, aucun nouvel essai).
 */
type Preparation =
  | { annule: CodeAnnulation }
  | { contenu: TransactionalEmailContent }

/** S9 §4.4 : rappel au visiteur. Les faits sont lus en une requête, puis jugés par `evaluerPertinence` (pure). */
async function prepareRappelVisiteur(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  const [result] = await db
    .select({
      reservation: {
        id: reservations.id,
        statut: reservations.statut,
        rappelEmail: reservations.rappelEmail,
        nom: reservations.nom,
        email: reservations.email,
        debut: reservations.debut,
        fin: reservations.fin,
        paiementChoisi: reservations.paiementChoisi,
      },
      service: {
        titre: services.titre,
        dureeMin: services.dureeMin,
        tarif: services.tarif,
        prixMontant: services.prixMontant,
        prixDevise: services.prixDevise,
        paiementInstructions: services.paiementInstructions,
      },
      vitrine: {
        username: vitrines.username,
        titre: vitrines.titre,
        prenom: vitrines.prenom,
        nom: vitrines.nom,
        metier: vitrines.metier,
        ville: vitrines.ville,
        fuseau: vitrines.fuseau,
      },
      publieeLe: vitrines.publieeLe,
    })
    .from(reservations)
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .where(eq(reservations.id, row.entiteId))
    .limit(1)

  const code = evaluerPertinence({
    type: 'reservation_visiteur_rappel',
    occurrence: row.occurrence,
    createdAt: row.createdAt,
    reservation: result
      ? {
          statut: result.reservation.statut,
          rappelEmail: result.reservation.rappelEmail,
          debut: result.reservation.debut,
          vitrinePubliee: result.publieeLe !== null,
        }
      : null,
  }, now)
  if (code !== null) return { annule: code }
  if (!result) return { annule: 'ENTITE_INTROUVABLE' }

  return {
    contenu: {
      type: 'reservation_visiteur_rappel',
      outboxId: row.id,
      generatedAt: row.createdAt,
      // Le rappel s'adresse au visiteur : l'adresse du professionnel n'est ni lue ni transmise.
      professionnelEmail: '',
      vitrine: result.vitrine,
      service: result.service,
      // Minimisation (#100) : ni téléphone ni motif dans le contenu du rappel.
      visiteur: { nom: result.reservation.nom, email: result.reservation.email, telephone: null, motif: null },
      reservation: {
        id: result.reservation.id,
        debut: result.reservation.debut,
        fin: result.reservation.fin,
        paiementChoisi: result.reservation.paiementChoisi,
      },
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
    },
  }
}

interface FaitsUtilisateur {
  id: string
  fuseau: string
  prenom: string
  emailHebdo: boolean
  emailRappelJour: boolean
  vitrineId: string | null
  vitrinePubliee: boolean
  destinataire: string | null
}

async function loadFaitsUtilisateur(userId: string): Promise<FaitsUtilisateur | null> {
  const [result] = await db
    .select({
      id: users.id,
      email: users.email,
      fuseau: users.fuseau,
      emailHebdo: users.email_hebdo,
      emailRappelJour: users.email_rappel_jour,
      vitrineId: vitrines.id,
      prenom: vitrines.prenom,
      publieeLe: vitrines.publieeLe,
      emailContact: vitrines.emailContact,
    })
    .from(users)
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1)
  if (!result) return null
  return {
    id: result.id,
    fuseau: result.fuseau,
    prenom: result.prenom ?? '',
    emailHebdo: result.emailHebdo,
    emailRappelJour: result.emailRappelJour,
    vitrineId: result.vitrineId,
    vitrinePubliee: result.vitrineId !== null && result.publieeLe !== null,
    destinataire: resolveRecipient(result.emailContact, result.email),
  }
}

/** Journée locale de l'occurrence (`AAAA-MM-JJ`) dans le fuseau COURANT du compte ; `null` si l'un des deux est invalide. */
function journeeDeLOccurrence(occurrence: string, fuseau: string): ReturnType<typeof journeeLocale> | null {
  try {
    return journeeLocale(Temporal.PlainDate.from(occurrence).toZonedDateTime(fuseau))
  } catch {
    return null
  }
}

async function loadRendezVousJournee(
  vitrineId: string,
  journee: { debut: Date, fin: Date },
): Promise<RendezVousJournee[]> {
  return db
    .select({
      debut: reservations.debut,
      service: services.titre,
      visiteur: reservations.nom,
      statut: reservations.statut,
    })
    .from(reservations)
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .where(and(
      eq(reservations.vitrineId, vitrineId),
      inArray(reservations.statut, [...RAPPEL_JOURNEE_STATUTS]),
      gte(reservations.debut, journee.debut),
      lt(reservations.debut, journee.fin),
    ))
    .orderBy(asc(reservations.debut), asc(reservations.id))
}

function instantVersDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds)
}

/** S9 §4.4 : rendez-vous du jour. La journée est recalculée dans le fuseau courant du compte. */
async function prepareRappelJournee(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  const faits = await loadFaitsUtilisateur(row.entiteId)
  const journee = faits ? journeeDeLOccurrence(row.occurrence, faits.fuseau) : null
  const bornes = journee ? { debut: instantVersDate(journee.debut), fin: instantVersDate(journee.fin) } : null
  const rendezVous = faits?.vitrineId && bornes ? await loadRendezVousJournee(faits.vitrineId, bornes) : []

  const code = evaluerPertinence({
    type: 'utilisateur_rappel_journee',
    occurrence: row.occurrence,
    createdAt: row.createdAt,
    utilisateur: faits
      ? {
          emailRappelJour: faits.emailRappelJour,
          destinataire: faits.destinataire !== null,
          rendezVousDansJournee: rendezVous.length,
        }
      : null,
  }, now)
  if (code !== null) return { annule: code }
  if (!faits || faits.destinataire === null || !bornes) return { annule: 'ENTITE_INTROUVABLE' }

  const preference: PreferenceEmail = 'email_rappel_jour'
  return {
    contenu: {
      type: 'utilisateur_rappel_journee',
      outboxId: row.id,
      generatedAt: row.createdAt,
      destinataire: faits.destinataire,
      prenom: faits.prenom,
      fuseau: faits.fuseau,
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
      jetonDesabonnement: signUnsubscribeToken(faits.id, preference, now),
      jour: bornes.debut,
      rendezVous,
    },
  }
}

/** S9 §4.4 : résumé hebdomadaire. La période se calcule depuis la création de la ligne, dans le fuseau courant. */
async function prepareResumeHebdo(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  const faits = await loadFaitsUtilisateur(row.entiteId)
  const code = evaluerPertinence({
    type: 'utilisateur_resume_hebdo',
    occurrence: row.occurrence,
    createdAt: row.createdAt,
    utilisateur: faits
      ? { emailHebdo: faits.emailHebdo, vitrinePubliee: faits.vitrinePubliee, destinataire: faits.destinataire !== null }
      : null,
  }, now)
  if (code !== null) return { annule: code }
  if (!faits || faits.destinataire === null || faits.vitrineId === null) return { annule: 'ENTITE_INTROUVABLE' }

  let local: Temporal.ZonedDateTime
  try {
    local = Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()).toZonedDateTimeISO(faits.fuseau)
  } catch {
    throw new EmailOutboxProcessingError('FUSEAU_INVALIDE')
  }
  const periode = periodeResume(local)
  const lundi = debutSemaineIso(local)
  const finSemaineSuivante = lundi
    .toZonedDateTimeISO(faits.fuseau)
    .add({ days: RESUME_PERIODE_JOURS })
    .startOfDay()
    .toInstant()
  const bornes = { debut: instantVersDate(periode.debut), fin: instantVersDate(periode.fin) }
  const semaineSuivante = { debut: instantVersDate(lundi), fin: instantVersDate(finSemaineSuivante) }
  const compteurs = await compterActivite(faits.vitrineId, bornes, semaineSuivante)
  // S11 #186 : visites et clics réels sur la période (lignes omises seulement si le suivi est absent).
  const visiteurs = await getCompteursResume(faits.vitrineId, faits.fuseau, bornes)
  const avecActivite = compteurs.reservations + compteurs.demandes + compteurs.messages > 0
  // La suggestion n'est lue que si le résumé en a besoin (aucune activité).
  const suggestion = avecActivite ? { ...SUGGESTION_RESUME_DEFAUT } : await choisirSuggestion(faits.id)

  const preference: PreferenceEmail = 'email_hebdo'
  return {
    contenu: {
      type: 'utilisateur_resume_hebdo',
      outboxId: row.id,
      generatedAt: row.createdAt,
      destinataire: faits.destinataire,
      prenom: faits.prenom,
      fuseau: faits.fuseau,
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
      jetonDesabonnement: signUnsubscribeToken(faits.id, preference, now),
      periode: bornes,
      compteurs: { ...compteurs, ...visiteurs },
      suggestion,
    },
  }
}

/** Fuseau d'affichage d'un compte : le sien s'il est valide, sinon le repli (un fuseau invalide ne bloque pas un e-mail de service). */
function fuseauAffichage(fuseau: string): string {
  return isValidTimeZone(fuseau) ? fuseau : ABONNEMENT_FUSEAU_REPLI
}

function estPeriodeMois(valeur: number): valeur is PeriodeMois {
  return (PERIODES_MOIS as readonly number[]).includes(valeur)
}

/** S10 #122 : rappel d'échéance. Les faits (échéance courante, destinataire) sont jugés par `evaluerPertinence`. */
async function prepareRappelAbonnement(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  const [result] = await db
    .select({
      expireLe: abonnements.expireLe,
      fuseau: users.fuseau,
      email: users.email,
      prenom: vitrines.prenom,
      emailContact: vitrines.emailContact,
      dernierePeriode: paiements.periodeMois,
    })
    .from(abonnements)
    .innerJoin(users, eq(users.id, abonnements.userId))
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .leftJoin(paiements, eq(paiements.id, abonnements.dernierPaiementId))
    .where(eq(abonnements.id, row.entiteId))
    .limit(1)

  const destinataire = result ? resolveRecipient(result.emailContact, result.email) : null
  const code = evaluerPertinence({
    type: 'abonnement_rappel',
    occurrence: row.occurrence,
    createdAt: row.createdAt,
    abonnement: result ? { expireLe: result.expireLe, destinataire: destinataire !== null } : null,
  }, now)
  if (code !== null) return { annule: code }
  const rappel = analyserOccurrenceRappel(row.occurrence)
  if (!result || destinataire === null || rappel === null) return { annule: 'ENTITE_INTROUVABLE' }

  // Lien de renouvellement : la dernière période payée est présélectionnée (repli : la plus courte).
  const derniere = result.dernierePeriode
  const periodeMois = derniere !== null && estPeriodeMois(derniere) ? derniere : PERIODES_MOIS[0]
  return {
    contenu: {
      type: 'abonnement_rappel',
      outboxId: row.id,
      generatedAt: row.createdAt,
      destinataire,
      prenom: result.prenom ?? '',
      fuseau: fuseauAffichage(result.fuseau),
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
      jours: rappel.jours,
      expireLe: result.expireLe,
      periodeMois,
    },
  }
}

/** S10 #123 : reçu d'un paiement. Le numéro n'existe qu'en version masquée en base ; il n'est jamais reconstitué. */
async function preparePaiementConfirme(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  const [result] = await db
    .select({
      id: paiements.id,
      statut: paiements.statut,
      fournisseur: paiements.fournisseur,
      methode: paiements.methode,
      operateur: paiements.operateur,
      referenceFournisseur: paiements.referenceFournisseur,
      periodeMois: paiements.periodeMois,
      devise: paiements.devise,
      montant: paiements.montant,
      telephoneMasque: paiements.telephoneMasque,
      abonnementExpireApres: paiements.abonnementExpireApres,
      userId: users.id,
      email: users.email,
      fuseau: users.fuseau,
      prenom: vitrines.prenom,
      emailContact: vitrines.emailContact,
    })
    .from(paiements)
    .leftJoin(users, eq(users.id, paiements.userId))
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .where(eq(paiements.id, row.entiteId))
    .limit(1)

  const destinataire = result?.email ? resolveRecipient(result.emailContact, result.email) : null
  const code = evaluerPertinence({
    type: 'paiement_confirme',
    occurrence: row.occurrence,
    createdAt: row.createdAt,
    paiement: result
      ? { statut: result.statut, utilisateurPresent: result.userId !== null, destinataire: destinataire !== null }
      : null,
  }, now)
  if (code !== null) return { annule: code }
  if (!result || destinataire === null || result.fuseau === null) return { annule: 'ENTITE_INTROUVABLE' }

  return {
    contenu: {
      type: 'paiement_confirme',
      outboxId: row.id,
      generatedAt: row.createdAt,
      destinataire,
      prenom: result.prenom ?? '',
      fuseau: fuseauAffichage(result.fuseau),
      siteUrl: env.NUXT_PUBLIC_SITE_URL,
      reference: result.id,
      referenceFournisseur: result.referenceFournisseur,
      montant: result.montant,
      devise: result.devise,
      periodeMois: result.periodeMois,
      // Libellé du catalogue (« MTN MoMo ») ; un moyen retiré du catalogue ne casse pas le reçu.
      moyenLibelle: result.operateur === null ? null : (getMoyenPaiement(`${result.fournisseur}:${result.operateur}`)?.libelle ?? null),
      telephoneMasque: result.telephoneMasque,
      nouvelleEcheance: result.abonnementExpireApres,
    },
  }
}

async function prepareEmail(row: EmailOutboxRow, now: Date): Promise<Preparation> {
  if (!isTransactionalEmailType(row.type)) throw new EmailOutboxProcessingError('TYPE_EMAIL_INCONNU')
  assertEventMatchesEntity(row.type, row.entiteType as EmailEntityType)
  if (row.type === 'abonnement_rappel') return prepareRappelAbonnement(row, now)
  if (row.type === 'paiement_confirme') return preparePaiementConfirme(row, now)
  if (row.type === 'reservation_visiteur_rappel') return prepareRappelVisiteur(row, now)
  if (row.type === 'utilisateur_rappel_journee') return prepareRappelJournee(row, now)
  if (row.type === 'utilisateur_resume_hebdo') return prepareResumeHebdo(row, now)
  if (isReservationEmailType(row.type)) return { contenu: await loadReservationContent(row, row.type) }
  if (isDemandeEmailType(row.type)) return { contenu: await loadDemandeContent(row, row.type) }
  if (isMessageEmailType(row.type)) return { contenu: await loadMessageContent(row, row.type) }
  throw new EmailOutboxProcessingError('TYPE_EMAIL_INCONNU')
}

type ClaimResult =
  | { kind: 'claimed', row: EmailOutboxRow }
  | { kind: 'already-sent' }
  | { kind: 'cancelled' }
  | { kind: 'terminal' }
  | { kind: 'processing' }
  | { kind: 'not-yet' }

async function claimOutbox(id: string, now: Date): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(emailsTransactionnels)
      .where(eq(emailsTransactionnels.id, id))
      .for('update')
    if (!row) throw new EmailOutboxProcessingError('OUTBOX_INTROUVABLE')
    if (row.statut === 'envoye') return { kind: 'already-sent' }
    if (row.statut === 'annule') return { kind: 'cancelled' }
    if (row.statut === 'echec' || row.tentatives >= TRANSACTIONAL_EMAIL_MAX_ATTEMPTS) {
      return { kind: 'terminal' }
    }
    if (row.statut === 'en_cours' && now.getTime() - row.updatedAt.getTime() < PROCESSING_LEASE_MS) {
      return { kind: 'processing' }
    }
    // Garde-fou d'échéance : une ligne mise en file avant l'heure prévue (rappel planifié, attente d'un essai
    // suivant) ne part jamais trop tôt. Ni essai compté, ni écriture.
    if (row.statut === 'en_attente' && row.prochaineTentative !== null && row.prochaineTentative.getTime() > now.getTime()) {
      return { kind: 'not-yet' }
    }

    const [claimed] = await tx
      .update(emailsTransactionnels)
      .set({
        statut: 'en_cours',
        tentatives: sql`${emailsTransactionnels.tentatives} + 1`,
        prochaineTentative: null,
        erreurCode: null,
        updatedAt: now,
      })
      .where(eq(emailsTransactionnels.id, id))
      .returning()
    if (!claimed) throw new EmailOutboxProcessingError('OUTBOX_INTROUVABLE')
    return { kind: 'claimed', row: claimed }
  })
}

function safeErrorCode(error: unknown): string {
  if (error instanceof EmailTransportError || error instanceof EmailOutboxProcessingError) return error.code
  return 'ENVOI_INCONNU'
}

async function markFailed(row: EmailOutboxRow, errorCode: string, now: Date): Promise<void> {
  const terminal = row.tentatives >= TRANSACTIONAL_EMAIL_MAX_ATTEMPTS
  const delay = TRANSACTIONAL_EMAIL_BACKOFF_MS * 2 ** Math.max(0, row.tentatives - 1)
  await db
    .update(emailsTransactionnels)
    .set({
      statut: terminal ? 'echec' : 'en_attente',
      prochaineTentative: terminal ? null : new Date(now.getTime() + delay),
      erreurCode: errorCode,
      updatedAt: now,
    })
    .where(eq(emailsTransactionnels.id, row.id))
}

/** Ligne devenue non pertinente : état terminal `annule` avec son code, sans nouvel essai. */
async function markCancelled(row: EmailOutboxRow, code: CodeAnnulation, now: Date): Promise<void> {
  await db
    .update(emailsTransactionnels)
    .set({ statut: 'annule', prochaineTentative: null, erreurCode: code, updatedAt: now })
    .where(and(eq(emailsTransactionnels.id, row.id), eq(emailsTransactionnels.statut, 'en_cours')))
}

export type ProcessTransactionalEmailResult = {
  statut: 'envoye' | 'deja_envoye' | 'echec_terminal' | 'en_cours' | 'annule' | 'pas_encore'
}

/**
 * Flux d'envoi : claim (verrou de ligne, bail, essais) -> revalidation (`evaluerPertinence`) -> chargement et
 * construction du contenu -> envoi -> `envoye`. Une ligne non pertinente passe à `annule` sans envoi.
 */
export async function processTransactionalEmail(
  id: string,
  transport: EmailTransport = transactionalEmailTransport,
  now: Date = new Date(),
): Promise<ProcessTransactionalEmailResult> {
  const claim = await claimOutbox(id, now)
  if (claim.kind === 'already-sent') return { statut: 'deja_envoye' }
  if (claim.kind === 'cancelled') return { statut: 'annule' }
  if (claim.kind === 'terminal') return { statut: 'echec_terminal' }
  if (claim.kind === 'processing') return { statut: 'en_cours' }
  if (claim.kind === 'not-yet') return { statut: 'pas_encore' }

  try {
    const preparation = await prepareEmail(claim.row, now)
    if ('annule' in preparation) {
      await markCancelled(claim.row, preparation.annule, now)
      return { statut: 'annule' }
    }
    const message = buildTransactionalEmail(preparation.contenu)
    await transport.send(message, `${IDEMPOTENCY_KEY_PREFIX}${claim.row.id}`)
    const [sent] = await db
      .update(emailsTransactionnels)
      .set({
        statut: 'envoye',
        prochaineTentative: null,
        erreurCode: null,
        envoyeLe: now,
        updatedAt: now,
      })
      .where(eq(emailsTransactionnels.id, claim.row.id))
      .returning({ id: emailsTransactionnels.id })
    if (!sent) throw new EmailOutboxProcessingError('OUTBOX_INTROUVABLE')
    return { statut: 'envoye' }
  }
  catch (error) {
    const code = safeErrorCode(error)
    try {
      await markFailed(claim.row, code, now)
    }
    catch {
      throw new EmailOutboxProcessingError('OUTBOX_MARQUAGE_ECHEC')
    }
    throw new EmailOutboxProcessingError(code)
  }
}

export async function listDispatchableTransactionalEmailIds(now: Date = new Date()): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS)
  const rows = await db
    .select({ id: emailsTransactionnels.id })
    .from(emailsTransactionnels)
    .where(or(
      and(
        eq(emailsTransactionnels.statut, 'en_attente'),
        lte(emailsTransactionnels.prochaineTentative, now),
      ),
      and(
        eq(emailsTransactionnels.statut, 'en_cours'),
        lte(emailsTransactionnels.updatedAt, staleBefore),
      ),
    ))
    .orderBy(asc(emailsTransactionnels.prochaineTentative), asc(emailsTransactionnels.createdAt))
    .limit(OUTBOX_BATCH_SIZE)
  return rows.map(({ id }) => id)
}
