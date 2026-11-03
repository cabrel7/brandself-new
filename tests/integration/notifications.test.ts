import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { FILE_EMAILS_NOTIFICATIONS } from '../../shared/jobs'
import { emailsTransactionnels } from '../../shared/db/schema'
import { getEmailsNotificationsQueue } from '../../server/jobs/queues'
import {
  dispatchPendingTransactionalEmails,
  transactionalEmailJobId,
} from '../../server/jobs/email-outbox'
import {
  EmailOutboxProcessingError,
  insertTransactionalEmailEvents,
  processTransactionalEmail,
} from '../../server/services/email-outbox'
import type { EmailMessage, EmailTransport } from '../../server/services/emails/transport'
import { db } from '../../server/utils/db'
import {
  DEBUT_CRENEAU,
  REFERENCE_AGENDA,
  creerContexteAgenda,
  insererDisponibilite,
  iso,
} from './support/agenda'
import { demandesService, reservationsService } from './support/modules'

const VISITEUR = {
  nom: 'Alice Visiteur',
  email: 'alice.visiteur@exemple.test',
  telephone: '+237699000002',
  note: 'Motif médical privé',
  paiementChoisi: 'sur_place' as const,
  rappelEmail: true,
}

const queue = getEmailsNotificationsQueue()

class RecordingTransport implements EmailTransport {
  readonly sends: Array<{ message: EmailMessage, idempotencyKey: string }> = []

  constructor(private failuresRemaining = 0) {}

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    this.sends.push({ message, idempotencyKey })
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error(`Erreur fournisseur avec PII : ${VISITEUR.email} / ${VISITEUR.note}`)
    }
  }
}

async function setupReservation(username: string) {
  const context = await creerContexteAgenda({ username })
  await insererDisponibilite(context.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '14:00' })
  return context
}

async function createReservation(username: string) {
  const { createReservation: create } = await reservationsService()
  const context = await setupReservation(username)
  const created = await create(context.vitrine.username, {
    serviceSlug: context.service.slug,
    debut: iso(DEBUT_CRENEAU),
    ...VISITEUR,
  }, REFERENCE_AGENDA)
  return { ...context, created }
}

async function outboxRows(entityId?: string) {
  return db
    .select()
    .from(emailsTransactionnels)
    .where(entityId === undefined ? undefined : eq(emailsTransactionnels.entiteId, entityId))
    .orderBy(asc(emailsTransactionnels.type))
}

beforeEach(async () => {
  await db.delete(emailsTransactionnels)
  await queue.obliterate({ force: true })
})

