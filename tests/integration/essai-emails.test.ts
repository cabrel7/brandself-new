import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { abonnements, emailsTransactionnels, users, vitrines } from '../../shared/db/schema'
import { ESSAI_OCCURRENCE_PREFIXE } from '../../shared/essai'
import { db } from '../../server/utils/db'
import { poserAbonnementOrigine } from './support/admin-a3'
import { preparerConfigurationA5 } from './support/admin-a5'
import {
  accorder, creerCompteEmail, DEBUT_ESSAI, FIN_ESSAI_V1, jours, lireAbonnementDe, OCCURRENCE_ESSAI_V1, plus, preparerCompteTerminable,
  poserVersionEssai, terminerPour,
} from './support/essai'
import { insertRealisation, insertService } from './support/fabriques'
import { creerPro, insererOutbox, lireOutbox, utc, viderOutbox, changerFuseau } from './support/notifications'
import { espionnerJournaux, modulesDesabonnement, modulesPlanification, traiter } from './support/planification'
import type { EspionJournaux } from './support/planification'

// E1 CA-E1-16 à 19 (+ D8 désabonnement, D9, D12) : e-mails d'essai dans l'outbox. VRAIE base, VRAI Redis ; le transport (Resend) est le
// seul élément factice, l'horloge est injectée. NB : la spec (§6 CA-16) dit « transactionnel » ; la décision D8 (confirmée par la migration
// 0036, qui l'impose par CHECK) est `relationnel` : c'est ce que ces tests vérifient.

preparerConfigurationA5()
let journaux: EspionJournaux | undefined
afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

const SERVICES = 'abonnement_essai_services' as const
const STATISTIQUES = 'abonnement_essai_statistiques' as const
const CONSTAT = 'abonnement_essai_constat' as const
/** Lendemain du dernier jour de l'essai (fin 2026-12-07T10:00Z, dernier jour 7 décembre), 9 h Douala. */
const CONSTAT_ENVOI = utc('2026-12-08T08:00:00.000Z')
const JOUR_2_ENVOI = utc('2026-11-25T08:05:00.000Z')
const JOUR_7_ENVOI = utc('2026-11-30T08:05:00.000Z')

async function essaiTermine(surcharges: Parameters<typeof preparerCompteTerminable>[0] = {}) {
  const { user } = await preparerCompteTerminable(surcharges)
  await terminerPour(user.id)
  const abonnement = (await lireAbonnementDe(user.id))!
  const lignes = await lireOutbox({ entiteId: abonnement.id })
  const ligne = (type: typeof SERVICES | typeof STATISTIQUES) => lignes.find((l) => l.type === type)!
  return { user, abonnement, ligne }
}

