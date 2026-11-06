import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users, vitrines } from '../../shared/db/schema'
import {
  PLANIFICATION_LOT_UTILISATEURS,
  SUGGESTION_RESUME_DEFAUT,
} from '../../shared/notifications'
import { PROCHAINES_ETAPES } from '../../shared/prochaine-etape'
import { db } from '../../server/utils/db'
import { insererDisponibilite } from './support/agenda'
import { insertRealisation } from './support/fabriques'
import {
  changerFuseau,
  creerPro,
  heures,
  insererDemande,
  insererMessage,
  insererOutbox,
  insererReservation,
  lireOutbox,
  utc,
  viderOutbox,
} from './support/notifications'
import type { EspionJournaux } from './support/planification'
import {
  ajouterPhoto,
  espionnerJournaux,
  modulesPlanification,
  traiter,
} from './support/planification'

// S9 §4.3, §9 : `planifierNotifications(now)` contre la VRAIE base, horloge injectée (jamais l'heure réelle).
// Critères : CA18 à CA21, CA25, CA26 à CA30, CA31 (planification), CA33 à CA38, #86, #87, #88, #98.
//
// Signature supposée (spec §4.3) : planifierNotifications(now: Date) → { resumes, rappelsJour, fuseauxInvalides }.
// Chaque ligne insérée porte createdAt = prochaineTentative = now (le rattrapage se mesure depuis createdAt).

async function planifier(now: Date) {
  const { planifierNotifications } = await modulesPlanification()
  return planifierNotifications(now)
}

let journaux: EspionJournaux | undefined

beforeEach(async () => {
  await viderOutbox()
})

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

describe('rendez-vous du jour : fenêtre de 7 h locale, un seul par jour (CA18, CA19, CA21)', () => {
  // 2026-11-10 est un mardi (aucun résumé ce jour-là) ; Africa/Douala = UTC+1 toute l'année.
  const RDV = utc('2026-11-10T13:00:00.000Z') // 14:00 locale

  it('should plan nothing at 06:55 local and one line at 07:00 local, with occurrence = local date (CA18)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: RDV, statut: 'confirmee' })

    const avant = await planifier(utc('2026-11-10T05:55:00.000Z'))
    expect(avant).toMatchObject({ resumes: 0, rappelsJour: 0, fuseauxInvalides: 0 })
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(0)

    const maintenant = utc('2026-11-10T06:00:00.000Z')
    const pile = await planifier(maintenant)

    expect(pile).toMatchObject({ resumes: 0, rappelsJour: 1, fuseauxInvalides: 0 })
    const lignes = await lireOutbox({ entiteId: pro.user.id })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      type: 'utilisateur_rappel_journee',
      entiteType: 'utilisateur',
      occurrence: '2026-11-10',
      categorie: 'transactionnel',
      statut: 'en_attente',
      tentatives: 0,
    })
    expect(lignes[0]?.createdAt.getTime()).toBe(maintenant.getTime())
    expect(lignes[0]?.prochaineTentative?.getTime()).toBe(maintenant.getTime())
  })

  it('should keep a single line when the planner runs again at 07:05 and 07:10 local (CA19)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: RDV, statut: 'confirmee' })

    await planifier(utc('2026-11-10T06:00:00.000Z'))
    const second = await planifier(utc('2026-11-10T06:05:00.000Z'))
    await planifier(utc('2026-11-10T06:10:00.000Z'))

    expect(second.rappelsJour).toBe(0)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)
  })

  it('should plan right up to 10:00 local (7 h + 3 h, exclusive) and not after (CA21)', async () => {
    const dedans = await creerPro()
    const dehors = await creerPro()
    for (const p of [dedans, dehors]) await insererReservation(p.vitrine.id, p.service.id, { debut: RDV, statut: 'confirmee' })

    // 10:00 locale = 09:00Z : la dernière milliseconde de la fenêtre planifie encore, l'instant suivant plus.
    await planifier(new Date(utc('2026-11-10T09:00:00.000Z').getTime() - 1))
    const lignesApresDernierInstant = await lireOutbox({ type: 'utilisateur_rappel_journee' })
    expect(lignesApresDernierInstant.map((l) => l.entiteId).sort()).toEqual([dedans.user.id, dehors.user.id].sort())

    await viderOutbox()
    const reprise = await planifier(utc('2026-11-10T09:30:00.000Z'))
    expect(reprise.rappelsJour).toBe(0)
    expect(await lireOutbox({ type: 'utilisateur_rappel_journee' })).toHaveLength(0)
  })

  it('should plan nothing for a planner that was down from 06:00Z to 09:30Z (10:30 local) (CA21)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: RDV, statut: 'confirmee' })

    const reprise = await planifier(utc('2026-11-10T09:30:00.000Z'))

    expect(reprise.rappelsJour).toBe(0)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(0)
  })
})

