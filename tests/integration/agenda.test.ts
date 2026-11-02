import { describe, expect, it } from 'vitest'
import { rejet } from './support/erreurs'
import {
  creerContexteAgenda,
  insererDisponibilite,
  lireDisponibilites,
  lireIndisponibilites,
} from './support/agenda'
import { agendaService, creneauxService } from './support/modules'

const LUNDI = '2026-11-02'
const MAINTENANT = new Date('2026-11-02T05:00:00.000Z')

function enIso(valeur: Date | string): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(valeur).toISOString()
}

describe('agenda : plages hebdomadaires', () => {
  it('remplace atomiquement les plages, conserve plusieurs plages par jour et les ordonne', async () => {
    const { replaceDisponibilites } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'agenda-plages' })

    await replaceDisponibilites(user.id, [
      { jourSemaine: 3, debut: '14:00', fin: '17:00' },
      { jourSemaine: 1, debut: '13:30', fin: '16:00' },
      { jourSemaine: 1, debut: '09:00', fin: '12:00' },
    ])

    expect((await lireDisponibilites(vitrine.id)).map(({ jourSemaine, debut, fin }) => ({ jourSemaine, debut, fin }))).toEqual([
      { jourSemaine: 1, debut: '09:00:00', fin: '12:00:00' },
      { jourSemaine: 1, debut: '13:30:00', fin: '16:00:00' },
      { jourSemaine: 3, debut: '14:00:00', fin: '17:00:00' },
    ])

    await replaceDisponibilites(user.id, [{ jourSemaine: 5, debut: '08:00', fin: '10:00' }])
    expect((await lireDisponibilites(vitrine.id)).map(({ jourSemaine, debut, fin }) => ({ jourSemaine, debut, fin }))).toEqual([
      { jourSemaine: 5, debut: '08:00:00', fin: '10:00:00' },
    ])
  })

  it('refuse des plages qui se chevauchent et garde tout le planning précédent', async () => {
    const { replaceDisponibilites } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'agenda-chevauchement' })
    await replaceDisponibilites(user.id, [{ jourSemaine: 1, debut: '09:00', fin: '12:00' }])
    const avant = await lireDisponibilites(vitrine.id)

    const erreur = await rejet(replaceDisponibilites(user.id, [
      { jourSemaine: 1, debut: '09:00', fin: '11:00' },
      { jourSemaine: 1, debut: '10:30', fin: '12:00' },
    ]))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('DISPONIBILITES_INVALIDES')
    expect(erreur.status).toBe(422)
    expect(await lireDisponibilites(vitrine.id)).toEqual(avant)
  })

  it('isole les remplacements de planning entre vitrines', async () => {
    const { replaceDisponibilites } = await agendaService()
    const a = await creerContexteAgenda({ username: 'agenda-a' })
    const b = await creerContexteAgenda({ username: 'agenda-b' })

    await replaceDisponibilites(a.user.id, [{ jourSemaine: 1, debut: '09:00', fin: '12:00' }])
    await replaceDisponibilites(b.user.id, [{ jourSemaine: 2, debut: '14:00', fin: '18:00' }])

    expect((await lireDisponibilites(a.vitrine.id)).map((ligne) => ligne.jourSemaine)).toEqual([1])
    expect((await lireDisponibilites(b.vitrine.id)).map((ligne) => ligne.jourSemaine)).toEqual([2])
  })
})

describe('agenda : créneaux et indisponibilités', () => {
  it('produit les créneaux depuis la plage hebdomadaire persistée', async () => {
    const { listCreneaux } = await creneauxService()
    const { vitrine, service } = await creerContexteAgenda({ username: 'agenda-creneaux' })
    await insererDisponibilite(vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '11:00' })

    const { creneaux } = await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: LUNDI,
      au: LUNDI,
      maintenant: MAINTENANT,
    })

    expect(creneaux.map((creneau) => [enIso(creneau.debut), enIso(creneau.fin)])).toEqual([
      ['2026-11-02T08:00:00.000Z', '2026-11-02T08:30:00.000Z'],
      ['2026-11-02T08:30:00.000Z', '2026-11-02T09:00:00.000Z'],
      ['2026-11-02T09:00:00.000Z', '2026-11-02T09:30:00.000Z'],
      ['2026-11-02T09:30:00.000Z', '2026-11-02T10:00:00.000Z'],
    ])
  })

  it('retire toute une date indisponible, puis restaure ses créneaux à la suppression', async () => {
    const { createIndisponibilite, deleteIndisponibilite } = await agendaService()
    const { listCreneaux } = await creneauxService()
    const { user, vitrine, service } = await creerContexteAgenda({ username: 'agenda-indisponible' })
    await insererDisponibilite(vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '11:00' })

    const { item } = await createIndisponibilite(user.id, { date: LUNDI, raison: 'Congé' })

    expect(await lireIndisponibilites(vitrine.id)).toEqual([
      { id: item.id, vitrineId: vitrine.id, date: LUNDI, raison: 'Congé' },
    ])
    expect((await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: LUNDI,
      au: LUNDI,
      maintenant: MAINTENANT,
    })).creneaux).toEqual([])

    await deleteIndisponibilite(user.id, item.id)

    expect(await lireIndisponibilites(vitrine.id)).toEqual([])
    expect((await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: LUNDI,
      au: LUNDI,
      maintenant: MAINTENANT,
    })).creneaux).toHaveLength(4)
  })

  it('interdit à une autre vitrine de supprimer une indisponibilité', async () => {
    const { createIndisponibilite, deleteIndisponibilite } = await agendaService()
    const a = await creerContexteAgenda({ username: 'indisponible-a' })
    const b = await creerContexteAgenda({ username: 'indisponible-b' })
    const { item } = await createIndisponibilite(a.user.id, { date: LUNDI, raison: 'Formation' })

    const erreur = await rejet(deleteIndisponibilite(b.user.id, item.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('INDISPONIBILITE_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect(await lireIndisponibilites(a.vitrine.id)).toHaveLength(1)
    expect(await lireIndisponibilites(b.vitrine.id)).toHaveLength(0)
  })

  it('traduit une double indisponibilité sur la même date en conflit métier, jamais en erreur brute', async () => {
    const { createIndisponibilite } = await agendaService()
    const { user, vitrine } = await creerContexteAgenda({ username: 'indisponible-double' })

    await createIndisponibilite(user.id, { date: LUNDI, raison: 'Congé' })
    const erreur = await rejet(createIndisponibilite(user.id, { date: LUNDI, raison: 'Formation' }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('INDISPONIBILITE_EXISTANTE')
    expect(erreur.status).toBe(409)
    expect(await lireIndisponibilites(vitrine.id)).toEqual([
      { id: expect.any(String), vitrineId: vitrine.id, date: LUNDI, raison: 'Congé' },
    ])
  })
})
