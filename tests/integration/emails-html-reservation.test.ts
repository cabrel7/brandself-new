import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { services, vitrines } from '../../shared/db/schema'
import { env } from '../../shared/env'
import type { TransactionalEmailType } from '../../shared/jobs'
import { processTransactionalEmail } from '../../server/services/email-outbox'
import type { EmailMessage } from '../../server/services/emails/transport'
import { db } from '../../server/utils/db'
import {
  RecordingTransport,
  VISITEUR_DEFAUT,
  creerPro,
  insererOutbox,
  insererReservation,
  lireOutboxParId,
  utc,
} from './support/notifications'
import type { Pro } from './support/notifications'

// ÉTAPE 1 (RED) — décision #26, lot 1 : les 4 e-mails de réservation au visiteur partent en HTML + texte, avec la palette
// du professionnel et `Reply-To` = e-mail de contact PUBLIC de la vitrine. Vraie base ; seul le transport est factice.
// Les e-mails destinés au professionnel restent en texte seul (lot 2).

type MessageHtml = EmailMessage & { html?: string, replyTo?: string }

const SITE = env.NUXT_PUBLIC_SITE_URL
const DEBUT = utc('2026-11-12T09:00:00.000Z')
const PIEGE = '"><script>alert(1)</script><img src=x onerror=alert(1)>'
const CONTACT = 'contact@cabinet.test'
const TYPES_VISITEUR = [
  'reservation_visiteur_recue',
  'reservation_visiteur_confirmee',
  'reservation_visiteur_annulee',
  'reservation_visiteur_refusee',
] as const satisfies readonly TransactionalEmailType[]

interface Cas {
  pro: Pro
  transport: RecordingTransport
  outboxId: string
}

async function preparer(type: TransactionalEmailType, options: { emailContact?: string | null, palette?: string } = {}): Promise<Cas> {
  const pro = await creerPro({
    username: 'dr-test',
    emailContact: options.emailContact === undefined ? CONTACT : options.emailContact,
  })
  await db.update(vitrines).set({ palette: options.palette ?? 'sauge' }).where(eq(vitrines.id, pro.vitrine.id))
  const statut = type === 'reservation_visiteur_annulee' ? 'annulee' : type === 'reservation_visiteur_refusee' ? 'refusee' : 'confirmee'
  const reservation = await insererReservation(pro.vitrine.id, pro.service.id, { debut: DEBUT, statut })
  const ligne = await insererOutbox({ type, entiteType: 'reservation', entiteId: reservation.id })
  return { pro, transport: new RecordingTransport(), outboxId: ligne.id }
}

async function envoyer(cas: Cas): Promise<MessageHtml> {
  const resultat = await processTransactionalEmail(cas.outboxId, cas.transport, new Date(Date.now() + 1000))
  expect(resultat.statut).toBe('envoye')
  expect((await lireOutboxParId(cas.outboxId)).statut).toBe('envoye')
  return cas.transport.dernier as MessageHtml
}