describe('rendez-vous du jour : quels rendez-vous comptent (CA20, CA24, CA33, #86)', () => {
  const MAINTENANT = utc('2026-11-10T06:00:00.000Z')

  it('should plan nothing for appointments outside the local day: 23:30 the day before and 00:00 the day after (CA20)', async () => {
    const pro = await creerPro()
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-09T22:30:00.000Z'), statut: 'confirmee' }) // 23:30 locale la veille
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T23:00:00.000Z'), statut: 'confirmee' }) // 00:00 locale le lendemain

    await planifier(MAINTENANT)

    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(0)
  })

  it('should include an appointment at exactly 00:00 local and exclude one at 23:59:59.999 the day before (the day is [start, end))', async () => {
    const inclus = await creerPro()
    const exclu = await creerPro()
    await insererReservation(inclus.vitrine.id, inclus.service.id, { debut: utc('2026-11-09T23:00:00.000Z'), statut: 'confirmee' })
    await insererReservation(exclu.vitrine.id, exclu.service.id, { debut: utc('2026-11-09T22:59:59.999Z'), statut: 'confirmee' })

    await planifier(MAINTENANT)

    expect((await lireOutbox({ entiteId: inclus.user.id }))).toHaveLength(1)
    expect((await lireOutbox({ entiteId: exclu.user.id }))).toHaveLength(0)
  })

  it('should count a pending appointment (to confirm) but never a cancelled, refused or finished one (RAPPEL_JOURNEE_STATUTS)', async () => {
    const attente = await creerPro()
    const inactif = await creerPro()
    await insererReservation(attente.vitrine.id, attente.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'en_attente' })
    for (const [i, statut] of (['annulee', 'refusee', 'terminee'] as const).entries()) {
      await insererReservation(inactif.vitrine.id, inactif.service.id, { debut: new Date(utc('2026-11-10T10:00:00.000Z').getTime() + i * heures(1)), statut })
    }

    await planifier(MAINTENANT)

    expect(await lireOutbox({ entiteId: attente.user.id })).toHaveLength(1)
    expect(await lireOutbox({ entiteId: inactif.user.id })).toHaveLength(0)
  })

  it('should plan nothing when the user switched the preference off (CA24)', async () => {
    const pro = await creerPro({ emailRappelJour: false })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })

    const resultat = await planifier(MAINTENANT)

    expect(resultat.rappelsJour).toBe(0)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(0)
  })

  it('should plan nothing for a temporary e-mail without contact e-mail, but plan for one with a contact e-mail (CA33, #101)', async () => {
    const sans = await creerPro({ emailTemporaire: true, emailContact: null })
    const avec = await creerPro({ emailTemporaire: true, emailContact: 'contact@exemple.test' })
    for (const p of [sans, avec]) await insererReservation(p.vitrine.id, p.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })

    await planifier(MAINTENANT)

    expect(await lireOutbox({ entiteId: sans.user.id })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: avec.user.id })).toHaveLength(1)
  })

  it('should never mix the appointments of two professionals (isolation)', async () => {
    const a = await creerPro()
    const b = await creerPro()
    await insererReservation(a.vitrine.id, a.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })

    await planifier(MAINTENANT)

    expect(await lireOutbox({ entiteId: a.user.id })).toHaveLength(1)
    expect(await lireOutbox({ entiteId: b.user.id })).toHaveLength(0)
  })
})

