import { randomUUID } from 'node:crypto'
import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import { TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import {
  demandes,
  emailsTransactionnels,
  messages,
  reservations,
  services,
  users,
  vitrines,
} from '../../shared/db/schema'
import {
  TRANSACTIONAL_EMAIL_BACKOFF_MS,
  TRANSACTIONAL_EMAIL_MAX_ATTEMPTS,
  TRANSACTIONAL_EMAIL_TYPES,
} from '../../shared/jobs'
import type { TransactionalEmailType } from '../../shared/jobs'
import { SUJETS_MESSAGE } from '../../shared/message'
import type { SujetMessage } from '../../shared/message'
import { db } from '../utils/db'
import { buildTransactionalEmail } from './emails/contenus'
import type { TransactionalEmailContent } from './emails/contenus'
import {
  EmailTransportError,
  transactionalEmailTransport,
} from './emails/transport'
import type { EmailTransport } from './emails/transport'

const PROCESSING_LEASE_MS = 60_000
const OUTBOX_BATCH_SIZE = 100
const IDEMPOTENCY_KEY_PREFIX = 'brandself-email-'

type TransactionCallback = Parameters<typeof db.transaction>[0]
export type DbTransaction = Parameters<TransactionCallback>[0]
export type EmailEntityType = 'reservation' | 'demande' | 'message'
export type EmailOutboxRow = typeof emailsTransactionnels.$inferSelect

type ReservationEmailType = Extract<TransactionalEmailType, `reservation_${string}`>
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
  return value.startsWith('reservation_')
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

export async function insertTransactionalEmailEvents(
  tx: DbTransaction,
  entiteType: EmailEntityType,
  entiteId: string,
  types: readonly TransactionalEmailType[],
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
    })))
    .onConflictDoNothing({
      target: [emailsTransactionnels.entiteType, emailsTransactionnels.entiteId, emailsTransactionnels.type],
    })
}

function professionalRecipient(emailContact: string | null, accountEmail: string): string {
  if (!accountEmail.toLowerCase().endsWith(`@${TEMP_EMAIL_DOMAIN}`)) return accountEmail
  const contact = emailContact?.trim()
  if (contact) return contact
  throw new EmailOutboxProcessingError('DESTINATAIRE_ABSENT')
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

async function loadEmailContent(row: EmailOutboxRow): Promise<TransactionalEmailContent> {
  if (!isTransactionalEmailType(row.type)) throw new EmailOutboxProcessingError('TYPE_EMAIL_INCONNU')
  assertEventMatchesEntity(row.type, row.entiteType as EmailEntityType)
  if (isReservationEmailType(row.type)) return loadReservationContent(row, row.type)
  if (isDemandeEmailType(row.type)) return loadDemandeContent(row, row.type)
  if (isMessageEmailType(row.type)) return loadMessageContent(row, row.type)
  throw new EmailOutboxProcessingError('TYPE_EMAIL_INCONNU')
}

type ClaimResult =
  | { kind: 'claimed', row: EmailOutboxRow }
  | { kind: 'already-sent' }
  | { kind: 'terminal' }
  | { kind: 'processing' }

async function claimOutbox(id: string, now: Date): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(emailsTransactionnels)
      .where(eq(emailsTransactionnels.id, id))
      .for('update')
    if (!row) throw new EmailOutboxProcessingError('OUTBOX_INTROUVABLE')
    if (row.statut === 'envoye') return { kind: 'already-sent' }
    if (row.statut === 'echec' || row.tentatives >= TRANSACTIONAL_EMAIL_MAX_ATTEMPTS) {
      return { kind: 'terminal' }
    }
    if (row.statut === 'en_cours' && now.getTime() - row.updatedAt.getTime() < PROCESSING_LEASE_MS) {
      return { kind: 'processing' }
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

export type ProcessTransactionalEmailResult = {
  statut: 'envoye' | 'deja_envoye' | 'echec_terminal' | 'en_cours'
}

export async function processTransactionalEmail(
  id: string,
  transport: EmailTransport = transactionalEmailTransport,
  now: Date = new Date(),
): Promise<ProcessTransactionalEmailResult> {
  const claim = await claimOutbox(id, now)
  if (claim.kind === 'already-sent') return { statut: 'deja_envoye' }
  if (claim.kind === 'terminal') return { statut: 'echec_terminal' }
  if (claim.kind === 'processing') return { statut: 'en_cours' }

  try {
    const message = buildTransactionalEmail(await loadEmailContent(claim.row))
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
