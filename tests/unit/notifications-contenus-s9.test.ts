import { describe, expect, it } from 'vitest'
import { buildTransactionalEmail } from '../../server/services/emails/contenus'
import { LIST_UNSUBSCRIBE_POST_VALEUR, RAPPEL_JOURNEE_MAX_LIGNES, SUGGESTION_RESUME_DEFAUT } from '../../shared/notifications'
import { PROCHAINES_ETAPES } from '../../shared/prochaine-etape'
import { displayName } from '../../shared/vitrine'

// S9 §5 / CA08, CA15, CA23, CA27, CA28, CA29, CA45 : contenus des trois nouveaux e-mails (texte seul).
// `buildTransactionalEmail` (server/services/emails/contenus.ts) est le point d'entrée existant ; les trois
// nouveaux types y sont branchés (le module notifications-contenus.ts peut les porter). FORMES D'ENTRÉE SUPPOSÉES
// au-delà de la spec (à confirmer par le backend, une seule définition ci-dessous) :
//   - rappel visiteur : le contenu d'une réservation existante + `siteUrl` + `vitrine.username` ;
//   - rendez-vous du jour : { destinataire, prenom, fuseau, jour: Date, rendezVous[{ debut, service, visiteur, statut }],
//     siteUrl, jetonDesabonnement } ;
//   - résumé : { destinataire, prenom, fuseau, periode: { debut, fin }, compteurs { reservations, demandes, messages,
//     rendezVousSemaine, visites: number | null, clics: number | null }, suggestion { titre, texte, chemin: string | null },
//     siteUrl, jetonDesabonnement }.
// Les en-têtes sont portés par `EmailMessage.headers` (spec §5.5).

const SITE = 'https://brandself.io'
const JETON = 'v1.eyJ1IjoiYSIsInAiOiJlbWFpbF9oZWJkbyIsImUiOjF9.c2lnbmF0dXJlLWRlLXRlc3QtMDEyMzQ1Njc4OTAxMjM0NQ'
const OUTBOX_ID = '11111111-1111-4111-8111-111111111111'
const GENERE_LE = new Date('2026-11-10T06:00:00.000Z')

const PII = {
  nom: 'Alice Personne Secrete',
  email: 'alice.secrete@exemple.test',
  telephone: '+237699999999',
  motif: 'MOTIF MEDICAL STRICTEMENT PRIVE',
}

type Contenu = Parameters<typeof buildTransactionalEmail>[0]

function contenu(valeur: Record<string, unknown>): Contenu {
  return valeur as unknown as Contenu
}

/** Les apostrophes typographiques de l'application (’) valent l'apostrophe droite de la spec. */
function normaliser(texte: string): string {
  return texte.replaceAll('’', "'")
}

const NOM_PRO = displayName('dr', 'Cabrel', 'Nguesso')

const rappelBase = {
  type: 'reservation_visiteur_rappel',
  outboxId: OUTBOX_ID,
  generatedAt: GENERE_LE,
  professionnelEmail: 'cabrel.pro@exemple.test',
  siteUrl: SITE,
  vitrine: {
    username: 'dr-cabrel',
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
    paiementInstructions: null,
  },
  visiteur: PII,
  reservation: {
    id: '22222222-2222-4222-8222-222222222222',
    debut: new Date('2026-11-12T09:00:00.000Z'),
    fin: new Date('2026-11-12T09:45:00.000Z'),
    paiementChoisi: 'sur_place',
  },
}

function rappel(surcharge: Record<string, unknown> = {}): ReturnType<typeof buildTransactionalEmail> {
  return buildTransactionalEmail(contenu({ ...rappelBase, ...surcharge }))
}

const rendezVousBase = [
  { debut: new Date('2026-11-10T08:00:00.000Z'), service: 'Consultation de cardiologie', visiteur: 'Marie Ndzi', statut: 'confirmee' },
  { debut: new Date('2026-11-10T10:30:00.000Z'), service: 'Bilan', visiteur: 'Paul Ewane', statut: 'en_attente' },
]

const journeeBase = {
  type: 'utilisateur_rappel_journee',
  outboxId: OUTBOX_ID,
  generatedAt: GENERE_LE,
  destinataire: 'cabrel.pro@exemple.test',
  prenom: 'Cabrel',
  fuseau: 'Africa/Douala',
  jour: new Date('2026-11-10T06:00:00.000Z'),
  rendezVous: rendezVousBase,
  siteUrl: SITE,
  jetonDesabonnement: JETON,
}

