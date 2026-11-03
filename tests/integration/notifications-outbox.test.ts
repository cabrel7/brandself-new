import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RAPPEL_JOURNEE_MAX_LIGNES,
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RAPPEL_VISITEUR_AVANCE_HEURES,
  RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  RESUME_RATTRAPAGE_HEURES,
} from '../../shared/notifications'
import { messages, reservations, users, vitrines } from '../../shared/db/schema'
import { transactionalEmailJobId } from '../../server/jobs/email-outbox'
import { getEmailsNotificationsQueue } from '../../server/jobs/queues'
import { db } from '../../server/utils/db'
import {
  RecordingTransport,
  VISITEUR_DEFAUT,
  creerPro,
  heures,
  insererOutbox,
  insererReservation,
  lireOutbox,
  lireOutboxParId,
  utc,
  viderOutbox,
} from './support/notifications'
import {
  modulesEmailOutbox,
  poserRappelVisiteur,
  traiter,
} from './support/planification'
import type { MessageAvecEntetes } from './support/planification'
import { rejet } from './support/erreurs'

// S9 §4.4, §4.5, §9 : l'outbox est le planificateur unique. PostgreSQL et Redis RÉELS ; la seule chose factice est le
// transport (Resend), remplacé par un transport d'enregistrement. L'horloge est toujours injectée (`now`).
// Critères : CA02, CA08 (dispatch), CA12 à CA17, CA22 à CA24, CA31, CA32, DESTINATAIRE_ABSENT (#101), #102.
//
// Signatures supposées (à communiquer au backend) :
//   - insertScheduledEmailEvent(tx, { entiteType, entiteId, type, occurrence, prochaineTentative, categorie }) : Promise<void>
//     (spec §4.2) ; ON CONFLICT DO NOTHING sur (entite_type, entite_id, type, occurrence) ;
//   - processTransactionalEmail(id, transport, now) résout { statut: 'annule' } (jamais ne rejette) pour une ligne
//     devenue non pertinente, avec statut='annule' + erreur_code = code d'annulation ; { statut: 'pas_encore' } si
//     prochaine_tentative > now, sans incrémenter `tentatives`.

const DEBUT = utc('2026-11-12T09:00:00.000Z')
const PREVU = new Date(DEBUT.getTime() - heures(RAPPEL_VISITEUR_AVANCE_HEURES))
const queue = getEmailsNotificationsQueue()

/** Attend TOUTES les promesses (même en cas d'échec) pour ne laisser aucune transaction orpheline au test suivant. */
async function toutesLesIssues<T>(promesses: Array<Promise<T>>): Promise<T[]> {
  const issues = await Promise.allSettled(promesses)
  return issues.map((issue) => {
    if (issue.status === 'rejected') throw issue.reason
    return issue.value
  })
}

beforeEach(async () => {
  // L'outbox n'a aucune clé étrangère vers users (entite_id est un texte) : le TRUNCATE du setup ne la vide pas.
  await viderOutbox()
  await queue.obliterate({ force: true })
})

