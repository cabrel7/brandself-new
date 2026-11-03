import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { abonnements } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { poserAbonnement } from './support/abonnements'
import { changerFuseau, creerPro, lireOutbox, RecordingTransport, utc, viderOutbox } from './support/notifications'
import { espionnerJournaux, modulesPlanification, traiter } from './support/planification'
import type { EspionJournaux } from './support/planification'

// S10 §6 CA71 à CA75, CA77 et #122 : rappels d'échéance J-7, J-3 et J0 dans l'outbox S9, planifiés par `planifierNotifications(now)`
// contre la VRAIE base, horloge injectée. Fuseau Africa/Douala (UTC+1). Échéance 2026-12-03T23:00Z : le dernier jour payé est le
// 3 décembre. Envoi à partir de 9 h locale, rattrapage de 6 h (donc jusqu'à 15 h locale exclu), occurrence `J{n}:{expire_le ISO}`.

const EXPIRE = new Date('2026-12-03T23:00:00.000Z')
const ISO = EXPIRE.toISOString()
let journaux: EspionJournaux | undefined

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

async function planifier(now: string) {
  const { planifierNotifications } = await modulesPlanification()
  return planifierNotifications(utc(now))
}

async function rappels() {
  return (await lireOutbox({ type: 'abonnement_rappel' })).map((l) => l.occurrence).sort()
}

async function abonne(options: Parameters<typeof creerPro>[0] = {}, expire: Date = EXPIRE) {
  await viderOutbox()
  const pro = await creerPro({ emailHebdo: false, emailRappelJour: false, ...options })
  const abonnement = await poserAbonnement(pro.user.id, expire)
  return { pro, abonnement }
}

describe('fenêtre d’envoi et idempotence (CA71)', () => {
  it('should plan nothing at 08:55 local, one J7 line at 09:00 local, and still one line at 09:05 (CA71)', async () => {
    const { abonnement } = await abonne()

    const avant = await planifier('2026-11-26T07:55:00.000Z')
    const pile = await planifier('2026-11-26T08:00:00.000Z')
    const rejeu = await planifier('2026-11-26T08:05:00.000Z')

    expect(avant.rappelsAbonnement).toBe(0)
    expect(pile.rappelsAbonnement).toBe(1)
    expect(rejeu.rappelsAbonnement).toBe(0)
    const lignes = await lireOutbox({ type: 'abonnement_rappel' })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      entiteType: 'abonnement',
      entiteId: abonnement.id,
      occurrence: `J7:${ISO}`,
      categorie: 'transactionnel',
      statut: 'en_attente',
      tentatives: 0,
    })
    expect(lignes[0]?.createdAt.getTime()).toBe(utc('2026-11-26T08:00:00.000Z').getTime())
    expect(`J7:${ISO}`).toBe('J7:2026-12-03T23:00:00.000Z')
    expect(`J7:${ISO}`.length).toBeLessThanOrEqual(32)
  })

  it('should keep a single line when two planner runs happen at the same instant, concurrently', async () => {
    await abonne()

    await Promise.all([planifier('2026-11-26T08:00:00.000Z'), planifier('2026-11-26T08:00:00.000Z'), planifier('2026-11-26T08:00:00.000Z')])

    expect(await rappels()).toEqual([`J7:${ISO}`])
  })

  it('should return the counter `rappelsAbonnement` next to the S9 counters, which keep working (CA77)', async () => {
    await abonne()

    const resultat = await planifier('2026-11-26T08:00:00.000Z')

    expect(Object.keys(resultat).sort()).toEqual(['fuseauxInvalides', 'rappelsAbonnement', 'rappelsJour', 'resumes'])
    expect(resultat).toMatchObject({ resumes: 0, rappelsJour: 0, rappelsAbonnement: 1, fuseauxInvalides: 0 })
  })
})