function journee(surcharge: Record<string, unknown> = {}): ReturnType<typeof buildTransactionalEmail> {
  return buildTransactionalEmail(contenu({ ...journeeBase, ...surcharge }))
}

function nRendezVous(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    debut: new Date(Date.UTC(2026, 10, 10, 7, 0) + index * 60_000),
    service: `Service ${index + 1}`,
    visiteur: `Visiteur ${index + 1}`,
    statut: 'confirmee',
  }))
}

const resumeBase = {
  type: 'utilisateur_resume_hebdo',
  outboxId: OUTBOX_ID,
  generatedAt: new Date('2026-11-02T07:00:00.000Z'),
  destinataire: 'cabrel.pro@exemple.test',
  prenom: 'Cabrel',
  fuseau: 'Africa/Douala',
  periode: { debut: new Date('2026-10-25T23:00:00.000Z'), fin: new Date('2026-11-01T23:00:00.000Z') },
  compteurs: { reservations: 3, demandes: 1, messages: 2, rendezVousSemaine: 2, visites: null, clics: null },
  suggestion: { ...PROCHAINES_ETAPES.realisation },
  siteUrl: SITE,
  jetonDesabonnement: JETON,
}

function resume(surcharge: Record<string, unknown> = {}, compteurs: Record<string, unknown> = {}): ReturnType<typeof buildTransactionalEmail> {
  return buildTransactionalEmail(contenu({
    ...resumeBase,
    compteurs: { ...resumeBase.compteurs, ...compteurs },
    ...surcharge,
  }))
}

const SANS_ACTIVITE = { reservations: 0, demandes: 0, messages: 0, rendezVousSemaine: 0 }

function lignes(texte: string): string[] {
  return normaliser(texte).split('\n')
}

function expectTexteSeul(message: ReturnType<typeof buildTransactionalEmail>): void {
  expect(Object.keys(message)).not.toContain('html')
  expect(message.text).not.toMatch(/<\/?[a-z][^>]*>/i)
  expect(message.subject).not.toMatch(/[\r\n]/)
  expect(message.attachments).toEqual([])
}

function expectPied(message: ReturnType<typeof buildTransactionalEmail>): void {
  const corps = lignes(message.text)
  const indexTiret = corps.lastIndexOf('—')
  expect(indexTiret).toBeGreaterThan(0)
  expect(corps[indexTiret - 1]).toBe('')
  expect(corps.slice(indexTiret).join('\n')).toMatch(/Vous recevez/)
}