describe('insertScheduledEmailEvent : clé d’occurrence (CA02)', () => {
  it('should insert one single line when the same occurrence is inserted twice (replay, two passes)', async () => {
    const { insertScheduledEmailEvent } = await modulesEmailOutbox()
    const pro = await creerPro()
    const entree = {
      entiteType: 'utilisateur' as const,
      entiteId: pro.user.id,
      type: 'utilisateur_resume_hebdo' as const,
      occurrence: '2026-W44',
      prochaineTentative: utc('2026-11-02T07:00:00.000Z'),
      categorie: 'relationnel' as const,
    }

    await db.transaction(async (tx) => insertScheduledEmailEvent(tx, entree))
    await db.transaction(async (tx) => insertScheduledEmailEvent(tx, entree))

    const lignes = await lireOutbox({ entiteId: pro.user.id })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      type: 'utilisateur_resume_hebdo',
      entiteType: 'utilisateur',
      occurrence: '2026-W44',
      categorie: 'relationnel',
      statut: 'en_attente',
      tentatives: 0,
    })
    expect(lignes[0]?.prochaineTentative?.toISOString()).toBe('2026-11-02T07:00:00.000Z')
  })

  it('should keep one line per occurrence: a weekly e-mail can recur the next week (the old 3-column key forbade it)', async () => {
    const { insertScheduledEmailEvent } = await modulesEmailOutbox()
    const pro = await creerPro()
    const base = { entiteType: 'utilisateur' as const, entiteId: pro.user.id, type: 'utilisateur_resume_hebdo' as const, categorie: 'relationnel' as const }

    await db.transaction(async (tx) => {
      await insertScheduledEmailEvent(tx, { ...base, occurrence: '2026-W44', prochaineTentative: utc('2026-11-02T07:00:00.000Z') })
      await insertScheduledEmailEvent(tx, { ...base, occurrence: '2026-W45', prochaineTentative: utc('2026-11-09T07:00:00.000Z') })
    })

    expect((await lireOutbox({ entiteId: pro.user.id })).map((l) => l.occurrence).sort()).toEqual(['2026-W44', '2026-W45'])
  })

  it('should let the same occurrence coexist across different entities and different types', async () => {
    const { insertScheduledEmailEvent } = await modulesEmailOutbox()
    const a = await creerPro()
    const b = await creerPro()

    await db.transaction(async (tx) => {
      await insertScheduledEmailEvent(tx, { entiteType: 'utilisateur', entiteId: a.user.id, type: 'utilisateur_rappel_journee', occurrence: '2026-11-10', prochaineTentative: new Date(), categorie: 'transactionnel' })
      await insertScheduledEmailEvent(tx, { entiteType: 'utilisateur', entiteId: b.user.id, type: 'utilisateur_rappel_journee', occurrence: '2026-11-10', prochaineTentative: new Date(), categorie: 'transactionnel' })
      await insertScheduledEmailEvent(tx, { entiteType: 'utilisateur', entiteId: a.user.id, type: 'utilisateur_resume_hebdo', occurrence: '2026-11-10', prochaineTentative: new Date(), categorie: 'relationnel' })
    })

    expect(await lireOutbox({ type: 'utilisateur_rappel_journee' })).toHaveLength(2)
    expect(await lireOutbox({ type: 'utilisateur_resume_hebdo' })).toHaveLength(1)
  })
})

describe('dispatch : seules les lignes à échéance partent (CA08, première moitié)', () => {
  it('should list a reminder line only from its scheduled instant (08:59:59.999Z no, 09:00:00.000Z yes)', async () => {
    const { listDispatchableTransactionalEmailIds } = await modulesEmailOutbox()
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    const avant = await listDispatchableTransactionalEmailIds(new Date(PREVU.getTime() - 1))
    const pile = await listDispatchableTransactionalEmailIds(PREVU)

    expect(avant).not.toContain(ligne.id)
    expect(pile).toContain(ligne.id)
  })

  it('should enqueue a deterministic job without any personal data once the line is due, and nothing before', async () => {
    const { dispatchPendingTransactionalEmails } = await import('../../server/jobs/email-outbox')
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    expect(await dispatchPendingTransactionalEmails(queue, new Date(PREVU.getTime() - 1000))).toBe(0)
    expect(await queue.getJobs(['waiting', 'delayed'])).toHaveLength(0)

    expect(await dispatchPendingTransactionalEmails(queue, PREVU)).toBe(1)
    expect(await dispatchPendingTransactionalEmails(queue, PREVU)).toBe(1)

    const jobs = await queue.getJobs(['waiting', 'delayed'])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.id).toBe(transactionalEmailJobId(ligne.id))
    expect(jobs[0]?.data).toEqual({ outboxId: ligne.id })
  })

  it.each(['envoye', 'echec', 'annule'] as const)('should never list a line in terminal status %s', async (statut) => {
    const { listDispatchableTransactionalEmailIds } = await modulesEmailOutbox()
    const pro = await creerPro()
    const ligne = await insererOutbox({
      type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: pro.user.id, occurrence: '2026-W44',
      statut, prochaineTentative: utc('2026-11-02T07:00:00.000Z'),
    })

    expect(await listDispatchableTransactionalEmailIds(utc('2026-11-03T07:00:00.000Z'))).not.toContain(ligne.id)
  })
})