describe('changement de fuseau : la même journée ne part qu’une fois (CA25)', () => {
  it('should not plan a second line when the user moves from Douala to New York the same local day', async () => {
    const pro = await creerPro({ fuseau: 'Africa/Douala' })
    // 15:00Z le 10 novembre = 16:00 à Douala = 10:00 à New York (UTC-5) : le même jour local des deux côtés.
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-10T15:00:00.000Z'), statut: 'confirmee' })
    await planifier(utc('2026-11-10T06:00:00.000Z')) // 07:00 à Douala
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)

    await changerFuseau(pro.user.id, 'America/New_York')
    const resultat = await planifier(utc('2026-11-10T12:00:00.000Z')) // 07:00 à New York

    expect(resultat.rappelsJour).toBe(0)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)
  })
})

describe('résumé hebdomadaire : fenêtre du lundi 8 h locale (CA30, CA31)', () => {
  it.each([
    ['le lundi à 08:00 local (07:00Z)', '2026-11-02T07:00:00.000Z', 1],
    ['le lundi à 13:59:59.999 local (12:59:59.999Z), dernière milliseconde du rattrapage', '2026-11-02T12:59:59.999Z', 1],
    ['le lundi à 07:59:59.999 local (06:59:59.999Z)', '2026-11-02T06:59:59.999Z', 0],
    ['le lundi à 14:00 local (13:00Z), fin du rattrapage', '2026-11-02T13:00:00.000Z', 0],
    ['un mardi à 08:00 local', '2026-11-03T07:00:00.000Z', 0],
    ['un dimanche à 08:00 local', '2026-11-01T07:00:00.000Z', 0],
  ])('should plan %s: %i line(s) (CA30)', async (_libelle, instant, attendu) => {
    const pro = await creerPro()

    const resultat = await planifier(utc(instant))

    expect(resultat.resumes).toBe(attendu)
    expect(await lireOutbox({ entiteId: pro.user.id, type: 'utilisateur_resume_hebdo' })).toHaveLength(attendu)
  })

  it('should create the summary line with occurrence = ISO week of the PERIOD, relationnel category, createdAt = now (CA26)', async () => {
    const pro = await creerPro()
    const maintenant = utc('2026-11-02T07:00:00.000Z')

    const resultat = await planifier(maintenant)

    expect(resultat).toMatchObject({ resumes: 1, rappelsJour: 0, fuseauxInvalides: 0 })
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    expect(ligne).toMatchObject({
      type: 'utilisateur_resume_hebdo',
      entiteType: 'utilisateur',
      occurrence: '2026-W44',
      categorie: 'relationnel',
      statut: 'en_attente',
    })
    expect(ligne?.createdAt.getTime()).toBe(maintenant.getTime())
    expect(ligne?.prochaineTentative?.getTime()).toBe(maintenant.getTime())
  })

  it('should plan nothing for an unpublished vitrine, and for a user without vitrine (CA31)', async () => {
    const brouillon = await creerPro({ publiee: false })
    const sansVitrine = await creerPro()
    await db.delete(vitrines).where(eq(vitrines.id, sansVitrine.vitrine.id))

    const resultat = await planifier(utc('2026-11-02T07:00:00.000Z'))

    expect(resultat.resumes).toBe(0)
    expect(await lireOutbox({ entiteId: brouillon.user.id })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: sansVitrine.user.id })).toHaveLength(0)
  })

  it('should plan nothing when email_hebdo is off (CA66, planning side)', async () => {
    const pro = await creerPro({ emailHebdo: false })

    await planifier(utc('2026-11-02T07:00:00.000Z'))

    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(0)
  })

  it('should plan nothing for a temporary e-mail without contact e-mail (CA33), and one line with a contact e-mail', async () => {
    const sans = await creerPro({ emailTemporaire: true, emailContact: null })
    const vide = await creerPro({ emailTemporaire: true, emailContact: '   ' })
    const avec = await creerPro({ emailTemporaire: true, emailContact: 'contact@exemple.test' })

    await planifier(utc('2026-11-02T07:00:00.000Z'))

    expect(await lireOutbox({ entiteId: sans.user.id })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: vide.user.id })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: avec.user.id })).toHaveLength(1)
  })

  it('should not plan the same week twice (replay) but plan the next Monday', async () => {
    const pro = await creerPro()

    await planifier(utc('2026-11-02T07:00:00.000Z'))
    await planifier(utc('2026-11-02T07:05:00.000Z'))
    await planifier(utc('2026-11-02T08:00:00.000Z'))
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)

    await planifier(utc('2026-11-09T07:00:00.000Z'))
    expect((await lireOutbox({ entiteId: pro.user.id })).map((l) => l.occurrence).sort()).toEqual(['2026-W44', '2026-W45'])
  })
})