describe('J-7, J-3 et J0 (CA72)', () => {
  it('should plan J3 on 30 November and J0 on 3 December, and nothing on 1 December', async () => {
    await abonne()

    await planifier('2026-11-26T08:00:00.000Z')
    await planifier('2026-11-30T08:00:00.000Z')
    const creux = await planifier('2026-12-01T08:00:00.000Z')
    await planifier('2026-12-03T08:00:00.000Z')

    expect(creux.rappelsAbonnement).toBe(0)
    expect(await rappels()).toEqual([`J0:${ISO}`, `J3:${ISO}`, `J7:${ISO}`])
  })

  it('should send on the last included day (J0 = 3 December), never on the day of the exclusive expiry', async () => {
    await abonne()

    const jourDeLEcheance = await planifier('2026-12-04T08:00:00.000Z')

    expect(jourDeLEcheance.rappelsAbonnement).toBe(0)
    expect(await rappels()).toEqual([])
  })

  it('should catch up until 15:00 local excluded and not after (6 h of catch-up)', async () => {
    await abonne()

    const tard = await planifier('2026-11-26T14:00:00.000Z')
    expect(tard.rappelsAbonnement).toBe(0)
    const dernier = await planifier(new Date(utc('2026-11-26T14:00:00.000Z').getTime() - 1).toISOString())
    expect(dernier.rappelsAbonnement).toBe(1)
  })

  it('should plan nothing when the planner was down all the morning and wakes up at 16:00 local', async () => {
    await abonne()

    await planifier('2026-11-26T15:00:00.000Z')

    expect(await rappels()).toEqual([])
  })

  it('should follow the local day of the account time zone : Pacific/Pago_Pago (UTC-11) gets J7 on 25 November local', async () => {
    const { pro } = await abonne({ fuseau: 'Pacific/Pago_Pago' }, new Date('2026-12-04T11:00:00.000Z'))
    expect(pro.user.fuseau).toBe('Pacific/Pago_Pago')

    // 2026-11-26T20:00Z = 09:00 le 26 novembre à Pago Pago ; dernier jour payé local = 3 décembre -> J7 = 26 novembre.
    const resultat = await planifier('2026-11-26T20:00:00.000Z')

    expect(resultat.rappelsAbonnement).toBe(1)
  })

  it('should skip an invalid time zone without failing the other subscriptions, and count it in `fuseauxInvalides` (CA72)', async () => {
    journaux = espionnerJournaux()
    await abonne()
    const casse = await creerPro({ emailHebdo: false, emailRappelJour: false })
    await poserAbonnement(casse.user.id, EXPIRE)
    await changerFuseau(casse.user.id, 'Mars/Olympus')

    const resultat = await planifier('2026-11-26T08:00:00.000Z')

    expect(resultat.rappelsAbonnement).toBe(1)
    expect(resultat.fuseauxInvalides).toBe(1)
    expect(journaux.contenu()).not.toContain('Mars/Olympus')
  })

  it('should plan nothing for an expired subscription, in grace or not', async () => {
    await abonne({}, new Date('2026-11-20T23:00:00.000Z'))

    const resultat = await planifier('2026-11-26T08:00:00.000Z')

    expect(resultat.rappelsAbonnement).toBe(0)
  })
})

