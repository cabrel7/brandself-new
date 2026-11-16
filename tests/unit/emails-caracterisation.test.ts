import { describe, expect, it } from 'vitest'
import { buildTransactionalEmail } from '../../server/services/emails/contenus'
import type { TransactionalEmailContent } from '../../server/services/emails/contenus'
import { buildOtpEmail } from '../../server/services/emails/otp-contenu'
import type { EmailMessage } from '../../server/services/emails/transport'
import { TRANSACTIONAL_EMAIL_TYPES } from '../../shared/jobs'
import type { TransactionalEmailType } from '../../shared/jobs'
import { RAPPEL_JOURNEE_MAX_LIGNES } from '../../shared/notifications'

// ÉTAPE 0 (décision #26, e-mails HTML) : tests de CARACTÉRISATION. Ils figent le comportement ACTUEL (texte seul) des
// 14 e-mails (1 OTP + 13 types d'outbox) AVANT le refactor vers un gabarit HTML. Verts sur le code actuel ; après le
// refactor, `subject`, `text`, `to`, `headers` et les pièces jointes (nom + type) doivent rester identiques à l'octet.
// Les ajouts du lot 1 (`html`, `replyTo`) sont VOLONTAIREMENT hors snapshot : ils ne doivent pas le casser.
//
// Fixtures figées : dates fixes, fuseaux Africa/Douala (UTC+1) et Europe/Paris (UTC+2 en juillet). Les instants sont
// choisis à cheval sur minuit : le jour affiché diffère selon le fuseau (14 juillet à Douala, 15 à Paris).

const FUSEAUX = ['Africa/Douala', 'Europe/Paris'] as const
type Fuseau = (typeof FUSEAUX)[number]

const SITE = 'https://jesuis.pro'
const JETON = 'v1.eyJ1IjoiYSIsInAiOiJlbWFpbF9oZWJkbyIsImUiOjF9.c2lnbmF0dXJlLWRlLXRlc3QtMDEyMzQ1Njc4OTAxMjM0NQ'
const OUTBOX_ID = '11111111-1111-4111-8111-111111111111'
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222'
const DEMANDE_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const GENERE_LE = new Date('2026-07-10T06:00:00.000Z')
/** 23 h 30 à Douala le 14 juillet, 00 h 30 à Paris le 15 juillet. */
const DEBUT = new Date('2026-07-14T22:30:00.000Z')
const FIN = new Date('2026-07-14T23:15:00.000Z')
/** Dernier instant payé : minuit local exclusif à Douala (1er août 00:00), 01:00 le 1er août à Paris. */
const EXPIRE_LE = new Date('2026-07-31T23:00:00.000Z')
const NBSP = ' '
const NNBSP = ' '
const NBSP_VISIBLE = '<NBSP>'
const NNBSP_VISIBLE = '<NNBSP>'
const AUCUN = '(aucun)'
const SEPARATEUR_CAS = '=========='

const VISITEUR = {
  nom: 'Marie Ndzi',
  email: 'marie.ndzi@exemple.test',
  telephone: '+237699000011',
  // Caractères HTML volontaires : le texte ne doit PAS être échappé (l'échappement est l'affaire du rendu HTML).
  motif: 'Douleur <thoracique> & "fatigue"',
}

const SERVICE_PAYANT = {
  titre: 'Consultation de cardiologie',
  dureeMin: 45,
  tarif: 'payant',
  prixMontant: 15_000,
  prixDevise: 'XAF',
  paiementInstructions: 'Orange Money au 699 00 00 11',
}

interface Cas {
  label: string
  contenu: TransactionalEmailContent
}

type ReservationType = Extract<TransactionalEmailType, 'reservation_professionnel_nouvelle' | 'reservation_visiteur_recue' | 'reservation_visiteur_confirmee' | 'reservation_visiteur_annulee' | 'reservation_visiteur_refusee'>
type DemandeType = Extract<TransactionalEmailType, 'demande_professionnel_nouvelle' | 'demande_visiteur_recue'>

function vitrine(fuseau: Fuseau, ville: string | null = 'Douala') {
  return {
    username: 'dr-cabrel',
    palette: 'terracotta' as const,
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    metier: 'Cardiologue',
    ville,
    fuseau,
  }
}