describe('résumé hebdomadaire : la période et le contenu (CA26, CA27, CA28, CA29)', () => {
  // Africa/Douala, lundi 2026-11-02 à 08:00 locale = 07:00Z. Période : [lundi 26/10 00:00, lundi 02/11 00:00) locale
  // = [2026-10-25T23:00Z, 2026-11-01T23:00Z).
  const MAINTENANT = utc('2026-11-02T07:00:00.000Z')
  const CREE_AVANT = utc('2026-10-20T10:00:00.000Z')

  async function peuplerSemaine(pro: Awaited<ReturnType<typeof creerPro>>) {
    // 3 réservations : première milliseconde de la période, milieu, dernière milliseconde.
    for (const [i, creeLe] of ['2026-10-25T23:00:00.000Z', '2026-10-28T09:00:00.000Z', '2026-11-01T22:59:59.999Z'].entries()) {
      await insererReservation(pro.vitrine.id, pro.service.id, { debut: new Date(utc('2026-12-01T09:00:00.000Z').getTime() + i * heures(1)), statut: 'en_attente', createdAt: utc(creeLe) })
    }
    await insererDemande(pro.vitrine.id, pro.service.id, utc('2026-10-29T10:00:00.000Z'))
    await insererMessage(pro.vitrine.id, utc('2026-10-30T10:00:00.000Z'))
    await insererMessage(pro.vitrine.id, utc('2026-10-31T10:00:00.000Z'))
    // Hors période : 00:30 locale le lundi (= 2026-11-01T23:30Z) et la dernière milliseconde de la semaine d'avant.
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-12-02T09:00:00.000Z'), statut: 'en_attente', createdAt: utc('2026-11-01T23:30:00.000Z') })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-12-03T09:00:00.000Z'), statut: 'en_attente', createdAt: utc('2026-10-25T22:59:59.999Z') })
    await insererMessage(pro.vitrine.id, utc('2026-11-01T23:00:00.000Z'))
  }

  it('should count 3 reservations, 1 request and 2 messages created in the local week, and exclude Monday 00:30 local (CA26, CA27, #186)', async () => {
    const pro = await creerPro({ prenom: 'Cabrel' })
    await peuplerSemaine(pro)
    // Bruit : l'activité d'une autre vitrine ne doit jamais être comptée.
    const autre = await creerPro()
    await insererMessage(autre.vitrine.id, utc('2026-10-30T10:00:00.000Z'))
    await insererReservation(autre.vitrine.id, autre.service.id, { debut: utc('2026-12-01T09:00:00.000Z'), createdAt: utc('2026-10-30T10:00:00.000Z') })
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié pour le professionnel de test.')

    const { transport, ligne: apres } = await traiter(ligne.id, MAINTENANT)

    expect(apres.statut).toBe('envoye')
    expect(transport.dernier.to).toBe(pro.user.email)
    expect(transport.dernier.subject).toBe('Votre semaine : 3 réservations, 1 demande, 2 messages')
    expect(transport.dernier.text).toMatch(/Réservations reçues : 3\b/)
    expect(transport.dernier.text).toMatch(/Demandes reçues : 1\b/)
    expect(transport.dernier.text).toMatch(/Messages reçus : 2\b/)
    // S11 #186 : les lignes visites/clics sont rendues (zéro sans données de suivi).
    expect(transport.dernier.text).toContain('• Visites : 0')
    expect(transport.dernier.text).toContain('• Clics sur vos liens : 0')
    expect(transport.dernier.text).toContain('26 octobre')
    expect(transport.dernier.text).toContain('1er novembre')
  })

  it('should announce the confirmed appointments of the starting week (2 rendez-vous sont prévus)', async () => {
    const pro = await creerPro()
    await peuplerSemaine(pro)
    for (const debut of ['2026-11-03T09:00:00.000Z', '2026-11-08T22:30:00.000Z']) {
      await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc(debut), statut: 'confirmee', createdAt: CREE_AVANT })
    }
    // Hors de la semaine qui commence : dimanche 23:00Z = lundi 00:00 locale suivant, et un rendez-vous annulé.
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-08T23:00:00.000Z'), statut: 'confirmee', createdAt: CREE_AVANT })
    await insererReservation(pro.vitrine.id, pro.service.id, { debut: utc('2026-11-04T09:00:00.000Z'), statut: 'annulee', createdAt: CREE_AVANT })
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié.')

    const { transport } = await traiter(ligne.id, MAINTENANT)

    expect(transport.dernier.text).toContain('2 rendez-vous sont prévus')
  })

  it('should compute the previous week on the local calendar across the spring DST change in Paris (167 h, CA34, planner side)', async () => {
    const paris = await creerPro({ fuseau: 'Europe/Paris' })
    // Lundi 29 mars 2027 08:00 CEST (UTC+2) = 06:00Z. Période : [2027-03-21T23:00Z, 2027-03-28T22:00Z).
    const creations = [
      ['2027-03-21T23:00:00.000Z', true], // lundi 22 mars 00:00 CET : première milliseconde
      ['2027-03-21T22:59:59.999Z', false], // dimanche 21 mars 23:59:59.999 CET : semaine précédente
      ['2027-03-28T21:59:59.999Z', true], // dimanche 28 mars 23:59:59.999 CEST... avant minuit local
      ['2027-03-28T22:00:00.000Z', false], // lundi 29 mars 00:00 CEST : semaine suivante
    ] as const
    for (const [i, [creeLe]] of creations.entries()) {
      await insererReservation(paris.vitrine.id, paris.service.id, { debut: new Date(utc('2027-06-01T09:00:00.000Z').getTime() + i * heures(1)), createdAt: utc(creeLe) })
    }
    const maintenant = utc('2027-03-29T06:00:00.000Z')

    const resultat = await planifier(maintenant)
    const [ligne] = await lireOutbox({ entiteId: paris.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié pour Paris.')
    const { transport } = await traiter(ligne.id, maintenant)

    expect(resultat.resumes).toBe(1)
    expect(ligne.occurrence).toBe('2027-W12')
    expect(transport.dernier.subject).toBe('Votre semaine : 2 réservations')
  })

  it('should send the activity-free idea with a SINGLE suggestion: the next step "réalisation" (CA28)', async () => {
    const pro = await creerPro()
    await ajouterPhoto(pro)
    await insererDisponibilite(pro.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '12:00' })
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié.')

    const { transport } = await traiter(ligne.id, MAINTENANT)

    const { text, subject } = transport.dernier
    expect(subject).toBe('Une idée pour votre vitrine cette semaine')
    expect(text).toContain(PROCHAINES_ETAPES.realisation.titre)
    expect(text).toContain(PROCHAINES_ETAPES.realisation.texte)
    expect(text).toMatch(/\S+\/studio\/realisations\/nouveau/)
    for (const autre of ['photo', 'service', 'disponibilites', 'partager'] as const) {
      expect(text).not.toContain(PROCHAINES_ETAPES[autre].titre)
    }
    expect(text).not.toContain(SUGGESTION_RESUME_DEFAUT.titre)
    expect(text).not.toMatch(/Visites|Clics/i)
  })

  it('should link the "partager" suggestion to the studio home since it has no page of its own (arbitrage 3)', async () => {
    const pro = await creerPro()
    await ajouterPhoto(pro)
    await insererDisponibilite(pro.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '12:00' })
    await insertRealisation(pro.vitrine.id, { titre: 'Chantier' })
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié.')

    const { transport } = await traiter(ligne.id, MAINTENANT)

    expect(transport.dernier.text).toContain(PROCHAINES_ETAPES.partager.titre)
    expect(transport.dernier.text).toMatch(/\S+\/studio(\s|$)/m)
    expect(transport.dernier.text).not.toContain('null')
  })

  it('should skip ignored steps and fall back to the default suggestion when nothing is left (CA29)', async () => {
    const pro = await creerPro()
    await ajouterPhoto(pro)
    await insererDisponibilite(pro.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '12:00' })
    await db.update(vitrines).set({ etapesIgnorees: ['realisation', 'partager'] }).where(eq(vitrines.id, pro.vitrine.id))
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié.')

    const { transport } = await traiter(ligne.id, MAINTENANT)

    expect(transport.dernier.subject).toBe('Une idée pour votre vitrine cette semaine')
    expect(transport.dernier.text).toContain(SUGGESTION_RESUME_DEFAUT.titre)
    expect(transport.dernier.text).toContain(SUGGESTION_RESUME_DEFAUT.texte)
    expect(transport.dernier.text).toContain(SUGGESTION_RESUME_DEFAUT.chemin)
    expect(transport.dernier.text).not.toContain(PROCHAINES_ETAPES.realisation.titre)
  })

  it('should not suggest the "partager" step once the vitrine has been shared (partagee_le set)', async () => {
    const pro = await creerPro()
    await ajouterPhoto(pro)
    await insererDisponibilite(pro.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '12:00' })
    await insertRealisation(pro.vitrine.id, { titre: 'Chantier' })
    await db.update(vitrines).set({ partageeLe: utc('2026-10-01T10:00:00.000Z') }).where(eq(vitrines.id, pro.vitrine.id))
    await planifier(MAINTENANT)
    const [ligne] = await lireOutbox({ entiteId: pro.user.id })
    if (!ligne) throw new Error('Aucun résumé planifié.')

    const { transport } = await traiter(ligne.id, MAINTENANT)

    expect(transport.dernier.text).toContain(SUGGESTION_RESUME_DEFAUT.titre)
    expect(transport.dernier.text).not.toContain(PROCHAINES_ETAPES.partager.titre)
  })
})

