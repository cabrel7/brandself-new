import { describe, expect, it } from 'vitest'
import { buildTransactionalEmail } from '../../server/services/emails/contenus'

const OUTBOX_ID = '11111111-1111-4111-8111-111111111111'
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222'
const DEMANDE_ID = '33333333-3333-4333-8333-333333333333'
const PII = {
  nom: 'Alice Personne Secrete',
  email: 'alice.secrete@exemple.test',
  telephone: '+237699999999',
  motif: 'MOTIF MEDICAL STRICTEMENT PRIVE',
}

const common = {
  outboxId: OUTBOX_ID,
  generatedAt: new Date('2026-10-30T12:34:56.000Z'),
  professionnelEmail: 'cabrel.pro@exemple.test',
  vitrine: {
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    metier: 'Cardiologue interventionnel',
    ville: 'Douala',
    fuseau: 'Africa/Douala',
  },
  service: {
    titre: 'Consultation de cardiologie',
    dureeMin: 45,
    tarif: 'payant',
    prixMontant: 15_000,
    prixDevise: 'XAF',
    paiementInstructions: 'Règlement sur place par Mobile Money.',
  },
  visiteur: PII,
} as const

const reservation = {
  id: RESERVATION_ID,
  debut: new Date('2026-11-02T09:00:00.000Z'),
  fin: new Date('2026-11-02T09:45:00.000Z'),
  paiementChoisi: 'sur_place',
} as const

function attachmentText(message: ReturnType<typeof buildTransactionalEmail>): string {
  const attachment = message.attachments?.[0]
  if (!attachment) throw new Error('Pièce jointe ICS absente.')
  return Buffer.isBuffer(attachment.content) ? attachment.content.toString('utf8') : attachment.content
}

function expectNoSensitiveValue(value: string): void {
  for (const secret of Object.values(PII)) expect(value).not.toContain(secret)
}

describe('contenus des emails transactionnels de réservation', () => {
  it('adresse au professionnel un récapitulatif complet sans mettre le motif dans le sujet', () => {
    const message = buildTransactionalEmail({
      ...common,
      type: 'reservation_professionnel_nouvelle',
      reservation,
    })

    expect(message.to).toBe(common.professionnelEmail)
    expect(message.subject).toBe('Nouvelle réservation reçue')
    expect(message.subject).not.toContain(PII.motif)
    expect(message.text).toContain(common.service.titre)
    expect(message.text).toContain(PII.nom)
    expect(message.text).toContain(PII.email)
    expect(message.text).toContain(PII.telephone)
    expect(message.text).toContain(PII.motif)
    expect(message.attachments).toEqual([])
  })

  it('confirme la réception au visiteur avec un récapitulatif sans ses PII ni son motif et un ICS TENTATIVE', () => {
    const message = buildTransactionalEmail({
      ...common,
      type: 'reservation_visiteur_recue',
      reservation,
    })
    const ics = attachmentText(message)

    expect(message.to).toBe(PII.email)
    expect(message.subject).toBe('Votre demande de réservation a bien été reçue')
    expect(message.text).toContain(common.service.titre)
    expect(message.text).toContain('Dr Cabrel Nguesso')
    expect(message.text).toContain('Douala')
    expect(message.text).toContain('XAF')
    expectNoSensitiveValue(`${message.subject}\n${message.text}`)
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('STATUS:TENTATIVE')
    expectNoSensitiveValue(ics)
  })

  it.each([
    ['reservation_visiteur_confirmee', 'REQUEST', 'CONFIRMED'],
    ['reservation_visiteur_annulee', 'CANCEL', 'CANCELLED'],
  ] as const)('produit la mise à jour ICS %s sans PII', (type, method, status) => {
    const message = buildTransactionalEmail({ ...common, type, reservation })
    const ics = attachmentText(message)

    expect(message.to).toBe(PII.email)
    expect(ics).toContain(`METHOD:${method}`)
    expect(ics).toContain(`STATUS:${status}`)
    expect(ics).toContain(`UID:${RESERVATION_ID}@brandself`)
    expectNoSensitiveValue(`${message.subject}\n${message.text}\n${ics}`)
  })
})

