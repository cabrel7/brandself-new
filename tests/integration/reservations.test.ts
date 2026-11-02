import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../server/utils/db'
import { exigerModulesPresents, rejet } from './support/erreurs'
import {
  DEBUT_CRENEAU,
  FIN_CRENEAU,
  REFERENCE_AGENDA,
  creerContexteAgenda,
  expirerConfirmation,
  insererDisponibilite,
  insererReservation,
  iso,
  lireReservation,
  lireReservations,
} from './support/agenda'
import { creneauxService, reservationsService, ressourceReservation } from './support/modules'

const VISITEUR = {
  nom: 'Alice Visiteur',
  email: 'alice.visiteur@exemple.test',
  telephone: '+237699000002',
  note: 'Première consultation',
  paiementChoisi: 'sur_place' as const,
  rappelEmail: true,
}

async function preparerReservation(username: string) {
  const contexte = await creerContexteAgenda({ username })
  await insererDisponibilite(contexte.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '14:00' })
  return contexte
}

function inputReservation(serviceSlug: string, debut: Date = DEBUT_CRENEAU) {
  return { serviceSlug, debut: iso(debut), ...VISITEUR }
}

function clesProfondes(valeur: unknown): string[] {
  if (Array.isArray(valeur)) return valeur.flatMap(clesProfondes)
  if (typeof valeur !== 'object' || valeur === null) return []
  return Object.entries(valeur).flatMap(([cle, enfant]) => [cle, ...clesProfondes(enfant)])
}

function valeurEnIso(valeur: Date | string): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(valeur).toISOString()
}

describe('réservations : écriture transactionnelle et concurrence', () => {
  it('revalide le créneau, calcule la fin côté serveur et ne laisse aucune écriture lors d’un refus', async () => {
    const { listCreneaux } = await creneauxService()
    const { createReservation } = await reservationsService()
    const { vitrine, service } = await preparerReservation('reservation-transaction')

    const avant = await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: '2026-11-02',
      au: '2026-11-02',
      maintenant: REFERENCE_AGENDA,
    })
    expect(avant.creneaux.map((creneau) => valeurEnIso(creneau.debut))).toContain(iso(DEBUT_CRENEAU))

    const creee = await createReservation(
      vitrine.username,
      inputReservation(service.slug),
      REFERENCE_AGENDA,
    )

    const lignes = await lireReservations(vitrine.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      id: creee.reservation.id,
      vitrineId: vitrine.id,
      serviceId: service.id,
      nom: VISITEUR.nom,
      email: VISITEUR.email,
      telephone: VISITEUR.telephone,
      note: VISITEUR.note,
      statut: 'en_attente',
      paiementChoisi: 'sur_place',
    })
    expect(iso(lignes[0]!.debut)).toBe(iso(DEBUT_CRENEAU))
    expect(iso(lignes[0]!.fin)).toBe(iso(FIN_CRENEAU))

    const apres = await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: '2026-11-02',
      au: '2026-11-02',
      maintenant: REFERENCE_AGENDA,
    })
    expect(apres.creneaux.map((creneau) => valeurEnIso(creneau.debut))).not.toContain(iso(DEBUT_CRENEAU))

    const erreur = await rejet(createReservation(
      vitrine.username,
      inputReservation(service.slug, new Date('2026-11-02T18:00:00.000Z')),
      REFERENCE_AGENDA,
    ))
    expect(erreur.code).toBe('CRENEAU_INDISPONIBLE')
    expect(await lireReservations(vitrine.id)).toHaveLength(1)
  })

  it('laisse exactement une création gagner sur deux créations simultanées du même créneau', async () => {
    const { createReservation } = await reservationsService()
    const { vitrine, service } = await preparerReservation('reservation-course')

    const resultats = await Promise.allSettled([
      createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA),
      createReservation(vitrine.username, {
        ...inputReservation(service.slug),
        nom: 'Bob Concurrent',
        email: 'bob.concurrent@exemple.test',
      }, REFERENCE_AGENDA),
    ])
    exigerModulesPresents(resultats)

    expect(resultats.filter((resultat) => resultat.status === 'fulfilled')).toHaveLength(1)
    expect(resultats.filter((resultat) => resultat.status === 'rejected')).toHaveLength(1)
    const echec = resultats.find((resultat): resultat is PromiseRejectedResult => resultat.status === 'rejected')
    const erreur = await rejet(Promise.reject(echec?.reason))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('CRENEAU_PRIS')
    expect(erreur.status).toBe(409)
    expect(await lireReservations(vitrine.id)).toHaveLength(1)
  })

  it('une annulation libère immédiatement le créneau pour une nouvelle réservation', async () => {
    const { cancelReservation, createReservation } = await reservationsService()
    const { user, vitrine, service } = await preparerReservation('reservation-annulation')
    const premiere = await createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA)

    const { item: annulee } = await cancelReservation(user.id, premiere.reservation.id, { motif: 'Indisponible' })
    const seconde = await createReservation(vitrine.username, {
      ...inputReservation(service.slug),
      nom: 'Nouvelle Visiteuse',
      email: 'nouvelle@exemple.test',
    }, REFERENCE_AGENDA)

    expect(annulee.statut).toBe('annulee')
    expect(seconde.reservation.id).not.toBe(premiere.reservation.id)
    expect((await lireReservations(vitrine.id)).map((ligne) => ligne.statut).sort()).toEqual(['annulee', 'en_attente'])
  })
})

