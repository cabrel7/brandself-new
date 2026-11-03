import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { OUTBOX_RETENTION_JOURS } from '../../shared/notifications'
import type { EmailStatut } from '../../shared/notifications'
import { emailsTransactionnels, reservations, users } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import {
  JOUR_MS,
  creerPro,
  insererOutbox,
  insererReservation,
  lireOutbox,
  utc,
  viderOutbox,
} from './support/notifications'
import { modulesPurge } from './support/planification'

// S9 #97, §4.1, CA : la purge quotidienne supprime les lignes d'outbox TERMINALES de plus de 90 jours (âge = updated_at).
// Signature supposée : purgeOutbox(now: Date): Promise<number> (nombre de lignes supprimées).

const MAINTENANT = utc('2026-11-03T03:30:00.000Z')
const ilYa = (jours: number) => new Date(MAINTENANT.getTime() - jours * JOUR_MS)

beforeEach(async () => {
  await viderOutbox()
})

async function ligne(statut: EmailStatut, age: number, i: number, extra: { createdAt?: Date } = {}) {
  return insererOutbox({
    type: 'utilisateur_rappel_journee', entiteType: 'utilisateur', entiteId: `entite-${i}`, occurrence: '2026-10-01',
    statut, updatedAt: ilYa(age), createdAt: extra.createdAt ?? ilYa(age + 1),
  })
}

describe('purgeOutbox : rétention de 90 jours', () => {
  it.each(['envoye', 'echec', 'annule'] as const)('should delete a %s line older than the retention and keep one that is younger', async (statut) => {
    const { purgeOutbox } = await modulesPurge()
    const vieille = await ligne(statut, OUTBOX_RETENTION_JOURS + 1, 1)
    const recente = await ligne(statut, OUTBOX_RETENTION_JOURS - 1, 2)

    const supprimees = await purgeOutbox(MAINTENANT)

    expect(supprimees).toBe(1)
    const restantes = (await lireOutbox()).map((l) => l.id)
    expect(restantes).toEqual([recente.id])
    expect(restantes).not.toContain(vieille.id)
  })

  it.each(['en_attente', 'en_cours'] as const)('should never delete a %s line, however old (it may still be sent or retried)', async (statut) => {
    const { purgeOutbox } = await modulesPurge()
    const vieille = await ligne(statut, 400, 1)

    const supprimees = await purgeOutbox(MAINTENANT)

    expect(supprimees).toBe(0)
    expect((await lireOutbox()).map((l) => l.id)).toEqual([vieille.id])
  })

  it('should measure the age on the last update, not on the creation: an old line sent recently stays', async () => {
    const { purgeOutbox } = await modulesPurge()
    const recemmentEnvoyee = await ligne('envoye', 2, 1, { createdAt: ilYa(300) })

    expect(await purgeOutbox(MAINTENANT)).toBe(0)
    expect((await lireOutbox()).map((l) => l.id)).toEqual([recemmentEnvoyee.id])
  })

  it('should return the exact number of deleted lines across statuses and be idempotent', async () => {
    const { purgeOutbox } = await modulesPurge()
    await ligne('envoye', 120, 1)
    await ligne('echec', 100, 2)
    await ligne('annule', 91, 3)
    await ligne('envoye', 10, 4)
    await ligne('en_attente', 500, 5)

    const premiere = await purgeOutbox(MAINTENANT)
    const seconde = await purgeOutbox(MAINTENANT)

    expect(premiere).toBe(3)
    expect(seconde).toBe(0)
    expect(await lireOutbox()).toHaveLength(2)
  })

  it('should also purge old S7 lines (empty occurrence) and leave the business tables untouched', async () => {
    const { purgeOutbox } = await modulesPurge()
    const pro = await creerPro()
    const reservation = await insererReservation(pro.vitrine.id, pro.service.id, { debut: ilYa(200), statut: 'terminee' })
    await insererOutbox({
      type: 'reservation_visiteur_recue', entiteType: 'reservation', entiteId: reservation.id,
      statut: 'envoye', updatedAt: ilYa(150), createdAt: ilYa(151),
    })

    expect(await purgeOutbox(MAINTENANT)).toBe(1)

    expect(await db.select().from(emailsTransactionnels)).toHaveLength(0)
    expect(await db.select().from(reservations).where(eq(reservations.id, reservation.id))).toHaveLength(1)
    expect(await db.select().from(users).where(eq(users.id, pro.user.id))).toHaveLength(1)
  })

  it('should do nothing on an empty outbox', async () => {
    const { purgeOutbox } = await modulesPurge()

    expect(await purgeOutbox(MAINTENANT)).toBe(0)
  })
})
