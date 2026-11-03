import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { RAPPEL_VISITEUR_AVANCE_HEURES, RAPPEL_VISITEUR_ECART_MIN_HEURES } from '../../shared/notifications'
import { reservations } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { insererDisponibilite, creerContexteAgenda, DEBUT_CRENEAU, REFERENCE_AGENDA, iso } from './support/agenda'
import { rejet } from './support/erreurs'
import { reservationsService } from './support/modules'
import {
  creerPro,
  heures,
  insererOutbox,
  insererReservation,
  lireOutbox,
  lireOutboxParId,
  utc,
  viderOutbox,
} from './support/notifications'
import type { Pro } from './support/notifications'
import { modulesEmailOutbox, traiter } from './support/planification'

// S9 §4.2, #84, #85 : le rappel visiteur est inséré DANS la transaction de confirmation (services réels, PostgreSQL
// réel), annulé dans la transaction d'annulation. L'horloge est injectée : confirmReservation(userId, id, now),
// cancelReservation(userId, id, input, now), refuseReservation(userId, id, now).
// Critères : CA07 à CA11, CA15, CA64 (CA08 + CA15).

const DEBUT = utc('2026-11-12T09:00:00.000Z') // jeudi 12 novembre 10:00 à Douala
const PREVU = new Date(DEBUT.getTime() - heures(RAPPEL_VISITEUR_AVANCE_HEURES)) // 2026-11-11T09:00:00Z
const CONFIRMATION = utc('2026-11-10T08:00:00.000Z')

beforeEach(async () => {
  await viderOutbox()
})

async function reservationEnAttente(pro: Pro, options: { debut?: Date, rappelEmail?: boolean } = {}) {
  return insererReservation(pro.vitrine.id, pro.service.id, {
    debut: options.debut ?? DEBUT,
    statut: 'en_attente',
    rappelEmail: options.rappelEmail ?? true,
  })
}

async function rappels(reservationId: string) {
  return lireOutbox({ entiteId: reservationId, type: 'reservation_visiteur_rappel' })
}

describe('confirmation : insertion du rappel (CA07, CA09, CA10)', () => {
  it('should insert one reminder line due 24 h before the start, with the start as occurrence (CA07)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)

    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)

    const lignes = await rappels(reservation.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      type: 'reservation_visiteur_rappel',
      entiteType: 'reservation',
      entiteId: reservation.id,
      occurrence: '2026-11-12T09:00:00.000Z',
      categorie: 'transactionnel',
      statut: 'en_attente',
      tentatives: 0,
    })
    expect(lignes[0]?.prochaineTentative?.toISOString()).toBe('2026-11-11T09:00:00.000Z')
    // Le courriel de confirmation S7 part toujours, avec la clé d'occurrence vide.
    const confirmation = await lireOutbox({ entiteId: reservation.id, type: 'reservation_visiteur_confirmee' })
    expect(confirmation).toHaveLength(1)
    expect(confirmation[0]?.occurrence).toBe('')
  })

  it('should insert no reminder when the visitor did not ask for one (CA09)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro, { rappelEmail: false })

    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)

    expect(await rappels(reservation.id)).toHaveLength(0)
    expect(await lireOutbox({ entiteId: reservation.id, type: 'reservation_visiteur_confirmee' })).toHaveLength(1)
  })

  it('should insert no reminder when the planned time is under 6 h after the confirmation: start in 27 h (CA10)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    const now = new Date(DEBUT.getTime() - heures(27))

    await confirmReservation(pro.user.id, reservation.id, now)

    expect(await rappels(reservation.id)).toHaveLength(0)
  })

  it('should keep the reminder when the planned time is exactly 6 h away and drop it one millisecond closer (boundary)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const limite = await reservationEnAttente(pro)
    const autre = await creerPro()
    const trop = await reservationEnAttente(autre)
    const pile = new Date(PREVU.getTime() - heures(RAPPEL_VISITEUR_ECART_MIN_HEURES))

    await confirmReservation(pro.user.id, limite.id, pile)
    await confirmReservation(autre.user.id, trop.id, new Date(pile.getTime() + 1))

    expect(await rappels(limite.id)).toHaveLength(1)
    expect(await rappels(trop.id)).toHaveLength(0)
  })

  it('should insert no reminder for an appointment already in the past (planned time before now)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)

    await confirmReservation(pro.user.id, reservation.id, new Date(DEBUT.getTime() + heures(1)))

    expect(await rappels(reservation.id)).toHaveLength(0)
  })

  it('should not duplicate the reminder nor lose it when the confirmation is attempted twice (the second is refused)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)

    const erreur = await rejet(confirmReservation(pro.user.id, reservation.id, CONFIRMATION))

    expect(erreur.code).toBe('TRANSITION_RESERVATION_INVALIDE')
    expect(await rappels(reservation.id)).toHaveLength(1)
  })

  it('should insert nothing when the confirmation itself fails (same transaction): another professional cannot confirm', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const intrus = await creerPro()
    const reservation = await reservationEnAttente(pro)

    const erreur = await rejet(confirmReservation(intrus.user.id, reservation.id, CONFIRMATION))

    expect(erreur.code).toBe('RESERVATION_INTROUVABLE')
    expect(await rappels(reservation.id)).toHaveLength(0)
    expect((await db.select().from(reservations).where(eq(reservations.id, reservation.id)))[0]?.statut).toBe('en_attente')
  })
})