describe('réservations : isolation et transitions', () => {
  it('isole la liste et les actions studio entre vitrines, sans bloquer le même horaire ailleurs', async () => {
    const { confirmReservation, createReservation, listOwnReservations } = await reservationsService()
    const a = await preparerReservation('reservation-isolation-a')
    const b = await preparerReservation('reservation-isolation-b')
    const reservationA = await createReservation(a.vitrine.username, inputReservation(a.service.slug), REFERENCE_AGENDA)

    const listeB = await listOwnReservations(b.user.id)
    const erreur = await rejet(confirmReservation(b.user.id, reservationA.reservation.id))
    const reservationB = await createReservation(b.vitrine.username, inputReservation(b.service.slug), REFERENCE_AGENDA)

    expect(listeB.items).toEqual([])
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('RESERVATION_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect((await lireReservation(reservationA.reservation.id))?.statut).toBe('en_attente')
    expect(reservationB.reservation.id).not.toBe(reservationA.reservation.id)
    expect(await lireReservations(a.vitrine.id)).toHaveLength(1)
    expect(await lireReservations(b.vitrine.id)).toHaveLength(1)
  })

  it('autorise en attente → confirmée → annulée et refuse toute transition depuis annulée', async () => {
    const { cancelReservation, confirmReservation, createReservation } = await reservationsService()
    const { user, vitrine, service } = await preparerReservation('reservation-transitions')
    const creee = await createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA)

    const { item: confirmee } = await confirmReservation(user.id, creee.reservation.id)
    const { item: annulee } = await cancelReservation(user.id, creee.reservation.id, {})
    const erreur = await rejet(confirmReservation(user.id, creee.reservation.id))

    expect(confirmee.statut).toBe('confirmee')
    expect(annulee.statut).toBe('annulee')
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TRANSITION_RESERVATION_INVALIDE')
    expect(erreur.status).toBe(422)
    expect((await lireReservation(creee.reservation.id))?.statut).toBe('annulee')
  })

  it('termine automatiquement les réservations confirmées passées, jamais celles en attente', async () => {
    const { completePastReservations } = await reservationsService()
    const { vitrine, service } = await creerContexteAgenda({ username: 'reservation-terminee' })
    const confirmee = await insererReservation(vitrine.id, service.id, {
      debut: new Date('2026-10-30T08:00:00.000Z'),
      fin: new Date('2026-10-30T08:30:00.000Z'),
      statut: 'confirmee',
    })
    const enAttente = await insererReservation(vitrine.id, service.id, {
      debut: new Date('2026-10-30T09:00:00.000Z'),
      fin: new Date('2026-10-30T09:30:00.000Z'),
      statut: 'en_attente',
    })

    await completePastReservations(REFERENCE_AGENDA)

    expect((await lireReservation(confirmee.id))?.statut).toBe('terminee')
    expect((await lireReservation(enAttente.id))?.statut).toBe('en_attente')
  })
})

describe('réservations : confirmation publique', () => {
  it('utilise un jeton opaque, ne le stocke jamais en clair, expire son accès et produit un DTO sans PII', async () => {
    const { listCreneaux } = await creneauxService()
    const { createReservation, getReservationConfirmation } = await reservationsService()
    const { toReservationConfirmationResource } = await ressourceReservation()
    const { vitrine, service } = await preparerReservation('reservation-confirmation')
    const creee = await createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA)
    const token = creee.confirmation.token

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(token).not.toBe(creee.reservation.id)
    expect(token).not.toContain(VISITEUR.email)
    const persistee = await lireReservation(creee.reservation.id)
    expect(persistee?.confirmationTokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(persistee?.confirmationTokenHash).not.toBe(token)
    expect(persistee?.confirmationExpireLe.getTime()).toBeGreaterThan(REFERENCE_AGENDA.getTime())

    const confirmation = await getReservationConfirmation(token, REFERENCE_AGENDA)
    const dto = toReservationConfirmationResource(confirmation)
    expect(dto.service).toMatchObject({ tarif: 'gratuit', prixMontant: null, prixDevise: null })
    expect(dto.vitrine.lieu).toBe('Douala, Cameroun')
    const interdites = ['nom', 'email', 'telephone', 'note', 'vitrineId', 'serviceId', 'confirmationTokenHash']
    const cles = clesProfondes(dto)
    for (const interdite of interdites) expect(cles).not.toContain(interdite)
    const json = JSON.stringify(dto)
    for (const pii of [VISITEUR.nom, VISITEUR.email, VISITEUR.telephone, VISITEUR.note]) {
      expect(json).not.toContain(pii)
    }

    await expirerConfirmation(creee.reservation.id)
    const erreur = await rejet(getReservationConfirmation(token, REFERENCE_AGENDA))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('CONFIRMATION_EXPIREE')
    expect(erreur.status).toBe(410)
    expect((await lireReservation(creee.reservation.id))?.statut).toBe('en_attente')

    const creneaux = await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: '2026-11-02',
      au: '2026-11-02',
      maintenant: REFERENCE_AGENDA,
    })
    expect(creneaux.creneaux.map((creneau) => valeurEnIso(creneau.debut))).not.toContain(iso(DEBUT_CRENEAU))
  })
})