describe('garde-fou « pas encore » (CA17)', () => {
  it('should answer pas_encore without sending nor incrementing the attempts when prochaine_tentative is in the future', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, new Date(PREVU.getTime() - 1))

    expect(resultat).toMatchObject({ statut: 'pas_encore' })
    expect(transport.sends).toHaveLength(0)
    expect(apres).toMatchObject({ statut: 'en_attente', tentatives: 0 })
    expect(apres.prochaineTentative?.getTime()).toBe(PREVU.getTime())
    expect(apres.updatedAt.getTime()).toBe(ligne.updatedAt.getTime())
  })

  it('should send exactly at the scheduled instant (the comparison is inclusive)', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    const { resultat, transport } = await traiter(ligne.id, PREVU)

    expect(resultat).toMatchObject({ statut: 'envoye' })
    expect(transport.sends).toHaveLength(1)
  })

  it('should also hold back an old S7 line whose retry delay has not elapsed (no regression on the S7 types)', async () => {
    const pro = await creerPro()
    const messageId = 'message-attente'
    await db.insert(messages).values({ id: messageId, vitrineId: pro.vitrine.id, nom: 'Paul', email: 'p@exemple.test', sujet: 'autre', message: 'Bonjour' })
    const ligne = await insererOutbox({
      type: 'message_professionnel_nouvelle', entiteType: 'message', entiteId: messageId,
      tentatives: 1, prochaineTentative: utc('2026-11-02T10:00:10.000Z'),
    })

    const { resultat, transport, ligne: apres } = await traiter(ligne.id, utc('2026-11-02T10:00:00.000Z'))

    expect(resultat).toMatchObject({ statut: 'pas_encore' })
    expect(transport.sends).toHaveLength(0)
    expect(apres.tentatives).toBe(1)
  })
})

describe('concurrence : deux workers sur la même ligne (CA16)', () => {
  it('should call the transport once and end with an envoye line when two workers process the same line', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const transport = new RecordingTransport({ delaiMs: 250 })
    const { processTransactionalEmail } = await modulesEmailOutbox()

    const resultats = await toutesLesIssues([
      processTransactionalEmail(ligne.id, transport, PREVU),
      processTransactionalEmail(ligne.id, transport, PREVU),
    ])

    expect(transport.sends).toHaveLength(1)
    const statuts = resultats.map((r) => r.statut)
    expect(statuts).toContain('envoye')
    expect(statuts.filter((s) => s !== 'envoye')).toEqual([expect.stringMatching(/^(deja_envoye|en_cours)$/)])
    expect(await lireOutboxParId(ligne.id)).toMatchObject({ statut: 'envoye', tentatives: 1, erreurCode: null })
    expect(transport.sends[0]?.idempotencyKey).toBe(`brandself-email-${ligne.id}`)
  })

  it('should still send once with five simultaneous workers', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const transport = new RecordingTransport({ delaiMs: 150 })
    const { processTransactionalEmail } = await modulesEmailOutbox()

    await toutesLesIssues(Array.from({ length: 5 }, () => processTransactionalEmail(ligne.id, transport, PREVU)))

    expect(transport.sends).toHaveLength(1)
    expect((await lireOutboxParId(ligne.id)).statut).toBe('envoye')
  })

  it('should not send a second time when the line is replayed after being sent', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const transport = new RecordingTransport()

    await traiter(ligne.id, PREVU, transport)
    const rejeu = await traiter(ligne.id, new Date(PREVU.getTime() + 60_000), transport)

    expect(rejeu.resultat).toMatchObject({ statut: 'deja_envoye' })
    expect(transport.sends).toHaveLength(1)
  })
})