describe('fréquence : au plus un e-mail relationnel par semaine ISO locale (CA36, CA37, CA38, #88)', () => {
  const MAINTENANT = utc('2026-11-02T07:00:00.000Z')
  // Début de la semaine ISO locale à Douala : lundi 2026-11-02 00:00 locale = 2026-11-01T23:00Z.
  const DEBUT_SEMAINE = utc('2026-11-01T23:00:00.000Z')

  function relationnel(userId: string, extra: { occurrence?: string, statut?: 'en_attente' | 'en_cours' | 'envoye' | 'echec' | 'annule', createdAt: Date }) {
    return insererOutbox({
      type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: userId, categorie: 'relationnel',
      occurrence: extra.occurrence ?? '2026-W43', statut: extra.statut ?? 'envoye', createdAt: extra.createdAt,
    })
  }

  it('should insert nothing when a relational line of this ISO week already exists, whatever its occurrence label (CA36)', async () => {
    const pro = await creerPro()
    await relationnel(pro.user.id, { createdAt: new Date(DEBUT_SEMAINE.getTime() + heures(1)) })

    const resultat = await planifier(MAINTENANT)

    expect(resultat.resumes).toBe(0)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)
  })

  it.each(['en_attente', 'en_cours', 'envoye', 'echec'] as const)('should count an existing relational line in status %s', async (statut) => {
    const pro = await creerPro()
    await relationnel(pro.user.id, { statut, createdAt: new Date(DEBUT_SEMAINE.getTime() + 1) })

    await planifier(MAINTENANT)

    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)
  })

  it('should NOT count a cancelled relational line: an e-mail that never left frees the quota', async () => {
    const pro = await creerPro()
    await relationnel(pro.user.id, { statut: 'annule', createdAt: new Date(DEBUT_SEMAINE.getTime() + heures(1)) })

    const resultat = await planifier(MAINTENANT)

    expect(resultat.resumes).toBe(1)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(2)
  })

  it('should NOT count a relational line created one millisecond before the local start of the week', async () => {
    const pro = await creerPro()
    await relationnel(pro.user.id, { createdAt: new Date(DEBUT_SEMAINE.getTime() - 1) })

    const resultat = await planifier(MAINTENANT)

    expect(resultat.resumes).toBe(1)
  })

  it('should plan the summary even when many transactional e-mails (rendez-vous du jour included) went out this week (CA38)', async () => {
    const pro = await creerPro()
    for (let jour = 0; jour < 3; jour += 1) {
      await insererOutbox({
        type: 'utilisateur_rappel_journee', entiteType: 'utilisateur', entiteId: pro.user.id, categorie: 'transactionnel',
        occurrence: `2026-11-0${jour + 2}`, statut: 'envoye', createdAt: new Date(DEBUT_SEMAINE.getTime() + heures(1 + jour)),
      })
    }

    const resultat = await planifier(MAINTENANT)

    expect(resultat.resumes).toBe(1)
    expect(await lireOutbox({ entiteId: pro.user.id, type: 'utilisateur_resume_hebdo' })).toHaveLength(1)
  })

  it('should keep exactly one summary line when several planners run at the same instant (CA37)', async () => {
    const pro = await creerPro()

    const resultats = await Promise.allSettled(Array.from({ length: 6 }, () => planifier(MAINTENANT)))
    for (const r of resultats) if (r.status === 'rejected') throw r.reason

    expect(await lireOutbox({ entiteId: pro.user.id, type: 'utilisateur_resume_hebdo' })).toHaveLength(1)
  })

  it('should wait for the per-user advisory lock and honour what its holder committed (cap under lock, CA37)', async () => {
    const pro = await creerPro()
    let termine = false
    let planification: Promise<unknown> = Promise.resolve()

    try {
      await db.transaction(async (tx) => {
      // Le verrou documenté en #88 : clé par utilisateur, transactionnel.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`relationnel:${pro.user.id}`}))`)
      planification = planifier(MAINTENANT).then(() => { termine = true })
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(termine, 'la planification doit attendre le verrou consultatif du destinataire').toBe(false)
      // Le détenteur du verrou consomme le quota de la semaine, dans sa transaction.
      await tx.execute(sql`
        INSERT INTO emails_transactionnels (id, type, entite_type, entite_id, occurrence, categorie, statut, envoye_le, created_at, updated_at)
        VALUES (${randomUUID()}, 'utilisateur_resume_hebdo', 'utilisateur', ${pro.user.id}, '2026-W43', 'relationnel', 'envoye', ${MAINTENANT.toISOString()}::timestamptz, ${MAINTENANT.toISOString()}::timestamptz, ${MAINTENANT.toISOString()}::timestamptz)
      `)
      })
    }
    finally {
      // Dans tous les cas, on attend la fin de la planification avant de quitter le test (aucune connexion orpheline).
      await planification.catch(() => undefined)
    }

    const lignes = await lireOutbox({ entiteId: pro.user.id, type: 'utilisateur_resume_hebdo' })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.occurrence).toBe('2026-W43')
  })
})