describe('reservation_visiteur_rappel (§5.1, CA08, CA15)', () => {
  it('should address the visitor with a subject that names the day and the local time, never « demain »', () => {
    const message = rappel()

    expect(message.to).toBe(PII.email)
    expect(message.subject).toBe('Rappel : votre rendez-vous du jeudi 12 novembre à 10:00')
    expect(message.subject.toLowerCase()).not.toContain('demain')
    expect(message.text.toLowerCase()).not.toContain('demain')
  })

  it('should render the full local date in the vitrine zone: Thursday 12 November 2026 at 10:00 for Douala (CA08)', () => {
    expect(rappel().text).toContain('Date : jeudi 12 novembre 2026 à 10:00')
  })

  it('should keep the 24 absolute hours across the DST change of Paris: Monday 26 October 2026 at 10:00 (CA15)', () => {
    const message = rappel({
      vitrine: { ...rappelBase.vitrine, fuseau: 'Europe/Paris' },
      reservation: { ...rappelBase.reservation, debut: new Date('2026-10-26T09:00:00.000Z'), fin: new Date('2026-10-26T09:45:00.000Z') },
    })

    expect(message.subject).toBe('Rappel : votre rendez-vous du lundi 26 octobre à 10:00')
    expect(message.text).toContain('Date : lundi 26 octobre 2026 à 10:00')
  })

  it('should follow the spec body: greeting, intro, recap lines, link to the vitrine, closing and the reason footer', () => {
    const corps = lignes(rappel().text)

    expect(corps[0]).toBe('Bonjour,')
    expect(corps).toContain(`Petit rappel : votre rendez-vous avec ${NOM_PRO} approche.`)
    expect(corps).toContain('Service : Consultation de cardiologie')
    expect(corps).toContain(`Professionnel : ${NOM_PRO}`)
    expect(corps).toContain('Durée : 45 minutes')
    expect(corps).toContain('Lieu : Douala')
    expect(corps.some((ligne) => ligne.startsWith('Tarif : '))).toBe(true)
    expect(corps).toContain('Règlement : sur place')
    expect(corps).toContain(`Un empêchement ? Prévenez ${NOM_PRO} dès que possible depuis sa vitrine :`)
    expect(corps).toContain(`${SITE}/dr-cabrel`)
    expect(corps).toContain('À bientôt,')
    expect(corps).toContain('Brandself')
    expect(corps).toContain(`Vous recevez ce rappel parce que vous l'avez demandé en réservant sur la vitrine de ${NOM_PRO}. C'est le seul rappel prévu pour ce rendez-vous.`)
    expectPied(rappel())
  })

  it('should omit the duration and the place when they are unknown', () => {
    const message = rappel({
      service: { ...rappelBase.service, dureeMin: null },
      vitrine: { ...rappelBase.vitrine, ville: null },
    })

    expect(message.text).not.toContain('Durée :')
    expect(message.text).not.toContain('Lieu :')
  })

  it('should carry no phone number and no reason of the visitor (minimization #100)', () => {
    const { text, subject } = rappel()

    expect(text).not.toContain(PII.telephone)
    expect(text).not.toContain(PII.motif)
    expect(subject).not.toContain(PII.motif)
  })

  it('should attach no ICS: the event was already sent and a new sequence would duplicate it in the agenda', () => {
    expect(rappel().attachments).toEqual([])
  })

  it('should carry no List-Unsubscribe header (a visitor reminder is not unsubscribable)', () => {
    const entetes = rappel().headers ?? {}

    expect(Object.keys(entetes).map((nom) => nom.toLowerCase())).not.toContain('list-unsubscribe')
    expect(Object.keys(entetes).map((nom) => nom.toLowerCase())).not.toContain('list-unsubscribe-post')
  })

  it('should be plain text only (no HTML, no pixel)', () => {
    expectTexteSeul(rappel())
  })

  it('should neutralise line breaks injected through the professional or service names (singleLine)', () => {
    const message = rappel({
      vitrine: { ...rappelBase.vitrine, prenom: 'Cabrel\r\nBcc: pirate@exemple.test', nom: 'Nguesso' },
      service: { ...rappelBase.service, titre: 'Bilan\nInjection: oui' },
    })
    const corps = lignes(message.text)

    expect(corps.some((ligne) => ligne.startsWith('Bcc:'))).toBe(false)
    expect(corps.some((ligne) => ligne.startsWith('Injection:'))).toBe(false)
    expect(message.subject).not.toMatch(/[\r\n]/)
  })
})