describe('réservations : refus (S7-bis CA3..CA5)', () => {
  it('passe en_attente → refusee et écrit l’email reservation_visiteur_refusee dans l’outbox (CA3)', async () => {
    const { createReservation, refuseReservation } = await reservationsService()
    const { user, vitrine, service } = await preparerReservation('reservation-refus')
    const creee = await createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA)

    const { item: refusee } = await refuseReservation(user.id, creee.reservation.id)

    expect(refusee).toMatchObject({ id: creee.reservation.id, statut: 'refusee' })
    expect((await lireReservation(creee.reservation.id))?.statut).toBe('refusee')
    const outbox = await db.execute<{ type: string, statut: string }>(sql`
      SELECT type, statut FROM emails_transactionnels
      WHERE entite_type = 'reservation' AND entite_id = ${creee.reservation.id}
      ORDER BY type
    `)
    expect(outbox.rows).toEqual([
      { type: 'reservation_professionnel_nouvelle', statut: 'en_attente' },
      { type: 'reservation_visiteur_recue', statut: 'en_attente' },
      { type: 'reservation_visiteur_refusee', statut: 'en_attente' },
    ])
  })

  it('libère immédiatement le créneau refusé : créneaux re-proposés et nouvelle réservation en SQL réel (CA4)', async () => {
    const { listCreneaux } = await creneauxService()
    const { createReservation, refuseReservation } = await reservationsService()
    const { user, vitrine, service } = await preparerReservation('refus-creneau-libere')

    const creee = await createReservation(vitrine.username, inputReservation(service.slug), REFERENCE_AGENDA)
    await refuseReservation(user.id, creee.reservation.id)

    const apres = await listCreneaux({
      username: vitrine.username,
      serviceSlug: service.slug,
      du: '2026-11-02',
      au: '2026-11-02',
      maintenant: REFERENCE_AGENDA,
    })
    expect(apres.creneaux.map((creneau) => valeurEnIso(creneau.debut))).toContain(iso(DEBUT_CRENEAU))

    const seconde = await createReservation(vitrine.username, {
      ...inputReservation(service.slug),
      nom: 'Nouveau Visiteur Refus',
      email: 'nouveau.refus@exemple.test',
    }, REFERENCE_AGENDA)

    const statuts = (await lireReservations(vitrine.id)).map((ligne) => ligne.statut).sort()
    expect(statuts).toEqual(['en_attente', 'refusee'])
    expect(seconde.reservation.id).not.toBe(creee.reservation.id)
  })

  it('garde le refus terminal : re-refus et refus d’une confirmée = 422, autre vitrine = 404 (CA5)', async () => {
    const { createReservation, confirmReservation, refuseReservation } = await reservationsService()
    const a = await preparerReservation('refus-terminal-a')
    const b = await preparerReservation('refus-terminal-b')
    const creee = await createReservation(a.vitrine.username, inputReservation(a.service.slug), REFERENCE_AGENDA)

    await refuseReservation(a.user.id, creee.reservation.id)
    const reRefus = await rejet(refuseReservation(a.user.id, creee.reservation.id))
    expect(reRefus.estDomainError).toBe(true)
    expect(reRefus.code).toBe('TRANSITION_RESERVATION_INVALIDE')
    expect(reRefus.status).toBe(422)

    const confirmee = await createReservation(a.vitrine.username, {
      ...inputReservation(a.service.slug),
      nom: 'Confirmée Refus',
      email: 'confirmee.refus@exemple.test',
    }, REFERENCE_AGENDA)
    await confirmReservation(a.user.id, confirmee.reservation.id)
    const refusConfirmee = await rejet(refuseReservation(a.user.id, confirmee.reservation.id))
    expect(refusConfirmee.estDomainError).toBe(true)
    expect(refusConfirmee.code).toBe('TRANSITION_RESERVATION_INVALIDE')
    expect(refusConfirmee.status).toBe(422)
    expect((await lireReservation(confirmee.reservation.id))?.statut).toBe('confirmee')

    const isolation = await rejet(refuseReservation(b.user.id, creee.reservation.id))
    expect(isolation.estDomainError).toBe(true)
    expect(isolation.code).toBe('RESERVATION_INTROUVABLE')
    expect(isolation.status).toBe(404)
  })
})
