import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { INDISPONIBILITE_PLAGE_MAX_JOURS, INDISPONIBILITE_RETENTION_JOURS } from '../../shared/agenda'
import { indisponibilites } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { purgerIndisponibilites } from '../../server/services/indisponibilites-purge'
import { rejet } from './support/erreurs'
import { creerContexteAgenda, insererReservation, lireIndisponibilites } from './support/agenda'
import { agendaService } from './support/modules'

// Vraie base : on prouve les règles côté serveur (date passée, plage atomique, doublons, comptage, purge).
// « Maintenant » est injecté : 2026-11-10 12:00 UTC = 13:00 à Douala (UTC+1).
const MAINTENANT = new Date('2026-11-10T12:00:00.000Z')
const AUJOURDHUI = '2026-11-10'
const HIER = '2026-11-09'

describe('indisponibilités : date passée', () => {
  it('should refuse a past date with INDISPONIBILITE_DATE_PASSEE and write nothing', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-passee' })

    const erreur = await rejet(createIndisponibilite(user.id, { date: HIER, raison: null }, MAINTENANT))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('INDISPONIBILITE_DATE_PASSEE')
    expect(erreur.status).toBe(422)
    expect(erreur.message).toBe('Cette date est déjà passée. Choisissez une date à venir.')
    expect(await lireIndisponibilites(vitrine.id)).toEqual([])
  })

  it('should accept today', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-aujourdhui' })

    const resultat = await createIndisponibilite(user.id, { date: AUJOURDHUI, raison: 'Congé' }, MAINTENANT)

    expect(resultat.item.date).toBe(AUJOURDHUI)
    expect(await lireIndisponibilites(vitrine.id)).toHaveLength(1)
  })

  it('should judge "today" in the vitrine timezone, not in UTC', async () => {
    const { createIndisponibilite } = await agendaService()
    // 2026-11-10T23:30Z = 2026-11-11 00:30 à Douala : le 10 est passé là-bas, encore « aujourd'hui » en UTC.
    const minuit = new Date('2026-11-10T23:30:00.000Z')
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-fuseau', fuseau: 'Africa/Douala' })

    const erreur = await rejet(createIndisponibilite(user.id, { date: AUJOURDHUI, raison: null }, minuit))
    expect(erreur.code).toBe('INDISPONIBILITE_DATE_PASSEE')
    await createIndisponibilite(user.id, { date: '2026-11-11', raison: null }, minuit)
    expect((await lireIndisponibilites(vitrine.id)).map((ligne) => ligne.date)).toEqual(['2026-11-11'])
  })

  it('should allow deleting a past indisponibilite', async () => {
    const { deleteIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-suppr-passee' })
    const id = randomUUID()
    await db.insert(indisponibilites).values({ id, vitrineId: vitrine.id, date: '2026-01-05', raison: null })

    await deleteIndisponibilite(user.id, id)

    expect(await lireIndisponibilites(vitrine.id)).toEqual([])
  })
})

describe('indisponibilités : plage', () => {
  it('should create one row per day in a single call', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-plage' })

    const resultat = await createIndisponibilite(user.id, { debut: '2026-12-30', fin: '2027-01-02', raison: 'Fêtes' }, MAINTENANT)

    expect(resultat).toMatchObject({ type: 'plage', creees: 4, ignorees: 0, reservationsConcernees: 0 })
    expect(resultat.items.map((item) => item.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect((await lireIndisponibilites(vitrine.id)).map((ligne) => [ligne.date, ligne.raison])).toEqual([
      ['2026-12-30', 'Fêtes'], ['2026-12-31', 'Fêtes'], ['2027-01-01', 'Fêtes'], ['2027-01-02', 'Fêtes'],
    ])
  })

  it('should ignore already closed dates and count them, without conflict', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-doublons' })
    await createIndisponibilite(user.id, { date: '2026-11-21', raison: 'Existante' }, MAINTENANT)

    const resultat = await createIndisponibilite(user.id, { debut: '2026-11-20', fin: '2026-11-22', raison: 'Plage' }, MAINTENANT)

    expect(resultat).toMatchObject({ creees: 2, ignorees: 1 })
    expect(await lireIndisponibilites(vitrine.id)).toEqual([
      { id: expect.any(String), vitrineId: vitrine.id, date: '2026-11-20', raison: 'Plage' },
      { id: expect.any(String), vitrineId: vitrine.id, date: '2026-11-21', raison: 'Existante' },
      { id: expect.any(String), vitrineId: vitrine.id, date: '2026-11-22', raison: 'Plage' },
    ])
  })

  it('should return nothing created when the whole range is already closed', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user } = await creerContexteAgenda({ username: 'indispo-deja-ferme' })
    await createIndisponibilite(user.id, { debut: '2026-11-20', fin: '2026-11-21', raison: null }, MAINTENANT)

    const resultat = await createIndisponibilite(user.id, { debut: '2026-11-20', fin: '2026-11-21', raison: null }, MAINTENANT)

    expect(resultat).toMatchObject({ items: [], creees: 0, ignorees: 2, reservationsConcernees: 0 })
  })

  it('should refuse a range longer than the maximum without partial write', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-trop-longue' })

    const erreur = await rejet(createIndisponibilite(user.id, { debut: '2026-11-11', fin: '2027-01-10', raison: null }, MAINTENANT))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.status).toBe(400)
    expect(await lireIndisponibilites(vitrine.id)).toEqual([])
  })

  it('should accept a range of exactly the maximum', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-max' })

    const resultat = await createIndisponibilite(user.id, { debut: '2026-11-11', fin: '2027-01-09', raison: null }, MAINTENANT)

    expect(resultat.creees).toBe(INDISPONIBILITE_PLAGE_MAX_JOURS)
    expect(await lireIndisponibilites(vitrine.id)).toHaveLength(INDISPONIBILITE_PLAGE_MAX_JOURS)
  })

  it('should refuse a range starting in the past and write nothing', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indispo-plage-passee' })

    const erreur = await rejet(createIndisponibilite(user.id, { debut: HIER, fin: '2026-11-12', raison: null }, MAINTENANT))

    expect(erreur.code).toBe('INDISPONIBILITE_DATE_PASSEE')
    expect(await lireIndisponibilites(vitrine.id)).toEqual([])
  })

  it('should accept a range starting today', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user } = await creerContexteAgenda({ username: 'indispo-plage-aujourdhui' })

    const resultat = await createIndisponibilite(user.id, { debut: AUJOURDHUI, fin: '2026-11-11', raison: null }, MAINTENANT)

    expect(resultat.creees).toBe(2)
  })
})