describe('annulation et refus : la ligne en attente est annulée dans la même transaction (CA11)', () => {
  it('should turn the pending reminder into annule / RESERVATION_ANNULEE when the professional cancels, and send nothing at dispatch', async () => {
    const { confirmReservation, cancelReservation } = await reservationsService()
    const { listDispatchableTransactionalEmailIds } = await modulesEmailOutbox()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)

    await cancelReservation(pro.user.id, reservation.id, { motif: 'Indisponibilité' }, utc('2026-11-10T09:00:00.000Z'))

    const [ligne] = await rappels(reservation.id)
    expect(ligne).toMatchObject({ statut: 'annule', erreurCode: 'RESERVATION_ANNULEE' })
    expect(await listDispatchableTransactionalEmailIds(PREVU)).not.toContain(ligne?.id)
    const { transport } = await traiter(ligne!.id, PREVU)
    expect(transport.sends).toHaveLength(0)
    expect(await lireOutboxParId(ligne!.id)).toMatchObject({ statut: 'annule', erreurCode: 'RESERVATION_ANNULEE' })
    // L'annulation S7 est notifiée au visiteur comme avant.
    expect(await lireOutbox({ entiteId: reservation.id, type: 'reservation_visiteur_annulee' })).toHaveLength(1)
  })

  it('should leave a reminder that was already sent untouched when the appointment is cancelled afterwards', async () => {
    const { confirmReservation, cancelReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)
    const [ligne] = await rappels(reservation.id)
    await traiter(ligne!.id, PREVU)

    await cancelReservation(pro.user.id, reservation.id, {}, utc('2026-11-11T20:00:00.000Z'))

    expect(await lireOutboxParId(ligne!.id)).toMatchObject({ statut: 'envoye', erreurCode: null })
  })

  it('should only cancel the reminder of the reservation concerned, never the one of another reservation or professional', async () => {
    const { confirmReservation, cancelReservation } = await reservationsService()
    const pro = await creerPro()
    const autrePro = await creerPro()
    const visee = await reservationEnAttente(pro)
    const voisine = await reservationEnAttente(pro, { debut: new Date(DEBUT.getTime() + heures(3)) })
    const etrangere = await reservationEnAttente(autrePro)
    for (const [p, r] of [[pro, visee], [pro, voisine], [autrePro, etrangere]] as const) await confirmReservation(p.user.id, r.id, CONFIRMATION)

    await cancelReservation(pro.user.id, visee.id, {}, CONFIRMATION)

    expect((await rappels(visee.id))[0]?.statut).toBe('annule')
    expect((await rappels(voisine.id))[0]?.statut).toBe('en_attente')
    expect((await rappels(etrangere.id))[0]?.statut).toBe('en_attente')
  })

  it('should refuse a pending reservation without touching anything else: no reminder exists for it and none is created (CA11, refusal)', async () => {
    const { refuseReservation, confirmReservation } = await reservationsService()
    const pro = await creerPro()
    const refusee = await reservationEnAttente(pro)
    const confirmee = await reservationEnAttente(pro, { debut: new Date(DEBUT.getTime() + heures(3)) })
    await confirmReservation(pro.user.id, confirmee.id, CONFIRMATION)

    await refuseReservation(pro.user.id, refusee.id, CONFIRMATION)

    expect(await rappels(refusee.id)).toHaveLength(0)
    expect((await rappels(confirmee.id))[0]?.statut).toBe('en_attente')
    expect(await lireOutbox({ entiteId: refusee.id, type: 'reservation_visiteur_refusee' })).toHaveLength(1)
  })

  it('should turn a stray pending reminder of a refused reservation into annule too (defensive, same UPDATE as cancel)', async () => {
    const { refuseReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    const ligne = await insererOutbox({
      type: 'reservation_visiteur_rappel', entiteType: 'reservation', entiteId: reservation.id,
      occurrence: DEBUT.toISOString(), prochaineTentative: PREVU,
    })

    await refuseReservation(pro.user.id, reservation.id, CONFIRMATION)

    expect(await lireOutboxParId(ligne.id)).toMatchObject({ statut: 'annule', erreurCode: 'RESERVATION_ANNULEE' })
  })

  it('should end consistent when a confirmation and a cancellation race: never an active reminder for a cancelled reservation', async () => {
    const { confirmReservation, cancelReservation } = await reservationsService()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)

    await Promise.allSettled([
      confirmReservation(pro.user.id, reservation.id, CONFIRMATION),
      cancelReservation(pro.user.id, reservation.id, {}, CONFIRMATION),
    ])

    const [courante] = await db.select().from(reservations).where(eq(reservations.id, reservation.id))
    const actifs = (await rappels(reservation.id)).filter((l) => l.statut === 'en_attente')
    expect(courante?.statut).toBe('annulee')
    expect(actifs).toHaveLength(0)
  })
})

