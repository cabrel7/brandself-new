import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { creerContexteAgenda, insererReservation } from './support/agenda'
import { createUser } from './support/fabriques'

const resume = () => import('../../server/services/agenda-resume')

const MAINTENANT = new Date('2026-11-03T08:00:00.000Z')
const h = (heures: number) => new Date(MAINTENANT.getTime() + heures * 3_600_000)

describe('getProchainRendezVous', () => {
  it('should return the nearest confirmed appointment with its service title and nothing about the client', async () => {
    const { getProchainRendezVous } = await resume()
    const { user, vitrine, service } = await creerContexteAgenda()
    await insererReservation(vitrine.id, service.id, { statut: 'confirmee', debut: h(30), fin: h(30.5) })
    await insererReservation(vitrine.id, service.id, { statut: 'confirmee', debut: h(25), fin: h(25.5), nom: 'Alice Secret', email: 'alice@secret.test' })

    const rdv = await getProchainRendezVous(user.id, MAINTENANT)

    expect(rdv).toEqual({ debut: h(25), fin: h(25.5), service: service.titre })
    expect(JSON.stringify(rdv)).not.toMatch(/alice|secret|email|telephone|nom/i)
  })

  it('should count an appointment in progress', async () => {
    const { getProchainRendezVous } = await resume()
    const { user, vitrine, service } = await creerContexteAgenda()
    await insererReservation(vitrine.id, service.id, { statut: 'confirmee', debut: h(-0.25), fin: h(0.25) })

    expect(await getProchainRendezVous(user.id, MAINTENANT)).toMatchObject({ debut: h(-0.25), fin: h(0.25) })
  })

  it.each(['en_attente', 'annulee', 'terminee'] as const)('should ignore a %s reservation', async (statut) => {
    const { getProchainRendezVous } = await resume()
    const { user, vitrine, service } = await creerContexteAgenda()
    await insererReservation(vitrine.id, service.id, { statut, debut: h(25), fin: h(25.5) })

    expect(await getProchainRendezVous(user.id, MAINTENANT)).toBeNull()
  })

  it('should ignore a finished appointment and never change its status', async () => {
    const { getProchainRendezVous } = await resume()
    const { user, vitrine, service } = await creerContexteAgenda()
    const passee = await insererReservation(vitrine.id, service.id, { statut: 'confirmee', debut: h(-5), fin: h(-4.5) })
    const avant = (await db.execute<{ s: string, u: string }>(sql`SELECT statut AS s, updated_at::text AS u FROM reservations WHERE id = ${passee.id}`)).rows[0]

    expect(await getProchainRendezVous(user.id, new Date())).toBeNull()
    expect(await getProchainRendezVous(user.id, MAINTENANT)).toBeNull()

    const apres = (await db.execute<{ s: string, u: string }>(sql`SELECT statut AS s, updated_at::text AS u FROM reservations WHERE id = ${passee.id}`)).rows[0]
    expect(apres).toEqual(avant)
    expect(apres?.s).toBe('confirmee')
  })

  it('should never return another vitrine appointment', async () => {
    const { getProchainRendezVous } = await resume()
    const a = await creerContexteAgenda()
    const b = await creerContexteAgenda()
    await insererReservation(b.vitrine.id, b.service.id, { statut: 'confirmee', debut: h(25), fin: h(25.5) })

    expect(await getProchainRendezVous(a.user.id, MAINTENANT)).toBeNull()
    expect(await getProchainRendezVous(b.user.id, MAINTENANT)).not.toBeNull()
  })

  it('should return null for a user without vitrine', async () => {
    const { getProchainRendezVous } = await resume()
    const user = await createUser()

    expect(await getProchainRendezVous(user.id, MAINTENANT)).toBeNull()
  })
})