describe('outbox transactionnelle des notifications S7', () => {
  it('écrit les événements de réservation dans les mêmes transactions que les mutations', async () => {
    const { confirmReservation, cancelReservation, createReservation: create } = await reservationsService()
    const { user, vitrine, service, created } = await createReservation('notifications-reservation')

    expect(await outboxRows(created.reservation.id)).toMatchObject([
      {
        type: 'reservation_professionnel_nouvelle',
        entiteType: 'reservation',
        entiteId: created.reservation.id,
        statut: 'en_attente',
        tentatives: 0,
      },
      {
        type: 'reservation_visiteur_recue',
        entiteType: 'reservation',
        entiteId: created.reservation.id,
        statut: 'en_attente',
        tentatives: 0,
      },
    ])

    // S9 : horloge injectée (début du créneau le même jour que REFERENCE_AGENDA, donc aucun rappel visiteur à 24 h :
    // la liste attendue des quatre événements S7 reste exacte quelle que soit la date réelle d'exécution).
    await confirmReservation(user.id, created.reservation.id, REFERENCE_AGENDA)
    await cancelReservation(user.id, created.reservation.id, { motif: 'Indisponibilité du professionnel' }, REFERENCE_AGENDA)
    expect((await outboxRows(created.reservation.id)).map(({ type }) => type)).toEqual([
      'reservation_professionnel_nouvelle',
      'reservation_visiteur_annulee',
      'reservation_visiteur_confirmee',
      'reservation_visiteur_recue',
    ])

    await db.transaction(async (tx) => {
      await insertTransactionalEmailEvents(tx, 'reservation', created.reservation.id, [
        'reservation_visiteur_confirmee',
      ])
    })
    expect(await outboxRows(created.reservation.id)).toHaveLength(4)

    await expect(create(vitrine.username, {
      serviceSlug: service.slug,
      debut: '2026-11-02T18:00:00.000Z',
      ...VISITEUR,
    }, REFERENCE_AGENDA)).rejects.toBeDefined()
    expect(await outboxRows(created.reservation.id)).toHaveLength(4)
    expect(await outboxRows()).toHaveLength(4)
  })

  it('S9 : garde la clé d’occurrence vide et la catégorie transactionnelle pour les événements S7 (cible ON CONFLICT à 4 colonnes)', async () => {
    const { created } = await createReservation('notifications-occurrence-s7')

    const lignes = await outboxRows(created.reservation.id)

    expect(lignes).toHaveLength(2)
    for (const ligne of lignes) {
      expect(ligne).toMatchObject({ occurrence: '', categorie: 'transactionnel', statut: 'en_attente', erreurCode: null })
    }
  })

  it('S9 : reste idempotent pour un même événement S7 rejoué (occurrence vide) et n’ajoute aucune ligne', async () => {
    const { created } = await createReservation('notifications-rejeu-s7')

    for (let rejeu = 0; rejeu < 3; rejeu += 1) {
      await db.transaction(async (tx) => {
        await insertTransactionalEmailEvents(tx, 'reservation', created.reservation.id, [
          'reservation_professionnel_nouvelle',
          'reservation_visiteur_recue',
        ])
      })
    }

    expect(await outboxRows(created.reservation.id)).toHaveLength(2)
  })

  it('S9 : n’écrase pas un événement planifié d’une autre occurrence lorsqu’un événement S7 du même type est rejoué', async () => {
    const { created } = await createReservation('notifications-cohabitation')
    await db.execute(sql`
      INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence)
      VALUES (${randomUUID()}, 'reservation_visiteur_rappel', 'reservation', ${created.reservation.id}, '2026-11-02T09:00:00.000Z')
    `)

    await db.transaction(async (tx) => {
      await insertTransactionalEmailEvents(tx, 'reservation', created.reservation.id, ['reservation_visiteur_recue'])
    })

    expect((await outboxRows(created.reservation.id)).map(({ type }) => type)).toEqual([
      'reservation_professionnel_nouvelle',
      'reservation_visiteur_rappel',
      'reservation_visiteur_recue',
    ])
  })

  it('écrit les deux événements d’une demande dans sa transaction', async () => {
    const { createDemande } = await demandesService()
    const context = await creerContexteAgenda({ username: 'notifications-demande', typeService: 'devis' })
    const { item } = await createDemande(context.vitrine.username, {
      serviceSlug: context.service.slug,
      nom: VISITEUR.nom,
      email: VISITEUR.email,
      telephone: VISITEUR.telephone,
      message: VISITEUR.note,
    })

    expect((await outboxRows(item.id)).map(({ type }) => type)).toEqual([
      'demande_professionnel_nouvelle',
      'demande_visiteur_recue',
    ])
  })
})