describe('e-mails de réservation au visiteur : HTML + palette + Reply-To (lot 1)', () => {
  it('should send a confirmed reservation in HTML with the sauge accent and a link to the vitrine, replyTo = public contact e-mail', async () => {
    const cas = await preparer('reservation_visiteur_confirmee')

    const message = await envoyer(cas)

    expect(message.to).toBe(VISITEUR_DEFAUT.email)
    expect(message.html).toBeDefined()
    expect(message.html?.toLowerCase()).toContain('#3f6b4f')
    expect(message.html).toContain(`href="${SITE}/dr-test"`)
    expect(message.replyTo).toBe(CONTACT)
    expect(message.text).toContain('Votre réservation est confirmée. Nous vous attendons avec plaisir.')
    expect(message.attachments.map((a) => a.filename)).toEqual(['reservation.ics'])
  })

  it.each(TYPES_VISITEUR)('should send %s with html, replyTo and the professional signature', async (type) => {
    const cas = await preparer(type)

    const message = await envoyer(cas)

    expect(message.html).toBeDefined()
    expect(message.replyTo).toBe(CONTACT)
    expect(message.text.startsWith('Bonjour,\n\n')).toBe(true)
    expect(message.text).toContain('\n\nÀ bientôt,\nDr Cabrel Nguesso\nCardiologue\n')
    expect(message.text.endsWith('\n\n—\nVous recevez cet e-mail à la suite de votre réservation sur la vitrine de Dr Cabrel Nguesso.\nEnvoyé via jesuis.pro')).toBe(true)
    expect(message.html).not.toMatch(/<img|src=|url\(|<script|<link|@import|<form|<iframe/i)
  })

  it('should omit replyTo when the vitrine has no public contact e-mail, even if the account has a real e-mail', async () => {
    const cas = await preparer('reservation_visiteur_confirmee', { emailContact: null })

    const message = await envoyer(cas)

    expect(cas.pro.user.email).toMatch(/@exemple\.test$/)
    expect(message.replyTo).toBeUndefined()
    expect(message.html).toBeDefined()
    expect(JSON.stringify(message)).not.toContain(cas.pro.user.email)
  })

  it('should not use the account e-mail as replyTo when the contact e-mail is blank', async () => {
    const cas = await preparer('reservation_visiteur_confirmee', { emailContact: '   ' })

    const message = await envoyer(cas)

    expect(message.replyTo).toBeUndefined()
  })

  it('should keep the visitor personal data out of the HTML (phone, motive, e-mail, name)', async () => {
    const cas = await preparer('reservation_visiteur_confirmee')

    const message = await envoyer(cas)

    for (const donnee of [VISITEUR_DEFAUT.telephone, VISITEUR_DEFAUT.note, VISITEUR_DEFAUT.email, VISITEUR_DEFAUT.nom]) {
      expect(message.html, donnee).not.toContain(donnee)
    }
  })

  it('should use the palette of the vitrine (indigo accent, not sauge)', async () => {
    const cas = await preparer('reservation_visiteur_confirmee', { palette: 'indigo' })

    const message = await envoyer(cas)

    expect(message.html?.toLowerCase()).toContain('#3b3f8c')
    expect(message.html?.toLowerCase()).not.toContain('#3f6b4f')
  })

  it('should escape trapped vitrine and service fields in the HTML while the text stays raw', async () => {
    const cas = await preparer('reservation_visiteur_confirmee')
    await db.update(vitrines).set({ prenom: PIEGE, nom: PIEGE, metier: PIEGE, ville: PIEGE }).where(eq(vitrines.id, cas.pro.vitrine.id))
    await db.update(services).set({ titre: PIEGE, paiementInstructions: PIEGE }).where(eq(services.id, cas.pro.service.id))

    const message = await envoyer(cas)

    expect(message.html).not.toMatch(/<script/i)
    expect(message.html).not.toMatch(/<img/i)
    expect(message.html).not.toContain('"><')
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(message.text).toContain(PIEGE)
  })

  it.each(['reservation_visiteur_annulee', 'reservation_visiteur_refusee'] as const)(
    'should offer a button to /{username}/agenda in %s, and the same URL in the text',
    async (type) => {
      const cas = await preparer(type)

      const message = await envoyer(cas)

      const url = `${SITE}/dr-test/agenda`
      expect(message.html).toMatch(new RegExp(`<a\\b[^>]*href="${url.replaceAll('.', '\\.')}"`))
      expect(message.html).toMatch(/data-element="bouton"/)
      expect(message.text).toContain(url)
    },
  )

  it('should keep every href on the site origin', async () => {
    const cas = await preparer('reservation_visiteur_annulee')

    const message = await envoyer(cas)

    const hrefs = [...(message.html ?? '').matchAll(/\bhref="([^"]*)"/gi)].map((m) => m[1] as string)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) expect(href.startsWith(SITE), href).toBe(true)
  })

  it('should keep reservation_professionnel_nouvelle text-only and unchanged in lot 1 (no html, no replyTo)', async () => {
    const cas = await preparer('reservation_professionnel_nouvelle')

    const message = await envoyer(cas)

    expect(message.to).toBe(cas.pro.user.email)
    expect(message.subject).toBe('Nouvelle réservation reçue')
    expect(message.html).toBeUndefined()
    expect(message.replyTo).toBeUndefined()
    expect(message.text.startsWith('Bonjour,\n\nVous avez reçu une nouvelle demande de réservation.\n\nService : Consultation de cardiologie\nProfessionnel : Dr Cabrel Nguesso\n')).toBe(true)
    expect(message.text).toContain(`Visiteur : ${VISITEUR_DEFAUT.nom}`)
    expect(message.text).toContain(`Email : ${VISITEUR_DEFAUT.email}`)
    expect(message.text.endsWith('Connectez-vous à votre studio pour la confirmer.\n\njesuis.pro')).toBe(true)
    expect(message.attachments).toEqual([])
  })
})