describe('rappel visiteur : envoi et revalidation (CA08, CA12, CA13)', () => {
  it('should send the reminder to the visitor in the vitrine timezone, without text-only leaks and without unsubscribe headers (CA08, CA45, #100)', async () => {
    const pro = await creerPro({ username: 'rappel-contenu' })
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    const { resultat, transport, ligne: apres } = await traiter(ligne.id, PREVU)

    expect(resultat).toMatchObject({ statut: 'envoye' })
    const message = transport.dernier as MessageAvecEntetes
    expect(message.to).toBe(VISITEUR_DEFAUT.email)
    expect(message.subject).toBe('Rappel : votre rendez-vous du jeudi 12 novembre à 10:00')
    expect(message.text).toContain('jeudi 12 novembre 2026 à 10:00')
    expect(message.text).toContain('Consultation de cardiologie')
    expect(message.text).toContain('rappel-contenu')
    expect(message.text).not.toContain(VISITEUR_DEFAUT.note)
    expect(message.text).not.toContain(VISITEUR_DEFAUT.telephone)
    expect(message.text).not.toMatch(/<[a-z][^>]*>/i)
    expect(message.attachments).toEqual([])
    expect(message.headers?.['List-Unsubscribe']).toBeUndefined()
    expect(message.headers?.['List-Unsubscribe-Post']).toBeUndefined()
    expect(apres).toMatchObject({ statut: 'envoye', erreurCode: null })
    expect(apres.envoyeLe?.getTime()).toBe(PREVU.getTime())
  })

  it.each([
    ['annulee'],
    ['refusee'],
    ['en_attente'],
    ['terminee'],
  ] as const)('should cancel without sending when the reservation is %s (statut changed outside the service, CA12)', async (statut) => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT, statut })

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, PREVU)

    expect(resultat).toMatchObject({ statut: 'annule' })
    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'RESERVATION_NON_CONFIRMEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with PREFERENCE_DESACTIVEE when the visitor choice is no longer true (arbitrage 7)', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT, rappelEmail: false })

    const { ligne: apres, transport } = await traiter(ligne.id, PREVU)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'PREFERENCE_DESACTIVEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with VITRINE_NON_PUBLIEE when the vitrine was unpublished after the reminder was planned', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })
    await db.update(vitrines).set({ publieeLe: null }).where(eq(vitrines.id, pro.vitrine.id))

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, PREVU)

    expect(resultat).toMatchObject({ statut: 'annule' })
    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'VITRINE_NON_PUBLIEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with RAPPEL_PERIME when the appointment was moved after the line was planned (occurrence no longer matches)', async () => {
    const pro = await creerPro()
    const { ligne, reservationId } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const deplace = new Date(DEBUT.getTime() + heures(5))
    await db.update(reservations).set({ debut: deplace, fin: new Date(deplace.getTime() + 1_800_000) }).where(eq(reservations.id, reservationId))

    const { ligne: apres, transport } = await traiter(ligne.id, PREVU)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with ENTITE_INTROUVABLE when the reservation disappeared', async () => {
    const pro = await creerPro()
    const { ligne, reservationId } = await poserRappelVisiteur(pro, { debut: DEBUT })
    await db.delete(reservations).where(eq(reservations.id, reservationId))

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, PREVU)

    expect(resultat).toMatchObject({ statut: 'annule' })
    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ENTITE_INTROUVABLE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should send up to 6 hours late (boundary included) and drop the reminder one millisecond later (CA13)', async () => {
    const pro = await creerPro()
    const limite = new Date(PREVU.getTime() + heures(RAPPEL_VISITEUR_RATTRAPAGE_HEURES))
    const { ligne: aTemps } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const autre = await creerPro()
    const { ligne: enRetard } = await poserRappelVisiteur(autre, { debut: DEBUT })

    const pile = await traiter(aTemps.id, limite)
    const trop = await traiter(enRetard.id, new Date(limite.getTime() + 1))

    expect(pile.resultat).toMatchObject({ statut: 'envoye' })
    expect(pile.transport.sends).toHaveLength(1)
    expect(trop.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(trop.transport.sends).toHaveLength(0)
  })

  it('should drop a reminder processed after a 7-hour worker outage (08:00Z to 16:00Z, no stale e-mail, CA13)', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })

    const { ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-11T16:00:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should not retry a cancelled line: a second pass sends nothing and keeps the cancellation code', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT, statut: 'annulee' })
    const transport = new RecordingTransport()

    await traiter(ligne.id, PREVU, transport)
    const second = await traiter(ligne.id, new Date(PREVU.getTime() + 5000), transport)

    expect(transport.sends).toHaveLength(0)
    expect(second.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RESERVATION_NON_CONFIRMEE' })
  })

  it('should keep the S7 retry path for a provider failure on a reminder: en_attente, attempt counted, safe error code', async () => {
    const pro = await creerPro()
    const { ligne } = await poserRappelVisiteur(pro, { debut: DEBUT })
    const transport = new RecordingTransport({ echecs: 1 })
    const { processTransactionalEmail } = await modulesEmailOutbox()

    const erreur = await rejet(processTransactionalEmail(ligne.id, transport, PREVU))

    expect(erreur.message).toBe('ENVOI_INCONNU')
    expect(await lireOutboxParId(ligne.id)).toMatchObject({ statut: 'en_attente', tentatives: 1, erreurCode: 'ENVOI_INCONNU' })
  })
})

