import { describe, expect, it } from 'vitest'
import { creerContexteAgenda, lireDemandes } from './support/agenda'
import { rejet } from './support/erreurs'
import { demandesService } from './support/modules'

const VISITEUR = {
  nom: 'Alice Visiteur',
  email: 'alice.visiteur@exemple.test',
  telephone: '+237699000003',
  message: 'Je souhaite en savoir plus.',
}

function inputDemande(serviceSlug: string) {
  return { serviceSlug, ...VISITEUR }
}

describe('demandes : types de service autorisés', () => {
  it.each([
    ['atelier', 'demande-atelier'],
    ['devis', 'demande-devis'],
  ] as const)('accepte une demande pour un service %s', async (typeService, username) => {
    const { createDemande } = await demandesService()
    const { vitrine, service } = await creerContexteAgenda({ username, typeService })

    const { item } = await createDemande(vitrine.username, inputDemande(service.slug))

    expect(item).toMatchObject({
      vitrineId: vitrine.id,
      serviceId: service.id,
      nom: VISITEUR.nom,
      email: VISITEUR.email,
      telephone: VISITEUR.telephone,
      message: VISITEUR.message,
      statut: 'nouvelle',
    })
    expect(await lireDemandes(vitrine.id)).toHaveLength(1)
  })

  it.each([
    ['rdv', 'demande-rdv'],
    ['accompagnement', 'demande-accompagnement'],
  ] as const)('refuse une demande sans créneau pour un service %s et ne persiste rien', async (typeService, username) => {
    const { createDemande } = await demandesService()
    const { vitrine, service } = await creerContexteAgenda({ username, typeService })

    const erreur = await rejet(createDemande(vitrine.username, inputDemande(service.slug)))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('DEMANDE_NON_AUTORISEE')
    expect(erreur.status).toBe(422)
    expect(await lireDemandes(vitrine.id)).toEqual([])
  })

  it('refuse aussi un atelier masqué ou non réservable', async () => {
    const { createDemande } = await demandesService()
    const { vitrine, service } = await creerContexteAgenda({ username: 'demande-indisponible', typeService: 'atelier' })
    const { db } = await import('../../server/utils/db')
    const { services } = await import('../../shared/db/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(services).set({ actif: false, reservable: false }).where(eq(services.id, service.id))

    const erreur = await rejet(createDemande(vitrine.username, inputDemande(service.slug)))

    expect(erreur.code).toBe('SERVICE_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect(await lireDemandes(vitrine.id)).toEqual([])
  })
})

describe('demandes : isolation des vitrines', () => {
  it('scope la création par username même quand les deux vitrines ont le même slug de service', async () => {
    const { createDemande } = await demandesService()
    const a = await creerContexteAgenda({ username: 'demande-isolation-a', typeService: 'atelier', slugService: 'atelier-prive' })
    const b = await creerContexteAgenda({ username: 'demande-isolation-b', typeService: 'atelier', slugService: 'atelier-prive' })

    await createDemande(a.vitrine.username, inputDemande(a.service.slug))

    expect(await lireDemandes(a.vitrine.id)).toHaveLength(1)
    expect(await lireDemandes(b.vitrine.id)).toHaveLength(0)
  })

  it('ne permet ni de lister ni de modifier la demande d’une autre vitrine', async () => {
    const { createDemande, listOwnDemandes, updateDemande } = await demandesService()
    const a = await creerContexteAgenda({ username: 'demande-studio-a', typeService: 'devis' })
    const b = await creerContexteAgenda({ username: 'demande-studio-b', typeService: 'devis' })
    const { item } = await createDemande(a.vitrine.username, inputDemande(a.service.slug))

    const listeB = await listOwnDemandes(b.user.id)
    const erreur = await rejet(updateDemande(b.user.id, item.id, { statut: 'traitee' }))

    expect(listeB.items).toEqual([])
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('DEMANDE_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect((await lireDemandes(a.vitrine.id))[0]?.statut).toBe('nouvelle')

    const { item: traitee } = await updateDemande(a.user.id, item.id, { statut: 'traitee' })
    expect(traitee.statut).toBe('traitee')
    expect((await lireDemandes(a.vitrine.id))[0]?.statut).toBe('traitee')
  })
})
