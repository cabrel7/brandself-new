import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { creerContexteAgenda, insererReservation, lireDemandes } from './support/agenda'
import { createUser } from './support/fabriques'

const compteur = () => import('../../server/services/agenda-a-traiter')

async function insererDemande(vitrineId: string, serviceId: string, statut: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO demandes (id, vitrine_id, service_id, nom, email, telephone, statut)
    VALUES (${randomUUID()}, ${vitrineId}, ${serviceId}, 'Alice', 'alice@exemple.test', '+237699000003', ${statut})
  `)
}

// Les réservations d'une même vitrine ne doivent pas se chevaucher (contrainte d'exclusion).
const creneau = (i: number) => ({
  debut: new Date(Date.UTC(2026, 10, 2, 8 + i)),
  fin: new Date(Date.UTC(2026, 10, 2, 8 + i, 30)),
})

describe('countAgendaATraiter', () => {
  it('compte les réservations en_attente et les demandes nouvelles, rien d\'autre', async () => {
    const { countAgendaATraiter } = await compteur()
    const { user, vitrine, service } = await creerContexteAgenda()
    const statutsReservation = ['en_attente', 'en_attente', 'confirmee', 'annulee', 'terminee', 'refusee']
    for (const [i, statut] of statutsReservation.entries()) {
      const r = await insererReservation(vitrine.id, service.id, { ...creneau(i), statut: 'en_attente' })
      await db.execute(sql`UPDATE reservations SET statut = ${statut} WHERE id = ${r.id}`)
    }
    for (const statut of ['nouvelle', 'en_cours', 'traitee', 'refusee']) {
      await insererDemande(vitrine.id, service.id, statut)
    }

    expect(await countAgendaATraiter(user.id)).toBe(3)
  })

  it('ne compte jamais une autre vitrine', async () => {
    const { countAgendaATraiter } = await compteur()
    const a = await creerContexteAgenda()
    const b = await creerContexteAgenda()
    await insererReservation(b.vitrine.id, b.service.id, { statut: 'en_attente' })
    await insererDemande(b.vitrine.id, b.service.id, 'nouvelle')
    await insererDemande(b.vitrine.id, b.service.id, 'nouvelle')

    expect(await countAgendaATraiter(a.user.id)).toBe(0)
    expect(await countAgendaATraiter(b.user.id)).toBe(3)
  })

  it('renvoie 0 pour un utilisateur sans vitrine', async () => {
    const { countAgendaATraiter } = await compteur()
    const user = await createUser()

    expect(await countAgendaATraiter(user.id)).toBe(0)
  })

  it('n\'écrit rien en base', async () => {
    const { countAgendaATraiter } = await compteur()
    const { user, vitrine, service } = await creerContexteAgenda()
    await insererReservation(vitrine.id, service.id, { statut: 'en_attente' })
    await insererDemande(vitrine.id, service.id, 'nouvelle')
    const instantane = async () => (await db.execute<{ t: string, id: string, u: string }>(sql`
      SELECT 'r' AS t, id, updated_at::text AS u FROM reservations WHERE vitrine_id = ${vitrine.id}
      UNION ALL
      SELECT 'd', id, updated_at::text FROM demandes WHERE vitrine_id = ${vitrine.id}
      ORDER BY 1, 2
    `)).rows
    const avant = await instantane()

    expect(await countAgendaATraiter(user.id)).toBe(2)
    expect(await countAgendaATraiter(user.id)).toBe(2)

    expect(await instantane()).toEqual(avant)
    expect(await lireDemandes(vitrine.id)).toHaveLength(1)
  })
})

describe('countAgendaATraiterParType', () => {
  it('should split the count by type and keep countAgendaATraiter as their sum', async () => {
    const { countAgendaATraiter, countAgendaATraiterParType } = await compteur()
    const { user, vitrine, service } = await creerContexteAgenda()
    await insererReservation(vitrine.id, service.id, { ...creneau(0), statut: 'en_attente' })
    await insererReservation(vitrine.id, service.id, { ...creneau(1), statut: 'en_attente' })
    await insererReservation(vitrine.id, service.id, { ...creneau(2), statut: 'confirmee' })
    await insererDemande(vitrine.id, service.id, 'nouvelle')
    await insererDemande(vitrine.id, service.id, 'traitee')

    expect(await countAgendaATraiterParType(user.id)).toEqual({ reservationsEnAttente: 2, demandesNouvelles: 1 })
    expect(await countAgendaATraiter(user.id)).toBe(3)
  })

  it('should return zeros for a user without vitrine and never read another vitrine', async () => {
    const { countAgendaATraiterParType } = await compteur()
    const a = await creerContexteAgenda()
    const b = await creerContexteAgenda()
    await insererDemande(b.vitrine.id, b.service.id, 'nouvelle')

    expect(await countAgendaATraiterParType((await createUser()).id)).toEqual({ reservationsEnAttente: 0, demandesNouvelles: 0 })
    expect(await countAgendaATraiterParType(a.user.id)).toEqual({ reservationsEnAttente: 0, demandesNouvelles: 0 })
  })
})