function base(fuseau: Fuseau, ville: string | null = 'Douala') {
  return {
    outboxId: OUTBOX_ID,
    generatedAt: GENERE_LE,
    professionnelEmail: 'cabrel.pro@exemple.test',
    vitrine: vitrine(fuseau, ville),
    visiteur: VISITEUR,
    siteUrl: SITE,
  }
}

type Service = typeof SERVICE_PAYANT

/** Variantes du récapitulatif de service : durée absente, ville absente, tarifs gratuit / devis / devise mineure / prix absent. */
function variantesService(fuseau: Fuseau): Array<{ label: string, service: Service, ville: string | null, paiementChoisi: string }> {
  return [
    { label: 'payant XAF sur place avec instructions', service: SERVICE_PAYANT, ville: 'Douala', paiementChoisi: 'sur_place' },
    { label: 'gratuit sans durée ni ville', service: { ...SERVICE_PAYANT, tarif: 'gratuit', dureeMin: null, paiementInstructions: null }, ville: null, paiementChoisi: 'aucun' },
    { label: 'sur devis, durée 90 min', service: { ...SERVICE_PAYANT, tarif: 'devis', dureeMin: 90, paiementInstructions: null }, ville: 'Paris', paiementChoisi: 'aucun' },
    { label: 'payant USD en centimes', service: { ...SERVICE_PAYANT, prixMontant: 2_550, prixDevise: 'USD', dureeMin: 60, paiementInstructions: null }, ville: fuseau === 'Europe/Paris' ? 'Paris' : 'Douala', paiementChoisi: 'en_ligne' },
    { label: 'payant sans montant', service: { ...SERVICE_PAYANT, prixMontant: null, prixDevise: null, paiementInstructions: null }, ville: 'Douala', paiementChoisi: 'en_ligne' },
  ]
}

function casReservation(type: ReservationType, fuseau: Fuseau): Cas[] {
  return variantesService(fuseau).map(({ label, service, ville, paiementChoisi }) => ({
    label,
    contenu: {
      ...base(fuseau, ville),
      type,
      service,
      reservation: { id: RESERVATION_ID, debut: DEBUT, fin: FIN, paiementChoisi },
    },
  }))
}

function casDemande(type: DemandeType, fuseau: Fuseau): Cas[] {
  return variantesService(fuseau).map(({ label, service, ville }) => ({
    label,
    contenu: { ...base(fuseau, ville), type, service, demande: { id: DEMANDE_ID } },
  }))
}

function casMessage(fuseau: Fuseau): Cas[] {
  const message = {
    id: MESSAGE_ID,
    nom: VISITEUR.nom,
    email: VISITEUR.email,
    telephone: VISITEUR.telephone,
    sujet: 'question_avant_reservation' as const,
    texte: 'Bonjour,\nJe voudrais savoir si vous consultez le samedi <b>matin</b> ?\n\nMerci & à bientôt.',
  }
  return [
    { label: 'avec téléphone', contenu: { ...base(fuseau), type: 'message_professionnel_nouvelle', message } },
    { label: 'sans téléphone, autre sujet', contenu: { ...base(fuseau), type: 'message_professionnel_nouvelle', message: { ...message, telephone: null, sujet: 'autre' } } },
  ]
}

function casRappelVisiteur(fuseau: Fuseau): Cas[] {
  return variantesService(fuseau).map(({ label, service, ville, paiementChoisi }) => ({
    label,
    contenu: {
      ...base(fuseau),
      type: 'reservation_visiteur_rappel',
      vitrine: { ...vitrine(fuseau, ville), username: 'dr-cabrel' },
      service,
      reservation: { id: RESERVATION_ID, debut: DEBUT, fin: FIN, paiementChoisi },
      siteUrl: SITE,
    },
  }))
}

function baseUtilisateur(fuseau: Fuseau, prenom = 'Cabrel') {
  return {
    outboxId: OUTBOX_ID,
    generatedAt: GENERE_LE,
    destinataire: 'cabrel.pro@exemple.test',
    prenom,
    fuseau,
    siteUrl: SITE,
    jetonDesabonnement: JETON,
  }
}

function rendezVousSerie(n: number): Array<{ debut: Date, service: string, visiteur: string, statut: string }> {
  return Array.from({ length: n }, (_, index) => ({
    // Heures croissantes à partir de 08:00 UTC le 14 juillet, une par 10 minutes.
    debut: new Date(Date.UTC(2026, 6, 14, 8, index * 10)),
    service: `Consultation ${index + 1}`,
    visiteur: `Visiteur ${index + 1}`,
    statut: index % 2 === 0 ? 'confirmee' : 'en_attente',
  }))
}