describe('indisponibilités : réservations concernées', () => {
  // Douala = UTC+1 : le 2026-11-20 local couvre [2026-11-19T23:00Z, 2026-11-20T23:00Z).
  const DEBUT_LOCAL = '2026-11-19T23:00:00.000Z'
  const TROP_TOT = '2026-11-19T22:59:59.000Z'
  const TROP_TARD = '2026-11-20T23:00:00.000Z'

  /** Durée courte par défaut (1 s) : la contrainte d'exclusion interdit deux créneaux actifs qui se chevauchent. */
  async function reserver(vitrineId: string, serviceId: string, statut: string, debut: string): Promise<void> {
    const instant = new Date(debut)
    await insererReservation(vitrineId, serviceId, { statut, debut: instant, fin: new Date(instant.getTime() + 1_000) })
  }

  it('should count en_attente and confirmee, ignore other statuses, other days and other vitrines', async () => {
    const { createIndisponibilite } = await agendaService()
    const a = await creerContexteAgenda({ username: 'indispo-compte-a' })
    const b = await creerContexteAgenda({ username: 'indispo-compte-b' })
    await reserver(a.vitrine.id, a.service.id, 'en_attente', DEBUT_LOCAL)
    await reserver(a.vitrine.id, a.service.id, 'confirmee', '2026-11-20T10:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'annulee', '2026-11-20T11:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'refusee', '2026-11-20T12:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'terminee', '2026-11-20T13:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'confirmee', TROP_TOT)
    await reserver(a.vitrine.id, a.service.id, 'confirmee', TROP_TARD)
    await reserver(b.vitrine.id, b.service.id, 'confirmee', '2026-11-20T10:00:00.000Z')

    const resultat = await createIndisponibilite(a.user.id, { date: '2026-11-20', raison: null }, MAINTENANT)

    expect(resultat.reservationsConcernees).toBe(2)
  })

  it('should count across a range without cancelling or blocking anything', async () => {
    const { createIndisponibilite } = await agendaService()
    const a = await creerContexteAgenda({ username: 'indispo-compte-plage' })
    await reserver(a.vitrine.id, a.service.id, 'confirmee', '2026-11-20T10:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'en_attente', '2026-11-22T10:00:00.000Z')
    await reserver(a.vitrine.id, a.service.id, 'confirmee', '2026-11-25T10:00:00.000Z')

    const resultat = await createIndisponibilite(a.user.id, { debut: '2026-11-20', fin: '2026-11-22', raison: null }, MAINTENANT)

    expect(resultat.reservationsConcernees).toBe(2)
    const statuts = await db.execute<{ statut: string }>(sql`SELECT statut FROM reservations WHERE vitrine_id = ${a.vitrine.id} ORDER BY debut`)
    expect(statuts.rows.map((ligne) => ligne.statut)).toEqual(['confirmee', 'en_attente', 'confirmee'])
  })
})

describe('indisponibilités : purge', () => {
  it('should delete only dates older than the retention, keep recent and future ones', async () => {
    const a = await creerContexteAgenda({ username: 'indispo-purge-a' })
    const b = await creerContexteAgenda({ username: 'indispo-purge-b' })
    const maintenant = new Date('2026-11-09T04:30:00.000Z')
    // Limite = 2026-11-09 - 90 j = 2026-08-11 : strictement avant = purgé.
    const dates = ['2026-08-10', '2026-08-11', '2026-10-01', '2026-11-09', '2027-01-01']
    for (const vitrine of [a.vitrine, b.vitrine]) {
      await db.insert(indisponibilites).values(dates.map((date) => ({ id: randomUUID(), vitrineId: vitrine.id, date, raison: null })))
    }

    const supprimees = await purgerIndisponibilites(maintenant)

    expect(INDISPONIBILITE_RETENTION_JOURS).toBe(90)
    expect(supprimees).toBe(2)
    expect((await lireIndisponibilites(a.vitrine.id)).map((ligne) => ligne.date)).toEqual(['2026-08-11', '2026-10-01', '2026-11-09', '2027-01-01'])
    expect(await db.select().from(indisponibilites).where(eq(indisponibilites.vitrineId, b.vitrine.id))).toHaveLength(4)
  })

  it('should be idempotent', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'indispo-purge-idem' })
    await db.insert(indisponibilites).values({ id: randomUUID(), vitrineId: vitrine.id, date: '2026-01-01', raison: null })
    const maintenant = new Date('2026-11-09T04:30:00.000Z')

    expect(await purgerIndisponibilites(maintenant)).toBe(1)
    expect(await purgerIndisponibilites(maintenant)).toBe(0)
  })
})