describe('utilisateur_rappel_journee (§5.2, CA23, CA45)', () => {
  it('should address the professional with « Vos rendez-vous du … » in the user zone (plural)', () => {
    const message = journee()

    expect(message.to).toBe('cabrel.pro@exemple.test')
    expect(message.subject).toBe('Vos rendez-vous du mardi 10 novembre')
  })

  it('should say « Votre rendez-vous du … » when there is exactly one', () => {
    const message = journee({ rendezVous: rendezVousBase.slice(0, 1) })

    expect(message.subject).toBe('Votre rendez-vous du mardi 10 novembre')
    expect(lignes(message.text)).toContain('Voici votre journée : 1 rendez-vous.')
  })

  it('should name the local day, not the UTC day (23:30Z is already the next day in Douala, still the day before in New York)', () => {
    const tard = new Date('2026-11-09T23:30:00.000Z')

    expect(journee({ jour: tard }).subject).toBe('Vos rendez-vous du mardi 10 novembre')
    expect(journee({ jour: tard, fuseau: 'America/New_York' }).subject).toBe('Vos rendez-vous du lundi 9 novembre')
  })

  it('should count the appointments and those to confirm in the introduction (CA23)', () => {
    const corps = lignes(journee().text)

    expect(corps[0]).toBe('Bonjour Cabrel,')
    expect(corps).toContain('Voici votre journée : 2 rendez-vous, dont 1 à confirmer.')
  })

  it('should not mention « à confirmer » in the introduction when everything is confirmed', () => {
    const message = journee({ rendezVous: rendezVousBase.map((rdv) => ({ ...rdv, statut: 'confirmee' })) })

    expect(lignes(message.text)).toContain('Voici votre journée : 2 rendez-vous.')
    expect(message.text).not.toContain('à confirmer')
  })

  it('should list each appointment with the local time, the service and the visitor name, marking the pending one (CA23)', () => {
    const corps = lignes(journee().text)

    expect(corps).toContain('• 09:00 — Consultation de cardiologie — Marie Ndzi')
    expect(corps).toContain('• 11:30 — Bilan — Paul Ewane (à confirmer)')
  })

  it('should keep the chronological order of the list', () => {
    const corps = lignes(journee().text)

    expect(corps.indexOf('• 09:00 — Consultation de cardiologie — Marie Ndzi')).toBeLessThan(corps.indexOf('• 11:30 — Bilan — Paul Ewane (à confirmer)'))
  })

  it('should never carry the e-mail, the phone number or the reason of a visitor, even if the caller passes them (CA23, #100)', () => {
    const message = journee({ rendezVous: rendezVousBase.map((rdv) => ({ ...rdv, email: PII.email, telephone: PII.telephone, motif: PII.motif, note: PII.motif })) })

    expect(message.text).not.toContain(PII.email)
    expect(message.text).not.toContain(PII.telephone)
    expect(message.text).not.toContain(PII.motif)
    expect(message.subject).not.toContain(PII.motif)
  })

  it(`should cap the list at ${RAPPEL_JOURNEE_MAX_LIGNES} lines and summarise the rest, counting the real total in the introduction`, () => {
    const message = journee({ rendezVous: nRendezVous(25) })
    const corps = lignes(message.text)

    expect(corps.filter((ligne) => ligne.startsWith('• '))).toHaveLength(RAPPEL_JOURNEE_MAX_LIGNES)
    expect(corps).toContain('… et 5 autres.')
    expect(corps).toContain('Voici votre journée : 25 rendez-vous.')
  })

  it('should list exactly the maximum without any « et n autres » line', () => {
    const corps = lignes(journee({ rendezVous: nRendezVous(RAPPEL_JOURNEE_MAX_LIGNES) }).text)

    expect(corps.filter((ligne) => ligne.startsWith('• '))).toHaveLength(RAPPEL_JOURNEE_MAX_LIGNES)
    expect(corps.some((ligne) => ligne.startsWith('… et '))).toBe(false)
  })

  it('should summarise a single extra appointment', () => {
    const corps = lignes(journee({ rendezVous: nRendezVous(RAPPEL_JOURNEE_MAX_LIGNES + 1) }).text)

    expect(corps.some((ligne) => /^… et 1 autres?\.$/.test(ligne))).toBe(true)
  })

  it('should link the agenda, offer the one-click unsubscribe and the account page in the footer', () => {
    const message = journee()
    const corps = lignes(message.text)

    expect(corps).toContain(`Le détail est dans votre agenda : ${SITE}/studio/agenda`)
    expect(corps).toContain('Belle journée,')
    expect(corps).toContain("Vous recevez cet e-mail parce que vous avez des rendez-vous aujourd'hui.")
    expect(corps).toContain(`Ne plus le recevoir, en un clic : ${SITE}/desabonnement?jeton=${JETON}`)
    expect(corps).toContain(`Gérer vos e-mails : ${SITE}/studio/compte`)
    expectPied(message)
  })

  it('should carry the RFC 8058 headers pointing at the API route with the same token (CA45)', () => {
    const entetes = journee().headers

    expect(entetes?.['List-Unsubscribe']).toBe(`<${SITE}/api/public/desabonnement?jeton=${JETON}>`)
    expect(entetes?.['List-Unsubscribe-Post']).toBe(LIST_UNSUBSCRIBE_POST_VALEUR)
    expect(entetes?.['List-Unsubscribe']).toMatch(/^<https:\/\//)
  })

  it('should be plain text only and neutralise line breaks in the visitor name and service (singleLine)', () => {
    const message = journee({
      rendezVous: [{ ...rendezVousBase[0]!, visiteur: 'Marie\r\nBcc: pirate@exemple.test', service: 'Bilan\nInjection: oui' }],
    })
    const corps = lignes(message.text)

    expectTexteSeul(message)
    expect(corps.some((ligne) => ligne.startsWith('Bcc:') || ligne.startsWith('Injection:'))).toBe(false)
    expect(corps.filter((ligne) => ligne.startsWith('• '))).toHaveLength(1)
  })
})

describe('utilisateur_resume_hebdo avec activité (§5.3, CA26, CA27, CA45)', () => {
  it('should title the e-mail with the non-zero counts, with plurals (CA27)', () => {
    const message = resume()

    expect(message.to).toBe('cabrel.pro@exemple.test')
    expect(message.subject).toBe('Votre semaine : 3 réservations, 1 demande, 2 messages')
  })

  it.each([
    [{ reservations: 1, demandes: 0, messages: 0 }, 'Votre semaine : 1 réservation'],
    [{ reservations: 0, demandes: 1, messages: 0 }, 'Votre semaine : 1 demande'],
    [{ reservations: 0, demandes: 0, messages: 1 }, 'Votre semaine : 1 message'],
    [{ reservations: 1, demandes: 0, messages: 1 }, 'Votre semaine : 1 réservation, 1 message'],
    [{ reservations: 0, demandes: 4, messages: 2 }, 'Votre semaine : 4 demandes, 2 messages'],
    [{ reservations: 12, demandes: 0, messages: 0 }, 'Votre semaine : 12 réservations'],
  ])('should omit the terms at zero in the subject for %j', (compteurs, attendu) => {
    expect(resume({}, compteurs).subject).toBe(attendu)
  })

  it('should describe the period from the first to the last LOCAL day, with « 1er » for the first of the month', () => {
    const corps = lignes(resume().text)

    expect(corps[0]).toBe('Bonjour Cabrel,')
    expect(corps).toContain("Voici l'activité de votre vitrine du lundi 26 octobre au dimanche 1er novembre :")
  })

  it('should list the counters as bullets', () => {
    const corps = lignes(resume().text)

    expect(corps).toContain('• Réservations reçues : 3')
    expect(corps).toContain('• Demandes reçues : 1')
    expect(corps).toContain('• Messages reçus : 2')
  })

  it('should never mention visits or link clicks while they are null (CA27, S11)', () => {
    const { text } = resume()

    expect(text).not.toMatch(/visites?/i)
    expect(text).not.toMatch(/clics sur vos liens/i)
  })

  it('should print the visit and click lines as soon as S11 supplies them', () => {
    const corps = lignes(resume({}, { visites: 128, clics: 14 }).text)

    expect(corps).toContain('• Visites : 128')
    expect(corps).toContain('• Clics sur vos liens : 14')
  })

  it('should announce the confirmed appointments of the coming week only when there are some', () => {
    expect(lignes(resume().text)).toContain('Cette semaine, 2 rendez-vous sont prévus.')
    expect(resume({}, { rendezVousSemaine: 0 }).text).not.toContain('Cette semaine')
  })

  it('should link the studio, sign off and give the reason, the one-click unsubscribe and the account page (§5.3)', () => {
    const message = resume()
    const corps = lignes(message.text)

    expect(corps).toContain(`Retrouvez tout dans votre studio : ${SITE}/studio`)
    expect(corps).toContain('Bonne semaine,')
    expect(corps).toContain('Brandself')
    expect(corps).toContain("Vous recevez ce résumé chaque lundi parce qu'il est activé dans votre compte.")
    expect(corps).toContain(`Vous désabonner en un clic : ${SITE}/desabonnement?jeton=${JETON}`)
    expect(corps).toContain(`Gérer vos e-mails : ${SITE}/studio/compte`)
    expectPied(message)
  })

  it('should carry the RFC 8058 headers (CA45) and be plain text only', () => {
    const message = resume()

    expect(message.headers?.['List-Unsubscribe']).toBe(`<${SITE}/api/public/desabonnement?jeton=${JETON}>`)
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expectTexteSeul(message)
  })

  it('should carry counters only: no name, e-mail, phone or reason of any visitor (#100)', () => {
    const message = resume({ visiteurs: [PII], reservations: [PII] })
    const tout = `${message.subject}\n${message.text}`

    for (const secret of Object.values(PII)) expect(tout).not.toContain(secret)
  })

  it('should neutralise line breaks in the first name (singleLine)', () => {
    const message = resume({ prenom: 'Cabrel\r\nBcc: pirate@exemple.test' })

    expect(lignes(message.text).some((ligne) => ligne.startsWith('Bcc:'))).toBe(false)
  })
})

describe('utilisateur_resume_hebdo sans activité (§5.4, CA28, CA29)', () => {
  it('should use the « idée » subject and a single suggestion with its title, text and link (CA28)', () => {
    const message = resume({}, SANS_ACTIVITE)
    const corps = lignes(message.text)

    expect(message.subject).toBe('Une idée pour votre vitrine cette semaine')
    expect(corps[0]).toBe('Bonjour Cabrel,')
    expect(corps).toContain("Votre vitrine n'a pas reçu de réservation ni de message cette semaine. Une seule idée pour la faire connaître :")
    expect(corps).toContain('Présentez une réalisation')
    expect(corps).toContain('Montrez un travail dont vous êtes fier.')
    expect(corps).toContain(`${SITE}/studio/realisations/nouveau`)
  })

  it('should carry exactly one suggestion: no counters, no other step title', () => {
    const { text } = resume({}, SANS_ACTIVITE)

    expect(text).not.toContain('• Réservations reçues')
    expect(text).not.toContain('Retrouvez tout dans votre studio')
    for (const etape of ['photo', 'service', 'disponibilites', 'partager'] as const) {
      expect(text).not.toContain(PROCHAINES_ETAPES[etape].titre)
    }
    expect(text).not.toContain(SUGGESTION_RESUME_DEFAUT.titre)
  })

  it('should send the studio home when the suggestion opens a panel instead of a page (partager)', () => {
    const message = resume({ suggestion: { ...PROCHAINES_ETAPES.partager } }, SANS_ACTIVITE)
    const corps = lignes(message.text)

    expect(corps).toContain('Partagez votre vitrine')
    expect(corps).toContain(`${SITE}/studio`)
    expect(message.text).not.toContain('null')
    expect(message.text).not.toContain('undefined')
  })

  it('should print the default suggestion with its own page when nothing is left to suggest (CA29)', () => {
    const message = resume({ suggestion: { ...SUGGESTION_RESUME_DEFAUT } }, SANS_ACTIVITE)
    const corps = lignes(message.text)

    expect(corps).toContain(SUGGESTION_RESUME_DEFAUT.titre)
    expect(corps).toContain(SUGGESTION_RESUME_DEFAUT.texte)
    expect(corps).toContain(`${SITE}${SUGGESTION_RESUME_DEFAUT.chemin}`)
  })

  it('should keep the footer, the headers and the plain text format', () => {
    const message = resume({}, SANS_ACTIVITE)

    expectPied(message)
    expect(message.text).toContain(`${SITE}/desabonnement?jeton=${JETON}`)
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expectTexteSeul(message)
  })

  it('should switch to the idea e-mail only when reservations, requests AND messages are all zero', () => {
    expect(resume({}, { ...SANS_ACTIVITE, demandes: 1 }).subject).toBe('Votre semaine : 1 demande')
    expect(resume({}, { ...SANS_ACTIVITE, messages: 1 }).subject).toBe('Votre semaine : 1 message')
    expect(resume({}, { ...SANS_ACTIVITE, reservations: 1 }).subject).toBe('Votre semaine : 1 réservation')
    expect(resume({}, { ...SANS_ACTIVITE, rendezVousSemaine: 5 }).subject).toBe('Une idée pour votre vitrine cette semaine')
  })
})

describe('contrat commun des trois nouveaux e-mails', () => {
  it.each([
    ['reservation_visiteur_rappel', () => rappel()],
    ['utilisateur_rappel_journee', () => journee()],
    ['utilisateur_resume_hebdo (activité)', () => resume()],
    ['utilisateur_resume_hebdo (sans activité)', () => resume({}, SANS_ACTIVITE)],
  ])('should end %s with the « Vous recevez… » sentence, in plain text, without attachment', (_type, construire) => {
    const message = construire()

    expectPied(message)
    expectTexteSeul(message)
  })

  it.each([
    ['utilisateur_rappel_journee', () => journee()],
    ['utilisateur_resume_hebdo', () => resume()],
  ])('should give %s a List-Unsubscribe URL that is HTTPS-only and token-bearing', (_type, construire) => {
    const entete = construire().headers?.['List-Unsubscribe'] ?? ''

    expect(entete).toMatch(/^<https:\/\/[^>]+\/api\/public\/desabonnement\?jeton=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+>$/)
  })

  it('should never leak the unsubscribe token into the subject', () => {
    for (const message of [journee(), resume(), resume({}, SANS_ACTIVITE)]) expect(message.subject).not.toContain('v1.')
  })
})