function casRappelJournee(fuseau: Fuseau): Cas[] {
  const desordre = [
    { debut: new Date('2026-07-14T13:00:00.000Z'), service: 'Suivi', visiteur: 'Paul Ewane', statut: 'confirmee' },
    { debut: new Date('2026-07-14T08:30:00.000Z'), service: 'Première consultation', visiteur: 'Marie Ndzi', statut: 'en_attente' },
    { debut: new Date('2026-07-14T10:00:00.000Z'), service: 'Bilan', visiteur: 'Alice Bella', statut: 'confirmee' },
  ]
  return [
    { label: 'un rendez-vous', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_rappel_journee', jour: DEBUT, rendezVous: [desordre[0]!] } },
    { label: 'trois rendez-vous dans le désordre, dont un à confirmer', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_rappel_journee', jour: DEBUT, rendezVous: desordre } },
    { label: 'sans prénom', contenu: { ...baseUtilisateur(fuseau, ''), type: 'utilisateur_rappel_journee', jour: DEBUT, rendezVous: desordre } },
    { label: `${RAPPEL_JOURNEE_MAX_LIGNES + 2} rendez-vous (surplus)`, contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_rappel_journee', jour: DEBUT, rendezVous: rendezVousSerie(RAPPEL_JOURNEE_MAX_LIGNES + 2) } },
    { label: `${RAPPEL_JOURNEE_MAX_LIGNES + 1} rendez-vous (surplus d'un seul)`, contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_rappel_journee', jour: DEBUT, rendezVous: rendezVousSerie(RAPPEL_JOURNEE_MAX_LIGNES + 1) } },
  ]
}

function casResume(fuseau: Fuseau): Cas[] {
  const periode = { debut: new Date('2026-07-05T22:00:00.000Z'), fin: new Date('2026-07-12T22:00:00.000Z') }
  const suggestion = { titre: 'Ajoutez une réalisation', texte: 'Montrez un travail récent à vos visiteurs.', chemin: '/studio/realisations' }
  const compteurs = { reservations: 3, demandes: 1, messages: 2, rendezVousSemaine: 4, visites: 120, clics: 18 }
  return [
    { label: 'activité complète', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_resume_hebdo', periode, compteurs, suggestion } },
    { label: 'une réservation, un rendez-vous, sans suivi (visites et clics absents)', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_resume_hebdo', periode, compteurs: { reservations: 1, demandes: 0, messages: 0, rendezVousSemaine: 1, visites: null, clics: null }, suggestion } },
    { label: 'activité sans rendez-vous', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_resume_hebdo', periode, compteurs: { ...compteurs, rendezVousSemaine: 0, demandes: 0, messages: 0, reservations: 2 }, suggestion } },
    { label: 'aucune activité, suggestion avec chemin', contenu: { ...baseUtilisateur(fuseau), type: 'utilisateur_resume_hebdo', periode, compteurs: { reservations: 0, demandes: 0, messages: 0, rendezVousSemaine: 0, visites: 10, clics: 0 }, suggestion } },
    { label: 'aucune activité, suggestion sans chemin, sans prénom', contenu: { ...baseUtilisateur(fuseau, ''), type: 'utilisateur_resume_hebdo', periode, compteurs: { reservations: 0, demandes: 0, messages: 0, rendezVousSemaine: 0, visites: null, clics: null }, suggestion: { ...suggestion, chemin: null } } },
  ]
}

function baseAbonnement(fuseau: Fuseau, prenom = 'Cabrel') {
  return {
    outboxId: OUTBOX_ID,
    generatedAt: GENERE_LE,
    destinataire: 'cabrel.pro@exemple.test',
    prenom,
    fuseau,
    siteUrl: SITE,
  }
}

function casAbonnementRappel(fuseau: Fuseau): Cas[] {
  return [
    { label: 'J-7, période 3 mois', contenu: { ...baseAbonnement(fuseau), type: 'abonnement_rappel', jours: 7, expireLe: EXPIRE_LE, periodeMois: 3 } },
    { label: 'J-3, période 1 mois', contenu: { ...baseAbonnement(fuseau), type: 'abonnement_rappel', jours: 3, expireLe: EXPIRE_LE, periodeMois: 1 } },
    { label: 'J0, période 12 mois, sans prénom', contenu: { ...baseAbonnement(fuseau, ''), type: 'abonnement_rappel', jours: 0, expireLe: EXPIRE_LE, periodeMois: 12 } },
  ]
}

function casPaiementConfirme(fuseau: Fuseau): Cas[] {
  const complet = {
    ...baseAbonnement(fuseau),
    type: 'paiement_confirme' as const,
    reference: '55555555-5555-4555-8555-555555555555',
    referenceFournisseur: 'KPAY-REF-001',
    montant: 4_800_000,
    devise: 'XAF',
    periodeMois: 3,
    moyenLibelle: 'MTN MoMo',
    telephoneMasque: '+237 6•• ••• •89',
    nouvelleEcheance: EXPIRE_LE,
  }
  return [
    { label: 'reçu complet', contenu: complet },
    { label: 'reçu minimal (moyen, numéro, référence opérateur et échéance absents)', contenu: { ...complet, referenceFournisseur: null, moyenLibelle: null, telephoneMasque: null, nouvelleEcheance: null } },
    { label: 'devise USD (centimes)', contenu: { ...complet, devise: 'USD', montant: 2_550, periodeMois: 1 } },
    { label: 'devise inconnue (exposant 2 par défaut, code ISO affiché)', contenu: { ...complet, devise: 'CHF', montant: 123_456, periodeMois: 12 } },
  ]
}

function casAdminCompte(type: 'utilisateur_suspendu' | 'utilisateur_depubliee', fuseau: Fuseau): Cas[] {
  return [
    { label: 'avec prénom et motif', contenu: { ...baseAbonnement(fuseau), type, motif: 'Contenu signalé par plusieurs visiteurs.' } },
    { label: 'sans prénom', contenu: { ...baseAbonnement(fuseau, ''), type, motif: 'Usurpation d’identité signalée.' } },
  ]
}

function casJoursOfferts(fuseau: Fuseau): Cas[] {
  return [
    { label: '7 jours offerts', contenu: { ...baseAbonnement(fuseau), type: 'utilisateur_jours_offerts', jours: 7, expireLe: EXPIRE_LE } },
    { label: '1 jour offert, sans prénom', contenu: { ...baseAbonnement(fuseau, ''), type: 'utilisateur_jours_offerts', jours: 1, expireLe: EXPIRE_LE } },
  ]
}

function casReactivation(fuseau: Fuseau): Cas[] {
  return [
    { label: 'avec prénom', contenu: { ...baseAbonnement(fuseau), type: 'utilisateur_reactive' } },
    { label: 'sans prénom', contenu: { ...baseAbonnement(fuseau, ''), type: 'utilisateur_reactive' } },
  ]
}

const CAS_PAR_TYPE: Record<TransactionalEmailType, (fuseau: Fuseau) => Cas[]> = {
  reservation_visiteur_recue: (f) => casReservation('reservation_visiteur_recue', f),
  reservation_visiteur_confirmee: (f) => casReservation('reservation_visiteur_confirmee', f),
  reservation_visiteur_annulee: (f) => casReservation('reservation_visiteur_annulee', f),
  reservation_visiteur_refusee: (f) => casReservation('reservation_visiteur_refusee', f),
  reservation_professionnel_nouvelle: (f) => casReservation('reservation_professionnel_nouvelle', f),
  demande_professionnel_nouvelle: (f) => casDemande('demande_professionnel_nouvelle', f),
  demande_visiteur_recue: (f) => casDemande('demande_visiteur_recue', f),
  message_professionnel_nouvelle: casMessage,
  reservation_visiteur_rappel: casRappelVisiteur,
  utilisateur_rappel_journee: casRappelJournee,
  utilisateur_resume_hebdo: casResume,
  abonnement_rappel: casAbonnementRappel,
  paiement_confirme: casPaiementConfirme,
  // A2 : e-mails d'administration.
  utilisateur_suspendu: (f) => casAdminCompte('utilisateur_suspendu', f),
  utilisateur_depubliee: (f) => casAdminCompte('utilisateur_depubliee', f),
  utilisateur_jours_offerts: casJoursOfferts,
  utilisateur_reactive: casReactivation,
}

/** Rend visibles les espaces insécables d'Intl (sinon invisibles dans un diff) ; l'échappement est réversible. */
function rendreVisible(texte: string): string {
  return texte.replaceAll(NBSP, NBSP_VISIBLE).replaceAll(NNBSP, NNBSP_VISIBLE)
}

/** Forme figée d'un message : destinataire, objet, en-têtes, pièces jointes (nom + type), texte. Ni `html` ni `replyTo`. */
function decrire(message: EmailMessage): string {
  const entetes = Object.entries(message.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return rendreVisible([
    `to: ${message.to}`,
    `subject: ${message.subject}`,
    'headers:',
    ...(entetes.length === 0 ? [`  ${AUCUN}`] : entetes.map(([nom, valeur]) => `  ${nom}: ${valeur}`)),
    'attachments:',
    ...(message.attachments.length === 0
      ? [`  ${AUCUN}`]
      : message.attachments.map((piece) => `  ${piece.filename} | ${piece.contentType}`)),
    '--- text ---',
    message.text,
  ].join('\n'))
}

function decrireType(type: TransactionalEmailType): string {
  const sections = FUSEAUX.flatMap((fuseau) =>
    CAS_PAR_TYPE[type](fuseau).map((cas) => [
      SEPARATEUR_CAS,
      `type: ${type} | cas: ${cas.label} | fuseau: ${fuseau}`,
      SEPARATEUR_CAS,
      decrire(buildTransactionalEmail(cas.contenu)),
      '',
    ].join('\n')))
  return sections.join('\n')
}

describe('e-mails : caractérisation du contenu actuel (texte seul)', () => {
  it('should cover every transactional type declared by the outbox', () => {
    expect(Object.keys(CAS_PAR_TYPE).sort()).toEqual([...TRANSACTIONAL_EMAIL_TYPES].sort())
  })

  it.each(TRANSACTIONAL_EMAIL_TYPES)('should keep the exact current message when building %s', async (type) => {
    const instantane = decrireType(type)

    await expect(instantane).toMatchFileSnapshot(`./__snapshots__/emails/${type}.txt`)
  })

  it('should keep the exact current OTP message (subject, text, recipient, no header, no attachment)', async () => {
    const message = buildOtpEmail({ destinataire: 'visiteur@exemple.test', code: '123456', dureeMinutes: 10, siteUrl: SITE })

    await expect(decrire(message)).toMatchFileSnapshot('./__snapshots__/emails/otp_connexion.txt')
  })
})

describe('e-mails : invariants du texte actuel (hors snapshot)', () => {
  it('should send the OTP text exactly as the historical template of envoi.ts', () => {
    const message = buildOtpEmail({ destinataire: 'a@exemple.test', code: '654321', dureeMinutes: 10, siteUrl: SITE })

    expect(message.subject).toBe('Votre code de connexion jesuis.pro')
    expect(message.text).toBe(
      "Bonjour,\n\nVotre code de connexion : 654321\n\nIl est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nÀ tout de suite,\njesuis.pro",
    )
    expect(message.attachments).toEqual([])
    expect(message.headers).toBeUndefined()
  })

  it('should not HTML-escape visitor-provided text (the text part is plain text)', () => {
    const [cas] = casMessage('Africa/Douala')

    const message = buildTransactionalEmail(cas!.contenu)

    expect(message.text).toContain('<b>matin</b>')
    expect(message.text).toContain('Merci & à bientôt.')
    expect(message.text).not.toContain('&amp;')
    expect(message.text).not.toContain('&lt;')
  })

  it('should keep the multi-line visitor message verbatim in the text', () => {
    const [cas] = casMessage('Africa/Douala')

    const message = buildTransactionalEmail(cas!.contenu)

    expect(message.text).toContain('Bonjour,\nJe voudrais savoir si vous consultez le samedi <b>matin</b> ?\n\nMerci & à bientôt.')
  })

  it('should flatten line breaks and control characters of a visitor name in the subject (header injection)', () => {
    const contenu: TransactionalEmailContent = {
      ...base('Africa/Douala'),
      type: 'message_professionnel_nouvelle',
      message: {
        id: MESSAGE_ID,
        nom: 'Marie\r\nBcc: pirate@exemple.test\u0000 Ndzi',
        email: VISITEUR.email,
        telephone: null,
        sujet: 'autre',
        texte: 'Bonjour',
      },
    }

    const message = buildTransactionalEmail(contenu)

    expect(message.subject).not.toMatch(/[\r\n]/)
    expect(message.subject.includes(String.fromCharCode(0))).toBe(false)
    // Comportement actuel de `singleLine` : chaque suite de contrôles devient UNE espace, sans fusionner avec l'espace voisine.
    expect(message.subject).toBe('Nouveau message de Marie Bcc: pirate@exemple.test  Ndzi — Autre')
  })

  it('should attach one ICS per visitor reservation e-mail, with the right method per status', () => {
    const attendus: Array<[ReservationType, string]> = [
      ['reservation_visiteur_recue', 'text/calendar; charset=utf-8; method=REQUEST'],
      ['reservation_visiteur_confirmee', 'text/calendar; charset=utf-8; method=REQUEST'],
      ['reservation_visiteur_annulee', 'text/calendar; charset=utf-8; method=CANCEL'],
      ['reservation_visiteur_refusee', 'text/calendar; charset=utf-8; method=CANCEL'],
    ]

    for (const [type, contentType] of attendus) {
      const [cas] = casReservation(type, 'Africa/Douala')
      const message = buildTransactionalEmail(cas!.contenu)
      expect(message.attachments.map((piece) => [piece.filename, piece.contentType])).toEqual([['reservation.ics', contentType]])
    }
  })

  it('should send professional-facing e-mails without any attachment or header', () => {
    for (const type of ['reservation_professionnel_nouvelle', 'demande_professionnel_nouvelle'] as const) {
      const [cas] = type === 'reservation_professionnel_nouvelle' ? casReservation(type, 'Africa/Douala') : casDemande(type, 'Africa/Douala')
      const message = buildTransactionalEmail(cas!.contenu)
      expect(message.attachments).toEqual([])
      expect(message.headers).toBeUndefined()
    }
  })

  it('should carry List-Unsubscribe headers only on the two scheduled user e-mails', () => {
    for (const type of TRANSACTIONAL_EMAIL_TYPES) {
      const [cas] = CAS_PAR_TYPE[type]('Africa/Douala')
      const message = buildTransactionalEmail(cas!.contenu)
      const avec = type === 'utilisateur_rappel_journee' || type === 'utilisateur_resume_hebdo'
      expect(Object.keys(message.headers ?? {}).includes('List-Unsubscribe'), type).toBe(avec)
    }
  })

  it('should show a different local day in Douala and Paris for an instant close to midnight', () => {
    const [douala] = casRappelVisiteur('Africa/Douala')
    const [paris] = casRappelVisiteur('Europe/Paris')

    expect(buildTransactionalEmail(douala!.contenu).subject).toBe('Rappel : votre rendez-vous du mardi 14 juillet à 23:30')
    expect(buildTransactionalEmail(paris!.contenu).subject).toBe('Rappel : votre rendez-vous du mercredi 15 juillet à 00:30')
  })

  it('should write the last paid day inclusive (1er août in Paris, 31 juillet in Douala for the same instant)', () => {
    const [douala] = casAbonnementRappel('Africa/Douala')
    const [paris] = casAbonnementRappel('Europe/Paris')

    expect(buildTransactionalEmail(douala!.contenu).text).toContain("jusqu'au 31 juillet 2026 inclus")
    expect(buildTransactionalEmail(paris!.contenu).text).toContain("jusqu'au 1er août 2026 inclus")
  })

  it('should list at most RAPPEL_JOURNEE_MAX_LIGNES appointments and name the surplus', () => {
    const surplus = casRappelJournee('Africa/Douala').find((cas) => cas.label.includes('surplus'))!

    const text = buildTransactionalEmail(surplus.contenu).text

    expect(text.split('\n').filter((ligne) => ligne.startsWith('• '))).toHaveLength(RAPPEL_JOURNEE_MAX_LIGNES)
    expect(text).toContain('… et 2 autres.')
  })

  it('should never contain a non-breaking space in an amount of the payment receipt (replaced by a simple space)', () => {
    const [recu] = casPaiementConfirme('Africa/Douala')

    const { text } = buildTransactionalEmail(recu!.contenu)

    expect(text).toContain('Montant : 4 800 000 FCFA')
    expect(text).not.toMatch(/[\u00A0\u202F]/)
  })

  it('should refuse a malformed unsubscribe token for user e-mails (no e-mail without a valid opt-out)', () => {
    const [cas] = casRappelJournee('Africa/Douala')
    const invalide = { ...cas!.contenu, jetonDesabonnement: 'pas un jeton valide !' } as TransactionalEmailContent

    expect(() => buildTransactionalEmail(invalide)).toThrow('JETON_DESABONNEMENT_INVALIDE')
  })
})