describe('planification à l\'octroi (CA-E1-16)', () => {
  it('should plan « services » at day 2 and « statistics » at day 7, 9:00 local, key ESSAI:<end ISO>, relational, on the subscription', async () => {
    const { abonnement } = await essaiTermine()

    const lignes = (await lireOutbox({ entiteId: abonnement.id })).filter((l) => l.type !== CONSTAT)

    expect(lignes.map((l) => l.type).sort()).toEqual([SERVICES, STATISTIQUES])
    for (const ligne of lignes) {
      expect(ligne).toMatchObject({ entiteType: 'abonnement', entiteId: abonnement.id, occurrence: OCCURRENCE_ESSAI_V1, categorie: 'relationnel', statut: 'en_attente', tentatives: 0 })
      expect(ligne.occurrence.startsWith(ESSAI_OCCURRENCE_PREFIXE)).toBe(true)
      expect(ligne.createdAt.getTime()).toBe(DEBUT_ESSAI.getTime())
    }
    expect(lignes.find((l) => l.type === SERVICES)?.prochaineTentative?.toISOString()).toBe('2026-11-25T08:00:00.000Z')
    expect(lignes.find((l) => l.type === STATISTIQUES)?.prochaineTentative?.toISOString()).toBe('2026-11-30T08:00:00.000Z')
  })

  it('should count the days in the time zone of the account (Pago Pago, UTC-11) and fall back on Douala for an invalid zone', async () => {
    const pago = await essaiTermine({ fuseau: 'Pacific/Pago_Pago' })
    const casse = await creerCompteEmail()
    await changerFuseau(casse.id, 'Mars/Olympus')
    await accorder(casse.id)
    const aboCasse = (await lireAbonnementDe(casse.id))!

    expect(pago.ligne(SERVICES).prochaineTentative?.toISOString()).toBe('2026-11-24T20:00:00.000Z')
    expect((await lireOutbox({ entiteId: aboCasse.id })).find((l) => l.type === SERVICES)?.prochaineTentative?.toISOString()).toBe('2026-11-25T08:00:00.000Z')
  })

  it('should use the days of the ACTIVE version (v2: services day 3, statistics day 10)', async () => {
    await poserVersionEssai({ actif: true, dureeJours: 30, relanceServicesJour: 3, relanceStatistiquesJour: 10 })
    const { abonnement } = await essaiTermine()

    const lignes = await lireOutbox({ entiteId: abonnement.id })

    expect(lignes.find((l) => l.type === SERVICES)?.prochaineTentative?.toISOString()).toBe('2026-11-26T08:00:00.000Z')
    expect(lignes.find((l) => l.type === STATISTIQUES)?.prochaineTentative?.toISOString()).toBe('2026-12-03T08:00:00.000Z')
    expect(lignes[0]?.occurrence).toBe(`ESSAI:${plus(DEBUT_ESSAI, jours(30)).toISOString()}`)
  })

  it('should not duplicate the lines on a re-planning: a second grant, the planner and a replay of the insertion add nothing', async () => {
    const { user, abonnement } = await essaiTermine()
    const { planifierNotifications } = await modulesPlanification()
    const { insertScheduledEmailEvents } = await import('../../server/services/email-outbox')

    await accorder(user.id)
    await planifierNotifications(utc('2026-11-25T08:00:00.000Z'))
    await planifierNotifications(utc('2026-11-25T08:05:00.000Z'))
    const rejoue = await db.transaction((tx) => insertScheduledEmailEvents(tx, [{
      entiteType: 'abonnement', entiteId: abonnement.id, type: SERVICES, occurrence: OCCURRENCE_ESSAI_V1, prochaineTentative: JOUR_2_ENVOI, categorie: 'relationnel',
    }]))

    expect(rejoue).toBe(0)
    // Services, statistiques et constat de fin d'essai : trois lignes, jamais plus.
    expect(await lireOutbox({ entiteId: abonnement.id })).toHaveLength(3)
  })
})