describe('rendez-vous du jour : envoi et revalidation (CA22, CA23, CA24, #86)', () => {
  const JOUR = '2026-11-10'
  const CREE_A = utc('2026-11-10T06:00:00.000Z')

  async function ligneJournee(userId: string, overrides: { occurrence?: string, createdAt?: Date } = {}) {
    return insererOutbox({
      type: 'utilisateur_rappel_journee', entiteType: 'utilisateur', entiteId: userId,
      occurrence: overrides.occurrence ?? JOUR, createdAt: overrides.createdAt ?? CREE_A, prochaineTentative: overrides.createdAt ?? CREE_A,
    })
  }

  it('should list the confirmed and the pending appointments of the day, mark the pending one, and leak no visitor contact (CA23, #100)', async () => {
    const pro = await creerPro({ prenom: 'Cabrel' })
    // 09:00 et 11:30 heure de Douala (UTC+1).
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T08:00:00.000Z'), statut: 'confirmee', nom: 'Marie Ndzi' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T10:30:00.000Z'), statut: 'en_attente', nom: 'Paul Ewane', email: 'paul.ewane@exemple.test', telephone: '+237699000099', note: 'AUTRE MOTIF PRIVE' })
    const ligne = await ligneJournee(pro.user.id)

    const { resultat, transport, ligne: apres } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(resultat).toMatchObject({ statut: 'envoye' })
    const message = transport.dernier as MessageAvecEntetes
    expect(message.to).toBe(pro.user.email)
    expect(message.subject).toBe('Vos rendez-vous du mardi 10 novembre')
    expect(message.text).toContain('Bonjour Cabrel,')
    expect(message.text).toContain('2 rendez-vous, dont 1 à confirmer')
    expect(message.text).toMatch(/09:00 — Consultation de cardiologie — Marie Ndzi\b(?! \(à confirmer\))/)
    expect(message.text).toMatch(/11:30 — Consultation de cardiologie — Paul Ewane \(à confirmer\)/)
    expect(message.text.indexOf('09:00')).toBeLessThan(message.text.indexOf('11:30'))
    for (const secret of [VISITEUR_DEFAUT.email, VISITEUR_DEFAUT.telephone, VISITEUR_DEFAUT.note, 'paul.ewane@exemple.test', '+237699000099', 'AUTRE MOTIF PRIVE']) {
      expect(message.text).not.toContain(secret)
    }
    expect(apres.statut).toBe('envoye')
  })

  it('should word the subject in the singular for a single appointment and ignore cancelled, refused, finished and other-day reservations', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T08:00:00.000Z'), statut: 'confirmee' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T09:00:00.000Z'), statut: 'annulee' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T10:00:00.000Z'), statut: 'refusee' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T11:00:00.000Z'), statut: 'terminee' })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-11T08:00:00.000Z'), statut: 'confirmee' })
    const ligne = await ligneJournee(pro.user.id)

    const { transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(transport.dernier.subject).toBe('Votre rendez-vous du mardi 10 novembre')
    expect(transport.dernier.text).toMatch(/1 rendez-vous\b/)
    expect(transport.dernier.text).not.toContain('dont')
  })

  it('should cap the detailed list at 20 lines and summarize the remainder ("… et 2 autres.")', async () => {
    const pro = await creerPro()
    const total = RAPPEL_JOURNEE_MAX_LIGNES + 2
    for (let i = 0; i < total; i += 1) {
      await insererReservation(pro.vitrine.id, pro.service.id, { debut: new Date(utc('2026-11-10T06:00:00.000Z').getTime() + i * 1_800_000), statut: 'confirmee' })
    }
    const ligne = await ligneJournee(pro.user.id)

    const { transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    const lignesDetail = transport.dernier.text.split('\n').filter((l) => l.startsWith('•'))
    expect(lignesDetail).toHaveLength(RAPPEL_JOURNEE_MAX_LIGNES)
    expect(transport.dernier.text).toContain(`${total} rendez-vous`)
    expect(transport.dernier.text).toContain('… et 2 autres.')
  })

  it('should carry the one-click unsubscribe headers for the preference email_rappel_jour and a link in the footer (CA45, #90)', async () => {
    const { verifyUnsubscribeToken } = await import('../../server/services/desabonnement')
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T08:00:00.000Z'), statut: 'confirmee' })
    const ligne = await ligneJournee(pro.user.id)

    const { transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    const message = transport.dernier as MessageAvecEntetes
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const entete = message.headers?.['List-Unsubscribe'] ?? ''
    expect(entete).toMatch(/^<https?:\/\/[^>]+\/api\/public\/desabonnement\?jeton=[A-Za-z0-9_.-]+>$/)
    const jeton = /jeton=([A-Za-z0-9_.-]+)/.exec(entete)?.[1] ?? ''
    expect(await verifyUnsubscribeToken(jeton, CREE_A)).toEqual({ userId: pro.user.id, preference: 'email_rappel_jour' })
    expect(message.text).toMatch(/\/desabonnement\?jeton=[A-Za-z0-9_.-]+/)
    expect(message.text).toContain('/studio/compte')
    expect(message.text).toContain('Vous recevez')
  })

  it('should cancel with AUCUN_RENDEZ_VOUS when the only appointment was cancelled after planning (CA22)', async () => {
    const pro = await creerPro()
    const reservation = await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    const ligne = await ligneJournee(pro.user.id)
    await db.update(reservations).set({ statut: 'annulee' }).where(eq(reservations.id, reservation.id))

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(resultat).toMatchObject({ statut: 'annule' })
    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'AUCUN_RENDEZ_VOUS' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should recompute the day in the CURRENT timezone: an appointment that left the day after a timezone change is not announced', async () => {
    const pro = await creerPro({ fuseau: 'Africa/Douala' })
    // 04:30Z = 05:30 le 10 à Douala, mais 23:30 le 9 à New York (UTC-5 en novembre).
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T04:30:00.000Z'), statut: 'confirmee' })
    const ligne = await ligneJournee(pro.user.id)
    await db.update(users).set({ fuseau: 'America/New_York' }).where(eq(users.id, pro.user.id))

    const { ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'AUCUN_RENDEZ_VOUS' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with PREFERENCE_DESACTIVEE when the preference is switched off between planning and sending (CA24)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    const ligne = await ligneJournee(pro.user.id)
    await db.update(users).set({ email_rappel_jour: false }).where(eq(users.id, pro.user.id))

    const { ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'PREFERENCE_DESACTIVEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should send up to 3 hours after the line was created and drop it one millisecond later (catch-up window)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    const autre = await creerPro()
    await insererReservation(autre.vitrine.id, autre.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    const limite = new Date(CREE_A.getTime() + heures(RAPPEL_JOURNEE_RATTRAPAGE_HEURES))
    const ligneOk = await ligneJournee(pro.user.id)
    const ligneTrop = await ligneJournee(autre.user.id)

    const pile = await traiter(ligneOk.id, limite)
    const trop = await traiter(ligneTrop.id, new Date(limite.getTime() + 1))

    expect(pile.resultat).toMatchObject({ statut: 'envoye' })
    expect(trop.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(trop.transport.sends).toHaveLength(0)
  })
})

describe('destinataire et compte supprimé (#101, #102, CA32, CA33)', () => {
  it('should cancel with DESTINATAIRE_ABSENT for an account with a temporary e-mail and no contact e-mail, with no retry (journée)', async () => {
    const pro = await creerPro({ emailTemporaire: true, emailContact: null })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    const ligne = await insererOutbox({ type: 'utilisateur_rappel_journee', entiteType: 'utilisateur', entiteId: pro.user.id, occurrence: '2026-11-10', createdAt: utc('2026-11-10T06:00:00.000Z') })

    const { resultat, ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-10T06:05:00.000Z'))

    expect(resultat).toMatchObject({ statut: 'annule' })
    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'DESTINATAIRE_ABSENT' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with DESTINATAIRE_ABSENT for the weekly summary too, and deliver to the contact e-mail when there is one', async () => {
    const sans = await creerPro({ emailTemporaire: true, emailContact: null })
    const avec = await creerPro({ emailTemporaire: true, emailContact: 'contact@exemple.test' })
    const creeA = utc('2026-11-02T07:00:00.000Z')
    const ligneSans = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: sans.user.id, occurrence: '2026-W44', createdAt: creeA })
    const ligneAvec = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: avec.user.id, occurrence: '2026-W44', createdAt: creeA })

    const a = await traiter(ligneSans.id, utc('2026-11-02T07:05:00.000Z'))
    const b = await traiter(ligneAvec.id, utc('2026-11-02T07:05:00.000Z'))

    expect(a.ligne).toMatchObject({ statut: 'annule', erreurCode: 'DESTINATAIRE_ABSENT' })
    expect(a.transport.sends).toHaveLength(0)
    expect(b.ligne.statut).toBe('envoye')
    expect(b.transport.dernier.to).toBe('contact@exemple.test')
  })

  it('should address the weekly summary to the account e-mail when it is a real one, even if a contact e-mail exists', async () => {
    const pro = await creerPro({ email: 'compte@exemple.test', emailContact: 'contact@exemple.test' })
    const ligne = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: pro.user.id, occurrence: '2026-W44', createdAt: utc('2026-11-02T07:00:00.000Z') })

    const { transport } = await traiter(ligne.id, utc('2026-11-02T07:05:00.000Z'))

    expect(transport.dernier.to).toBe('compte@exemple.test')
  })

  it('should cancel with ENTITE_INTROUVABLE, without a new attempt, when the account was deleted after planning (CA32, cascade)', async () => {
    const pro = await creerPro()
    const ligne = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: pro.user.id, occurrence: '2026-W44', createdAt: utc('2026-11-02T07:00:00.000Z') })
    await db.delete(users).where(eq(users.id, pro.user.id))
    const transport = new RecordingTransport()

    const premier = await traiter(ligne.id, utc('2026-11-02T07:05:00.000Z'), transport)
    const second = await traiter(ligne.id, utc('2026-11-02T07:06:00.000Z'), transport)

    expect(premier.resultat).toMatchObject({ statut: 'annule' })
    expect(premier.ligne).toMatchObject({ statut: 'annule', erreurCode: 'ENTITE_INTROUVABLE' })
    expect(second.ligne).toMatchObject({ statut: 'annule', erreurCode: 'ENTITE_INTROUVABLE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should keep the S7 behavior for a missing entity of an S7 type: failure with ENTITE_INTROUVABLE and a retry, NOT a cancellation (#102)', async () => {
    const ligne = await insererOutbox({ type: 'message_professionnel_nouvelle', entiteType: 'message', entiteId: 'message-disparu' })
    const { processTransactionalEmail } = await modulesEmailOutbox()
    const transport = new RecordingTransport()

    const erreur = await rejet(processTransactionalEmail(ligne.id, transport, new Date()))

    expect(erreur.message).toBe('ENTITE_INTROUVABLE')
    expect(await lireOutboxParId(ligne.id)).toMatchObject({ statut: 'en_attente', tentatives: 1, erreurCode: 'ENTITE_INTROUVABLE' })
    expect(transport.sends).toHaveLength(0)
  })
})