describe('fuseaux : chaque fuseau suit sa propre horloge locale (CA35, #98)', () => {
  it('should plan only for the timezones whose local clock is in the window at that instant (UTC+14 and UTC-11)', async () => {
    const kiritimati = await creerPro({ fuseau: 'Pacific/Kiritimati' }) // UTC+14
    const pagoPago = await creerPro({ fuseau: 'Pacific/Pago_Pago' }) // UTC-11
    const douala = await creerPro({ fuseau: 'Africa/Douala' })
    const newYork = await creerPro({ fuseau: 'America/New_York' })

    // Dimanche 2026-11-01 18:00Z : lundi 08:00 à Kiritimati, dimanche 07:00 à Pago Pago.
    const premier = await planifier(utc('2026-11-01T18:00:00.000Z'))
    expect(premier.resumes).toBe(1)
    expect((await lireOutbox({ type: 'utilisateur_resume_hebdo' })).map((l) => l.entiteId)).toEqual([kiritimati.user.id])

    // Lundi 2026-11-02 19:00Z : lundi 08:00 à Pago Pago ; Kiritimati est déjà mardi 09:00.
    const second = await planifier(utc('2026-11-02T19:00:00.000Z'))
    expect(second.resumes).toBe(1)
    expect((await lireOutbox({ entiteId: pagoPago.user.id })).map((l) => l.type)).toEqual(['utilisateur_resume_hebdo'])

    // Lundi 2026-11-02 13:00Z : 08:00 à New York (UTC-5 en novembre) ; Douala est à 14:00 (hors fenêtre).
    const troisieme = await planifier(utc('2026-11-02T13:00:00.000Z'))
    expect(troisieme.resumes).toBe(1)
    expect((await lireOutbox({ entiteId: newYork.user.id })).map((l) => l.type)).toEqual(['utilisateur_resume_hebdo'])
    expect(await lireOutbox({ entiteId: douala.user.id })).toHaveLength(0)
  })

  it('should follow the daylight-saving change in New York: on Monday 2026-03-09 (already in summer time) 08:00 local is 12:00Z', async () => {
    // Lundi 2026-03-09 : New York est déjà en heure d'été (UTC-4) depuis le 8 mars, donc 08:00 locale = 12:00Z.
    const pro = await creerPro({ fuseau: 'America/New_York' })

    const tropTot = await planifier(utc('2026-03-09T11:59:59.999Z'))
    expect(tropTot.resumes).toBe(0)
    const pile = await planifier(utc('2026-03-09T12:00:00.000Z'))

    expect(pile.resumes).toBe(1)
    expect(await lireOutbox({ entiteId: pro.user.id })).toHaveLength(1)
  })

  it('should skip an invalid timezone, process the others and journal only the COUNT of invalid timezones (CA35)', async () => {
    const espion = espionnerJournaux()
    journaux = espion
    const valide = await creerPro({ fuseau: 'Africa/Douala' })
    const invalide = await creerPro({ fuseau: 'Africa/Douala', email: 'invalide@exemple.test' })
    await db.update(users).set({ fuseau: 'Mars/Olympus' }).where(eq(users.id, invalide.user.id))
    await insererReservation(valide.vitrine.id, valide.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })
    await insererReservation(invalide.vitrine.id, invalide.service.id, { debut: utc('2026-11-10T13:00:00.000Z'), statut: 'confirmee' })

    const resultat = await planifier(utc('2026-11-10T06:00:00.000Z'))

    expect(resultat).toMatchObject({ rappelsJour: 1, fuseauxInvalides: 1 })
    expect(await lireOutbox({ entiteId: valide.user.id })).toHaveLength(1)
    expect(await lireOutbox({ entiteId: invalide.user.id })).toHaveLength(0)
    const sortie = espion.contenu()
    expect(sortie).toContain('[notifications] fuseau invalide ignoré (1)')
    expect(sortie).not.toContain('Mars/Olympus')
    expect(sortie).not.toContain('invalide@exemple.test')
  })

  it('should survive a database full of invalid timezones: nothing planned, no exception', async () => {
    const pro = await creerPro()
    await db.update(users).set({ fuseau: 'Pas/UnFuseau' }).where(eq(users.id, pro.user.id))

    const resultat = await planifier(utc('2026-11-02T07:00:00.000Z'))

    expect(resultat).toMatchObject({ resumes: 0, rappelsJour: 0, fuseauxInvalides: 1 })
  })
})