describe('constat de fin d\'essai (E1 : e-mail de service, lendemain de la fin à 9 h locale)', () => {
  it('should plan the report at the grant: transactional, key ESSAI:<end ISO>, the day after the last day at 9:00 local', async () => {
    const { abonnement, ligne } = await essaiTermine()

    expect(ligne(CONSTAT)).toMatchObject({
      entiteType: 'abonnement', entiteId: abonnement.id, occurrence: OCCURRENCE_ESSAI_V1, categorie: 'transactionnel', statut: 'en_attente', tentatives: 0,
    })
    expect(ligne(CONSTAT).prochaineTentative?.toISOString()).toBe(CONSTAT_ENVOI.toISOString())
  })

  it('should count the day in the time zone of the account (Pago Pago, UTC-11)', async () => {
    const { ligne } = await essaiTermine({ fuseau: 'Pacific/Pago_Pago' })

    // Fin 2026-12-07T10:00Z = 6 décembre 23 h à Pago Pago : dernier jour 6 décembre, constat le 7 à 9 h (20 h UTC).
    expect(ligne(CONSTAT).prochaineTentative?.toISOString()).toBe('2026-12-07T20:00:00.000Z')
  })

  it('should NOT send it before its hour: the line stays waiting, nothing leaves, no attempt is counted', async () => {
    const { ligne } = await essaiTermine()

    const { ligne: apres, transport } = await traiter(ligne(CONSTAT).id, plus(CONSTAT_ENVOI, -60_000))

    expect(transport.sends).toHaveLength(0)
    expect(apres).toMatchObject({ statut: 'en_attente', tentatives: 0 })
  })

  it('should send it the day after the end at 9:00 local when the trial was not converted: HTML and text, no unsubscribe, even with the weekly e-mails switched off', async () => {
    const { user, ligne } = await essaiTermine()
    await db.update(users).set({ email_hebdo: false }).where(eq(users.id, user.id))

    const { ligne: apres, transport } = await traiter(ligne(CONSTAT).id, plus(CONSTAT_ENVOI, 300_000))

    expect(apres).toMatchObject({ statut: 'envoye', erreurCode: null, categorie: 'transactionnel' })
    expect(transport.sends).toHaveLength(1)
    expect(transport.dernier.to).toBe(user.email)
    expect(transport.dernier.subject).toBe('Votre essai gratuit est terminé')
    expect(transport.dernier.html).toBeTruthy()
    expect(transport.dernier.text).toContain('revenue au plan gratuit')
    expect(transport.dernier.text).toContain('/studio/compte?periode=1#abonnement')
    expect(transport.dernier.headers?.['List-Unsubscribe']).toBeUndefined()
    expect(transport.dernier.text).not.toMatch(/Ne plus recevoir/)
  })

  it('should cancel it once the trial was converted by a payment (end date moved, origin `paiement`): nothing leaves', async () => {
    const { abonnement, ligne } = await essaiTermine()
    await db.update(abonnements).set({ origine: 'paiement', expireLe: new Date('2027-01-07T10:00:00.000Z') }).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne(CONSTAT).id, CONSTAT_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ABONNEMENT_RENOUVELE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel it when the trial was extended by the administration (the origin stays `essai`, the end moves)', async () => {
    const { abonnement, ligne } = await essaiTermine()
    await db.update(abonnements).set({ expireLe: plus(FIN_ESSAI_V1, jours(7)) }).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne(CONSTAT).id, CONSTAT_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ABONNEMENT_RENOUVELE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel it with ENTITE_INTROUVABLE when the subscription is gone, and with RAPPEL_PERIME when sent more than three days late', async () => {
    const gone = await essaiTermine()
    await db.delete(abonnements).where(eq(abonnements.id, gone.abonnement.id))
    const tardif = await essaiTermine()

    const supprime = await traiter(gone.ligne(CONSTAT).id, CONSTAT_ENVOI)
    const enRetard = await traiter(tardif.ligne(CONSTAT).id, plus(FIN_ESSAI_V1, jours(4)))

    expect(supprime.ligne).toMatchObject({ statut: 'annule', erreurCode: 'ENTITE_INTROUVABLE' })
    expect(enRetard.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(enRetard.transport.sends).toHaveLength(0)
  })

  it('should be planned by the J0 tick for a trial without the grant line (extended by the administration), once, and not counted as a reminder', async () => {
    const expire = new Date('2026-12-03T23:00:00.000Z')
    await viderOutbox()
    const pro = await creerPro({ emailHebdo: false, emailRappelJour: false })
    const abonnement = await poserAbonnementOrigine(pro.user.id, expire, { origine: 'essai' })
    const { planifierNotifications } = await modulesPlanification()

    // J-3 (30 novembre) : un rappel, aucun constat ; J0 (3 décembre) : un rappel et le constat, posé une seule fois.
    const j3 = await planifierNotifications(utc('2026-11-30T08:00:00.000Z'))
    expect(await lireOutbox({ entiteId: abonnement.id, type: CONSTAT })).toHaveLength(0)
    const j0 = await planifierNotifications(utc('2026-12-03T08:00:00.000Z'))
    await planifierNotifications(utc('2026-12-03T08:05:00.000Z'))

    expect(j3.rappelsAbonnement).toBe(1)
    expect(j0.rappelsAbonnement).toBe(1)
    const lignes = await lireOutbox({ entiteId: abonnement.id, type: CONSTAT })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ occurrence: `ESSAI:${expire.toISOString()}`, categorie: 'transactionnel', statut: 'en_attente' })
    // Dernier jour = 3 décembre (fin 23 h UTC = minuit Douala) : constat le 4 à 9 h Douala = 8 h UTC.
    expect(lignes[0]?.prochaineTentative?.toISOString()).toBe('2026-12-04T08:00:00.000Z')
  })

  it('should plan NO report for a paid subscription at J0', async () => {
    const expire = new Date('2026-12-03T23:00:00.000Z')
    await viderOutbox()
    const pro = await creerPro({ emailHebdo: false, emailRappelJour: false })
    await poserAbonnementOrigine(pro.user.id, expire, { origine: 'paiement' })
    const { planifierNotifications } = await modulesPlanification()

    await planifierNotifications(utc('2026-12-03T08:00:00.000Z'))

    expect(await lireOutbox({ type: CONSTAT })).toHaveLength(0)
  })
})