describe('traitement idempotent et reprises', () => {
  it('conserve une erreur non sensible, reprend puis ne renvoie jamais une ligne déjà envoyée', async () => {
    const { created } = await createReservation('notifications-retry')
    const [event] = await db
      .select()
      .from(emailsTransactionnels)
      .where(and(
        eq(emailsTransactionnels.entiteId, created.reservation.id),
        eq(emailsTransactionnels.type, 'reservation_visiteur_recue'),
      ))
    if (!event) throw new Error('Événement visiteur absent du test.')
    const transport = new RecordingTransport(1)

    await expect(processTransactionalEmail(event.id, transport, REFERENCE_AGENDA)).rejects.toMatchObject({
      name: 'EmailOutboxProcessingError',
      code: 'ENVOI_INCONNU',
    })
    const [failedOnce] = await outboxRows(created.reservation.id).then((rows) => rows.filter((row) => row.id === event.id))
    expect(failedOnce).toMatchObject({ statut: 'en_attente', tentatives: 1, erreurCode: 'ENVOI_INCONNU' })
    expect(failedOnce?.erreurCode).not.toContain(VISITEUR.email)
    expect(failedOnce?.erreurCode).not.toContain(VISITEUR.note)
    expect(failedOnce?.prochaineTentative.getTime()).toBeGreaterThan(REFERENCE_AGENDA.getTime())

    await expect(processTransactionalEmail(event.id, transport, new Date(REFERENCE_AGENDA.getTime() + 10_000)))
      .resolves.toMatchObject({ statut: 'envoye' })
    await expect(processTransactionalEmail(event.id, transport, new Date(REFERENCE_AGENDA.getTime() + 20_000)))
      .resolves.toMatchObject({ statut: 'deja_envoye' })

    expect(transport.sends).toHaveLength(2)
    expect(new Set(transport.sends.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(1)
    const [sent] = await db.select().from(emailsTransactionnels).where(eq(emailsTransactionnels.id, event.id))
    expect(sent).toMatchObject({ statut: 'envoye', tentatives: 2, erreurCode: null })
  })

  it('passe en échec terminal après cinq essais réseau', async () => {
    const { created } = await createReservation('notifications-echec')
    const [event] = await db
      .select()
      .from(emailsTransactionnels)
      .where(and(
        eq(emailsTransactionnels.entiteId, created.reservation.id),
        eq(emailsTransactionnels.type, 'reservation_professionnel_nouvelle'),
      ))
    if (!event) throw new Error('Événement professionnel absent du test.')
    const transport = new RecordingTransport(10)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(processTransactionalEmail(
        event.id,
        transport,
        new Date(REFERENCE_AGENDA.getTime() + attempt * 60_000),
      )).rejects.toBeInstanceOf(EmailOutboxProcessingError)
    }

    const [failed] = await db.select().from(emailsTransactionnels).where(eq(emailsTransactionnels.id, event.id))
    expect(failed).toMatchObject({ statut: 'echec', tentatives: 5, erreurCode: 'ENVOI_INCONNU' })
    await expect(processTransactionalEmail(event.id, transport)).resolves.toMatchObject({ statut: 'echec_terminal' })
    expect(transport.sends).toHaveLength(5)
  })
})

describe('dispatch BullMQ depuis l’outbox', () => {
  it('rattrape les lignes en attente avec un job déterministe sans aucune PII', async () => {
    const { created } = await createReservation('notifications-dispatch')
    const events = await outboxRows(created.reservation.id)

    await expect(dispatchPendingTransactionalEmails(queue, new Date())).resolves.toBe(2)
    await expect(dispatchPendingTransactionalEmails(queue, new Date())).resolves.toBe(2)

    const jobs = await queue.getJobs(['waiting', 'delayed'])
    expect(queue.name).toBe(FILE_EMAILS_NOTIFICATIONS)
    expect(jobs).toHaveLength(2)
    for (const event of events) {
      const job = jobs.find(({ id }) => id === transactionalEmailJobId(event.id))
      expect(job?.data).toEqual({ outboxId: event.id })
      expect(JSON.stringify(job?.data)).not.toContain(VISITEUR.nom)
      expect(JSON.stringify(job?.data)).not.toContain(VISITEUR.email)
      expect(JSON.stringify(job?.data)).not.toContain(VISITEUR.telephone)
      expect(JSON.stringify(job?.data)).not.toContain(VISITEUR.note)
      expect(job?.opts.attempts).toBe(5)
      expect(job?.opts.backoff).toMatchObject({ type: 'exponential' })
    }
  })
})