describe('de la confirmation à l’e-mail reçu (CA08, CA15, CA64)', () => {
  it('should hold the line until 09:00:00Z, then dispatch and send "jeudi 12 novembre 2026 à 10:00" heure de Douala (CA08)', async () => {
    const { confirmReservation } = await reservationsService()
    const { listDispatchableTransactionalEmailIds } = await modulesEmailOutbox()
    const pro = await creerPro()
    const reservation = await reservationEnAttente(pro)
    await confirmReservation(pro.user.id, reservation.id, CONFIRMATION)
    const [ligne] = await rappels(reservation.id)

    expect(await listDispatchableTransactionalEmailIds(new Date(PREVU.getTime() - 1000))).not.toContain(ligne!.id)
    expect(await listDispatchableTransactionalEmailIds(PREVU)).toContain(ligne!.id)
    const { transport, ligne: apres } = await traiter(ligne!.id, PREVU)

    expect(apres.statut).toBe('envoye')
    expect(transport.dernier.text).toContain('jeudi 12 novembre 2026 à 10:00')
  })

  it('should plan 24 absolute hours before a Paris appointment across the autumn DST change and word it in local time (CA15)', async () => {
    const { confirmReservation } = await reservationsService()
    const pro = await creerPro({ fuseau: 'Europe/Paris' })
    // Lundi 26 octobre 2026 10:00 à Paris (UTC+1 depuis le 25) = 09:00Z. 24 h plus tôt : 2026-10-25T09:00Z.
    const debut = utc('2026-10-26T09:00:00.000Z')
    const reservation = await reservationEnAttente(pro, { debut })

    await confirmReservation(pro.user.id, reservation.id, utc('2026-10-23T08:00:00.000Z'))
    const [ligne] = await rappels(reservation.id)
    const envoi = await traiter(ligne!.id, utc('2026-10-25T09:00:00.000Z'))

    expect(ligne?.prochaineTentative?.toISOString()).toBe('2026-10-25T09:00:00.000Z')
    expect(ligne?.occurrence).toBe('2026-10-26T09:00:00.000Z')
    expect(envoi.transport.dernier.text).toContain('lundi 26 octobre 2026 à 10:00')
  })

  it('should plan the real public flow end to end: a reservation created with rappelEmail=true is stored so and gets its reminder at confirmation', async () => {
    const { createReservation, confirmReservation } = await reservationsService()
    const contexte = await creerContexteAgenda({ username: 'rappel-bout-en-bout' })
    await insererDisponibilite(contexte.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '14:00' })
    const creee = await createReservation(contexte.vitrine.username, {
      serviceSlug: contexte.service.slug,
      debut: iso(DEBUT_CRENEAU),
      nom: 'Alice Visiteur',
      email: 'alice.visiteur@exemple.test',
      telephone: '+237699000002',
      note: 'Motif privé',
      paiementChoisi: 'sur_place',
      rappelEmail: true,
    }, REFERENCE_AGENDA)
    const [stockee] = await db.select().from(reservations).where(and(eq(reservations.id, creee.reservation.id)))
    expect(stockee?.rappelEmail).toBe(true)

    await confirmReservation(contexte.user.id, creee.reservation.id, utc('2026-10-31T12:00:00.000Z'))

    const [ligne] = await rappels(creee.reservation.id)
    expect(ligne).toMatchObject({ statut: 'en_attente', occurrence: DEBUT_CRENEAU.toISOString() })
    expect(ligne?.prochaineTentative?.toISOString()).toBe('2026-11-01T09:00:00.000Z')
  })
})