describe('résumé hebdomadaire : revalidation à l’envoi (CA31, CA24)', () => {
  const CREE_A = utc('2026-11-02T07:00:00.000Z')

  async function ligneResume(userId: string) {
    return insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: userId, occurrence: '2026-W44', createdAt: CREE_A, prochaineTentative: CREE_A })
  }

  it('should cancel with VITRINE_NON_PUBLIEE when the vitrine was unpublished after planning (CA31)', async () => {
    const pro = await creerPro()
    const ligne = await ligneResume(pro.user.id)
    await db.update(vitrines).set({ publieeLe: null }).where(eq(vitrines.id, pro.vitrine.id))

    const { ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-02T07:05:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'VITRINE_NON_PUBLIEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with PREFERENCE_DESACTIVEE when the user unsubscribed after planning', async () => {
    const pro = await creerPro()
    const ligne = await ligneResume(pro.user.id)
    await db.update(users).set({ email_hebdo: false }).where(eq(users.id, pro.user.id))

    const { ligne: apres, transport } = await traiter(ligne.id, utc('2026-11-02T07:05:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'PREFERENCE_DESACTIVEE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should send up to 6 hours after planning and drop it one millisecond later', async () => {
    const pro = await creerPro()
    const autre = await creerPro()
    const limite = new Date(CREE_A.getTime() + heures(RESUME_RATTRAPAGE_HEURES))
    const ok = await ligneResume(pro.user.id)
    const trop = await ligneResume(autre.user.id)

    const pile = await traiter(ok.id, limite)
    const tard = await traiter(trop.id, new Date(limite.getTime() + 1))

    expect(pile.ligne.statut).toBe('envoye')
    expect(tard.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(tard.transport.sends).toHaveLength(0)
  })

  it('should carry the one-click headers for email_hebdo and a plain-text body without visits nor clicks (CA27, CA45)', async () => {
    const { verifyUnsubscribeToken } = await import('../../server/services/desabonnement')
    const pro = await creerPro()
    const ligne = await ligneResume(pro.user.id)

    const { transport } = await traiter(ligne.id, utc('2026-11-02T07:05:00.000Z'))

    const message = transport.dernier as MessageAvecEntetes
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const jeton = /jeton=([A-Za-z0-9_.-]+)/.exec(message.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? ''
    expect(await verifyUnsubscribeToken(jeton, CREE_A)).toEqual({ userId: pro.user.id, preference: 'email_hebdo' })
    expect(message.text).not.toMatch(/visites|clics/i)
    expect(message.text).not.toMatch(/<[a-z][^>]*>/i)
  })
})

describe('isolation : aucune fuite entre professionnels', () => {
  it('should never address a summary to another account: each line only ever reaches its own owner', async () => {
    const a = await creerPro({ email: 'a@exemple.test' })
    const b = await creerPro({ email: 'b@exemple.test' })
    const creeA = utc('2026-11-02T07:00:00.000Z')
    const la = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: a.user.id, occurrence: '2026-W44', createdAt: creeA })
    const lb = await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: b.user.id, occurrence: '2026-W44', createdAt: creeA })
    const transport = new RecordingTransport()

    await traiter(la.id, utc('2026-11-02T07:05:00.000Z'), transport)
    await traiter(lb.id, utc('2026-11-02T07:05:00.000Z'), transport)

    expect(transport.sends.map((s) => s.message.to).sort()).toEqual(['a@exemple.test', 'b@exemple.test'])
    expect(new Set(transport.sends.map((s) => s.idempotencyKey)).size).toBe(2)
  })
})