describe('contenus des emails transactionnels de demande', () => {
  it('réserve le message et les coordonnées au professionnel', () => {
    const professionnel = buildTransactionalEmail({
      ...common,
      type: 'demande_professionnel_nouvelle',
      demande: { id: DEMANDE_ID },
    })
    const visiteur = buildTransactionalEmail({
      ...common,
      type: 'demande_visiteur_recue',
      demande: { id: DEMANDE_ID },
    })

    expect(professionnel.to).toBe(common.professionnelEmail)
    expect(professionnel.text).toContain(PII.nom)
    expect(professionnel.text).toContain(PII.email)
    expect(professionnel.text).toContain(PII.telephone)
    expect(professionnel.text).toContain(PII.motif)
    expect(professionnel.subject).not.toContain(PII.motif)

    expect(visiteur.to).toBe(PII.email)
    expect(visiteur.text).toContain(common.service.titre)
    expectNoSensitiveValue(`${visiteur.subject}\n${visiteur.text}`)
    expect(visiteur.attachments).toEqual([])
  })
})

// S7-bis (CA9) : le nouveau message déclenche un email au professionnel (destinataire
// résolu par `professionalRecipient`), le refus produit un email distinct de l'annulation
// et retire l'événement TENTATIVE de l'agenda du visiteur.
describe('contenus des emails transactionnels de message (S7-bis)', () => {
  const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
  // Le contenu d'un email de message n'a pas de service (la page Contact n'en mentionne pas).
  const { service: _sansService, ...sansService } = common

  it('adresse au professionnel un email dont le sujet porte le nom et le sujet du visiteur', () => {
    const message = buildTransactionalEmail({
      ...sansService,
      type: 'message_professionnel_nouvelle',
      message: {
        id: MESSAGE_ID,
        nom: PII.nom,
        email: PII.email,
        telephone: PII.telephone,
        sujet: 'question_avant_reservation',
        texte: 'Bonjour, le rendez-vous peut-il être décalé ?',
      },
    })

    expect(message.to).toBe(common.professionnelEmail)
    expect(message.subject).toBe(`Nouveau message de ${PII.nom} — Une question avant de réserver`)
    expect(message.text).toContain('Vous avez reçu un nouveau message')
    expect(message.text).toContain(PII.nom)
    expect(message.text).toContain(PII.email)
    expect(message.text).toContain(PII.telephone)
    expect(message.text).toContain('Bonjour, le rendez-vous peut-il être décalé ?')
    expect(message.attachments).toEqual([])
  })

  it('omet la ligne téléphone quand le visiteur n’en a pas fourni (facultatif)', () => {
    const message = buildTransactionalEmail({
      ...sansService,
      type: 'message_professionnel_nouvelle',
      message: {
        id: MESSAGE_ID,
        nom: PII.nom,
        email: PII.email,
        telephone: null,
        sujet: 'autre',
        texte: 'Quelques lignes suffisent.',
      },
    })

    expect(message.subject).toBe(`Nouveau message de ${PII.nom} — Autre`)
    expect(message.text).not.toContain('Téléphone :')
    expect(message.text).toContain('Quelques lignes suffisent.')
  })

  it('annonce le refus au visiteur sans blâme et retire l’événement de son agenda', () => {
    const message = buildTransactionalEmail({ ...common, type: 'reservation_visiteur_refusee', reservation })
    const ics = attachmentText(message)

    expect(message.to).toBe(PII.email)
    expect(message.subject).toBe('Votre demande n’a pas pu être confirmée')
    expect(message.text).toContain('Vous pouvez choisir un autre créneau sur la vitrine.')
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain('STATUS:CANCELLED')
    expectNoSensitiveValue(`${message.text}\n${ics}`)
  })
})