describe('renouvellement (CA73)', () => {
  it('should cancel a planned J7 line at send time once renewed (ABONNEMENT_RENOUVELE), without calling the transport, then plan the new deadline', async () => {
    const { abonnement } = await abonne()
    await planifier('2026-11-26T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })
    const nouvelle = new Date('2027-01-03T23:00:00.000Z')
    await db.update(abonnements).set({ expireLe: nouvelle }).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne!.id, utc('2026-11-26T08:01:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'ABONNEMENT_RENOUVELE' })
    expect(transport.sends).toHaveLength(0)
    await planifier('2026-12-27T08:00:00.000Z')
    await planifier('2026-12-31T08:00:00.000Z')
    await planifier('2027-01-03T08:00:00.000Z')
    const nouvelles = (await rappels()).filter((o) => o.endsWith(nouvelle.toISOString()))
    expect(nouvelles).toEqual([`J0:${nouvelle.toISOString()}`, `J3:${nouvelle.toISOString()}`, `J7:${nouvelle.toISOString()}`])
  })

  it('should cancel with RAPPEL_PERIME when the deadline has passed by the time the line is sent', async () => {
    await abonne()
    await planifier('2026-12-03T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })

    const { ligne: apres, transport } = await traiter(ligne!.id, utc('2026-12-04T09:00:00.000Z'))

    expect(apres).toMatchObject({ statut: 'annule', erreurCode: 'RAPPEL_PERIME' })
    expect(transport.sends).toHaveLength(0)
  })

  it('should cancel a reminder whose subscription row disappeared (account deleted) instead of failing', async () => {
    const { abonnement } = await abonne()
    await planifier('2026-11-26T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })
    await db.delete(abonnements).where(eq(abonnements.id, abonnement.id))

    const { ligne: apres, transport } = await traiter(ligne!.id, utc('2026-11-26T08:01:00.000Z'))

    expect(apres.statut).toBe('annule')
    expect(transport.sends).toHaveLength(0)
  })
})

describe('contenu du rappel J3 (CA74)', () => {
  async function envoyerJ3() {
    const { pro } = await abonne({ emailContact: 'pro@exemple.test' })
    await planifier('2026-11-30T08:00:00.000Z')
    const [ligne] = await lireOutbox({ type: 'abonnement_rappel' })
    const transport = new RecordingTransport()
    const { ligne: envoyee } = await traiter(ligne!.id, utc('2026-11-30T08:01:00.000Z'), transport)
    return { pro, envoyee, transport }
  }

  it('should say the plan ends in 3 days, is not renewed automatically, give the date, the grace, the no deletion promise and the renewal link', async () => {
    const { envoyee, transport } = await envoyerJ3()

    expect(envoyee.statut).toBe('envoye')
    const message = transport.dernier
    const texte = message.text.replaceAll(/[\s\u202F\u00A0]+/gu, ' ')
    expect(message.subject).toBe('Votre abonnement se termine dans 3 jours')
    expect(texte).toContain('ne se renouvelle pas automatiquement')
    expect(texte).toContain('3 décembre 2026')
    expect(texte).toMatch(/7 jours/)
    expect(texte.toLowerCase()).toMatch(/rien n['’]est supprimé/)
    expect(texte).toMatch(/\/studio\/compte\?periode=1#abonnement/)
  })

  it('should be a transactional message with no unsubscribe header, sent to the account address (the contact address is only the fallback for phone accounts)', async () => {
    const { pro, transport } = await envoyerJ3()

    expect(transport.dernier.headers?.['List-Unsubscribe']).toBeUndefined()
    expect(transport.dernier.headers?.['List-Unsubscribe-Post']).toBeUndefined()
    expect(transport.dernier.to).toBe(pro.user.email)
  })

  it('should not contain a price, a phone number or a payment identifier', async () => {
    const { transport } = await envoyerJ3()

    expect(transport.dernier.text).not.toMatch(/KPAY|tx_|\+237 ?6/)
  })
})

describe('destinataire (CA75)', () => {
  it('should plan no reminder for a phone account with a temporary e-mail and no contact e-mail', async () => {
    await abonne({ emailTemporaire: true, emailContact: null })

    const resultat = await planifier('2026-11-26T08:00:00.000Z')

    expect(resultat.rappelsAbonnement).toBe(0)
    expect(await rappels()).toEqual([])
  })

  it('should plan the reminder for a phone account that gave a contact e-mail', async () => {
    await abonne({ emailTemporaire: true, emailContact: 'contact@exemple.test' })

    const resultat = await planifier('2026-11-26T08:00:00.000Z')

    expect(resultat.rappelsAbonnement).toBe(1)
  })
})