describe('envoi des relances (CA-E1-18, D8)', () => {
  it('should send « services » when nothing was added after the vitrine: relational, with the List-Unsubscribe headers', async () => {
    const { user, ligne } = await essaiTermine()

    const { ligne: apres, transport } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres, 'ligne').toMatchObject({ statut: 'envoye', erreurCode: null })
    expect(transport.sends).toHaveLength(1)
    expect(transport.dernier.subject).toBe('Ajoutez vos services à votre vitrine')
    expect(transport.dernier.to).toBe(user.email)
    expect(transport.dernier.headers?.['List-Unsubscribe']).toMatch(/jeton=/)
    expect(transport.dernier.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(transport.dernier.html).toBeTruthy()
  })

  it('should cancel « services » with CONTENU_DEJA_AJOUTE when a service was added after the vitrine', async () => {
    const { user, ligne } = await essaiTermine()
    const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
    // Nettement après la création (la tolérance couvre les services de l'onboarding, posés dans la même transaction).
    await insertService(vitrine!.id, { createdAt: new Date(Date.now() + 60_000) })

    const { ligne: apres, transport } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'CONTENU_DEJA_AJOUTE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel « services » with CONTENU_DEJA_AJOUTE when a réalisation was added, and still send « statistics »', async () => {
    const { user, ligne } = await essaiTermine()
    const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
    await insertRealisation(vitrine!.id)

    const services = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)
    const stats = await traiter(ligne(STATISTIQUES).id, JOUR_7_ENVOI)

    expect(services.ligne).toMatchObject({ statut: 'annule', erreurCode: 'CONTENU_DEJA_AJOUTE' })
    expect(stats.ligne.statut).toBe('envoye')
    expect(stats.transport.dernier.subject).toBe('Votre vitrine cette semaine')
    expect(stats.transport.dernier.text).toContain('Partagez votre adresse')
  })

  it('should cancel with PREFERENCE_DESACTIVEE once the person followed the unsubscribe link of the first e-mail', async () => {
    const { ligne } = await essaiTermine()
    // Le jeton est lu dans l'e-mail « statistiques » (toujours envoyé) ; le lien désactive `email_hebdo`.
    const { transport } = await traiter(ligne(STATISTIQUES).id, JOUR_7_ENVOI)
    const jeton = /jeton=([A-Za-z0-9_.-]+)/.exec(transport.dernier.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? ''
    const { unsubscribe } = await modulesDesabonnement()
    await unsubscribe(jeton, JOUR_7_ENVOI)

    const { ligne: apres, transport: second } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'PREFERENCE_DESACTIVEE' })
    expect(second.sends).toHaveLength(0)
  })

  it('should cancel with ESSAI_TERMINE once the person paid during the trial (origin `paiement`), without sending anything', async () => {
    const { abonnement, ligne } = await essaiTermine()
    await db.update(abonnements).set({ origine: 'paiement' }).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne(STATISTIQUES).id, JOUR_7_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ESSAI_TERMINE' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel with ENTITE_INTROUVABLE when the subscription is gone (back to the free plan by the administration, D12)', async () => {
    const { abonnement, ligne } = await essaiTermine()
    await db.delete(abonnements).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ENTITE_INTROUVABLE' })
  })

  it('should cancel with RAPPEL_PERIME when the end of the trial moved (extended by the administration) or passed', async () => {
    const { abonnement, ligne } = await essaiTermine()
    await db.update(abonnements).set({ expireLe: plus(FIN_ESSAI_V1, jours(7)) }).where(eq(abonnements.id, abonnement.id))
    const prolonge = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)
    await db.update(abonnements).set({ expireLe: FIN_ESSAI_V1 }).where(eq(abonnements.id, abonnement.id))
    const echu = await traiter(ligne(STATISTIQUES).id, plus(FIN_ESSAI_V1, 1000))

    expect(prolonge.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(echu.ligne).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
  })

  it('should cancel with DESTINATAIRE_ABSENT for a phone account without any reachable address', async () => {
    const { user, abonnement } = await (async () => {
      const { creerCompteTelephone } = await import('./support/essai')
      const compte = await creerCompteTelephone('+237677777777')
      await accorder(compte.id)
      return { user: compte, abonnement: (await lireAbonnementDe(compte.id))! }
    })()
    expect(user.email).toMatch(/@telephone\./)
    const [ligne] = await lireOutbox({ entiteId: abonnement.id, type: SERVICES })

    const { ligne: apres } = await traiter(ligne!.id, JOUR_2_ENVOI)

    expect(apres.statut).toBe('annule')
    expect(['DESTINATAIRE_ABSENT', 'ENTITE_INTROUVABLE']).toContain(apres.erreurCode)
  })

  it('should never leak the address or the unsubscribe token in the logs', async () => {
    journaux = espionnerJournaux()
    const { user, ligne } = await essaiTermine()

    const { transport } = await traiter(ligne(STATISTIQUES).id, JOUR_7_ENVOI)
    const jeton = /jeton=([A-Za-z0-9_.-]+)/.exec(transport.dernier.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? ''

    expect(journaux.contenu()).not.toContain(user.email)
    expect(journaux.contenu()).not.toContain(jeton)
  })
})

describe('rappels d\'échéance J-3 et J0 d\'un essai (CA-E1-19, D9)', () => {
  const EXPIRE = new Date('2026-12-03T23:00:00.000Z')
  const ISO = EXPIRE.toISOString()

  async function planifier(now: string) {
    const { planifierNotifications } = await modulesPlanification()
    return planifierNotifications(utc(now))
  }

  async function rappels() {
    return (await lireOutbox({ type: 'abonnement_rappel' })).map((l) => l.occurrence).sort()
  }

  async function abonne(origine: 'essai' | 'paiement') {
    await viderOutbox()
    const pro = await creerPro({ emailHebdo: false, emailRappelJour: false })
    const abonnement = await poserAbonnementOrigine(pro.user.id, EXPIRE, { origine })
    return { pro, abonnement }
  }

  it('should plan NO reminder at J-7 for an essai, then J-3 and J0', async () => {
    await abonne('essai')

    const septJours = await planifier('2026-11-26T08:00:00.000Z')
    await planifier('2026-11-30T08:00:00.000Z')
    await planifier('2026-12-03T08:00:00.000Z')

    expect(septJours.rappelsAbonnement).toBe(0)
    expect(await rappels()).toEqual([`J0:${ISO}`, `J3:${ISO}`])
  })

  it('should keep J-7, J-3 and J0 for a paid subscription (non-regression)', async () => {
    await abonne('paiement')

    await planifier('2026-11-26T08:00:00.000Z')
    await planifier('2026-11-30T08:00:00.000Z')
    await planifier('2026-12-03T08:00:00.000Z')

    expect(await rappels()).toEqual([`J0:${ISO}`, `J3:${ISO}`, `J7:${ISO}`])
  })

  it('should send the « essai » variant at J-3: subject, HTML and text, shortest period, no grace, a service message', async () => {
    const { pro } = await abonne('essai')
    await planifier('2026-11-30T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })
    expect(pro.user.id).toBeTruthy()

    const { ligne: apres, transport } = await traiter(ligne!.id, utc('2026-11-30T08:01:00.000Z'))

    expect(apres.statut).toBe('envoye')
    const message = transport.dernier
    expect(message.subject).toBe('Votre essai se termine dans 3 jours')
    expect(message.html).toBeTruthy()
    expect(message.text).toContain('/studio/compte?periode=1#abonnement')
    expect(message.text).not.toMatch(/grâce/i)
    expect(message.headers?.['List-Unsubscribe']).toBeUndefined()
  })

  it('should send the paid wording, with the grace period, for a paid subscription at J-3 (non-regression)', async () => {
    await abonne('paiement')
    await planifier('2026-11-30T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })

    const { transport } = await traiter(ligne!.id, utc('2026-11-30T08:01:00.000Z'))

    expect(transport.dernier.subject).toBe('Votre abonnement se termine dans 3 jours')
    expect(transport.dernier.text).toMatch(/grâce/i)
  })

  it('should cancel the J-3 line of a trial once it became a paid subscription (ABONNEMENT_RENOUVELE)', async () => {
    const { abonnement } = await abonne('essai')
    await planifier('2026-11-30T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })
    await db.update(abonnements).set({ expireLe: new Date('2027-01-03T23:00:00.000Z'), origine: 'paiement' }).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne!.id, utc('2026-11-30T08:01:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ABONNEMENT_RENOUVELE' })
    expect(transport.sends).toHaveLength(0)
  })
})

// Plafond S9 #88 (un e-mail relationnel par semaine et par compte) : les relances d'essai (entité = l'abonnement) y comptent.
describe('plafond relationnel hebdomadaire et relances d\'essai (S9 #88)', () => {
  const LUNDI_9H_LOCALE = utc('2026-11-23T08:00:00.000Z')
  const resumesDe = async (userId: string) => (await lireOutbox({ entiteId: userId, type: 'utilisateur_resume_hebdo' }))

  it('should NOT plan the weekly summary of an account whose trial reminder is due later in the same week (the reminder wins)', async () => {
    const pro = await creerPro()
    await accorder(pro.user.id, DEBUT_ESSAI)
    const { planifierNotifications } = await modulesPlanification()

    await planifierNotifications(LUNDI_9H_LOCALE)

    expect(await resumesDe(pro.user.id)).toHaveLength(0)
  })

  it('should plan the summary of a comparable account without trial (control), and when the reminders fall in other weeks', async () => {
    const sansEssai = await creerPro()
    const essaiAncien = await creerPro()
    // Essai accordé le 9 novembre : relances les 11 et 16 novembre, aucune dans la semaine du 23.
    await accorder(essaiAncien.user.id, plus(DEBUT_ESSAI, -jours(14)))
    const { planifierNotifications } = await modulesPlanification()

    await planifierNotifications(LUNDI_9H_LOCALE)

    expect(await resumesDe(sansEssai.user.id)).toHaveLength(1)
    expect(await resumesDe(essaiAncien.user.id)).toHaveLength(1)
  })

  it('should not count a CANCELLED trial reminder against the summary quota (a mail that never leaves frees the week)', async () => {
    const pro = await creerPro()
    await accorder(pro.user.id, DEBUT_ESSAI)
    const abonnement = (await lireAbonnementDe(pro.user.id))!
    await db.update(emailsTransactionnels).set({ statut: 'annule', erreurCode: 'ESSAI_TERMINE' }).where(eq(emailsTransactionnels.entiteId, abonnement.id))
    const { planifierNotifications } = await modulesPlanification()

    await planifierNotifications(LUNDI_9H_LOCALE)

    expect(await resumesDe(pro.user.id)).toHaveLength(1)
  })

  it('should cancel a trial reminder with PLAFOND_RELATIONNEL when a summary already left the same week, and send it when it left the week before', async () => {
    const { user, ligne } = await essaiTermine()
    await insererOutbox({
      type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: user.id, occurrence: '2026-W47', statut: 'envoye',
      envoyeLe: utc('2026-11-23T08:30:00.000Z'), createdAt: utc('2026-11-23T08:30:00.000Z'),
    })

    const bloque = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(bloque.ligne).toMatchObject({ statut: 'annule', erreurCode: 'PLAFOND_RELATIONNEL' })
    expect(bloque.transport.sends).toHaveLength(0)
  })

  it('should send the trial reminder when the only summary left the previous week', async () => {
    const { user, ligne } = await essaiTermine()
    await insererOutbox({
      type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: user.id, occurrence: '2026-W46', statut: 'envoye',
      envoyeLe: utc('2026-11-16T08:30:00.000Z'), createdAt: utc('2026-11-16T08:30:00.000Z'),
    })

    const { ligne: apres, transport } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres).toMatchObject({ statut: 'envoye', erreurCode: null })
    expect(transport.sends).toHaveLength(1)
  })

  it('should cancel the second trial reminder of the same ISO week (the first one already left)', async () => {
    const { abonnement, ligne } = await essaiTermine()
    const premiere = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)
    // Posée dans la même semaine que la première (jeudi), pour isoler la règle de la planification à J+7.
    await db.update(emailsTransactionnels).set({ prochaineTentative: utc('2026-11-26T08:00:00.000Z') })
      .where(eq(emailsTransactionnels.id, ligne(STATISTIQUES).id))

    const seconde = await traiter(ligne(STATISTIQUES).id, utc('2026-11-26T08:05:00.000Z'))

    expect(premiere.ligne.statut).toBe('envoye')
    expect(seconde.ligne).toMatchObject({ statut: 'annule', erreurCode: 'PLAFOND_RELATIONNEL' })
    expect(seconde.transport.sends).toHaveLength(0)
    expect(abonnement.id).toBe(ligne(STATISTIQUES).entiteId)
  })

  it('should NOT count a line of ANOTHER account against the reminder', async () => {
    const { ligne } = await essaiTermine()
    const autre = await creerPro()
    await insererOutbox({
      type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: autre.user.id, occurrence: '2026-W47', statut: 'envoye',
      envoyeLe: utc('2026-11-23T08:30:00.000Z'), createdAt: utc('2026-11-23T08:30:00.000Z'),
    })

    const { ligne: apres } = await traiter(ligne(SERVICES).id, JOUR_2_ENVOI)

    expect(apres.statut).toBe('envoye')
  })
})