describe('lots de la planification (PLANIFICATION_LOT_UTILISATEURS)', () => {
  it('should plan every candidate exactly once when the number of users goes past one batch', async () => {
    const total = PLANIFICATION_LOT_UTILISATEURS + 7
    const identifiants = Array.from({ length: total }, () => randomUUID())
    await db.insert(users).values(identifiants.map((id) => ({ id, name: 'Lot', email: `lot-${id}@exemple.test`, emailVerified: true })))
    await db.insert(vitrines).values(identifiants.map((id) => ({
      id: randomUUID(), userId: id, username: `lot-${id.slice(0, 12)}`, titre: 'dr', prenom: 'Lot', nom: 'Test', metier: 'Cardiologue',
      ville: 'Douala', pays: 'CM', publieeLe: utc('2026-10-01T10:00:00.000Z'),
    })))

    const resultat = await planifier(utc('2026-11-02T07:00:00.000Z'))
    const relance = await planifier(utc('2026-11-02T07:05:00.000Z'))

    expect(resultat.resumes).toBe(total)
    expect(relance.resumes).toBe(0)
    const lignes = await lireOutbox({ type: 'utilisateur_resume_hebdo' })
    expect(lignes).toHaveLength(total)
    expect(new Set(lignes.map((l) => l.entiteId)).size).toBe(total)
  })
})
