import { createHmac, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clesEssai, empreinteEssai, instantRelance } from '../../server/services/essai'
import { buildTransactionalEmail } from '../../server/services/emails/contenus'
import type { TransactionalEmailContent } from '../../server/services/emails/contenus'
import { buildAbonnementRappelEmail, buildEssaiRelanceEmail } from '../../server/services/emails/notifications-contenus'
import type { AbonnementRappelContent, EssaiRelanceContent } from '../../server/services/emails/notifications-contenus'
import { evaluerPertinence } from '../../server/services/notifications/pertinence'
import type { EntreeEssaiRelance } from '../../server/services/notifications/pertinence'
import { rappelDu } from '../../server/services/notifications/abonnements'
import { resoudrePlanEffectif } from '../../server/services/plans'
import { MESSAGE_APRES_ESSAI, MESSAGE_JOURS_ESSAI_CONSERVES, mentionEssaiPublic, messageEssaiAccorde, phraseRappelsEssai, titreEssaiEnCours } from '../../app/utils/essai'
import { TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import {
  ESSAI_DEFAUT,
  ESSAI_DUREE_MAX_JOURS,
  ESSAI_DUREE_MIN_JOURS,
  ESSAI_EMPREINTE_FORMAT,
  ESSAI_EMPREINTE_HKDF_INFO,
  ESSAI_EMAIL_TYPES,
  ESSAI_OCCURRENCE_PREFIXE,
  ESSAI_RAPPELS_JOURS,
} from '../../shared/essai'
import { ABONNEMENT_RAPPELS_JOURS } from '../../shared/plans'
import { schemaCreerVersionEssai, schemaValeursEssai } from '../../shared/schemas/admin-versions'

// E1 (docs/specs/E1-essai-gratuit.md) : règles PURES de l'essai gratuit. Aucune base, aucun service externe.
// CA-E1-11 (valeurs de configuration), CA-E1-17 (relances à l'envoi), CA-E1-20 (rappel « essai »), CA-E1-21 (quatre textes),
// CA-E1-30 (empreinte), plus les règles pures de D9 (aucune grâce, J-7 supprimé) et D8 (9 h locale du compte).

const SECRET_A = 'secret-a-de-test-empreinte-essai-0123456789'
const SECRET_B = 'secret-b-de-test-empreinte-essai-9876543210'
const SITE = 'https://jesuis.pro'
const JETON = 'v1.eyJ1IjoiYSIsInAiOiJlbWFpbF9oZWJkbyIsImUiOjF9.c2lnbmF0dXJlLWRlLXRlc3QtMDEyMzQ1Njc4OTAxMjM0NQ'
const OUTBOX_ID = '11111111-1111-4111-8111-111111111111'
const GENERE_LE = new Date('2026-11-23T10:00:00.000Z')
/** Fin EXCLUSIVE d'un essai : le dernier instant payé est le 7 décembre 2026 à 10 h 59 (Douala). */
const FIN_ESSAI = new Date('2026-12-07T10:00:00.000Z')
const MOTIF_ADMIN = 'Revue de la durée de l’essai après les premières inscriptions'
const MOTS_INTERDITS = /\b(espaces?|blocs?|modules?|widgets?|sections?)\b/i
const TUTOIEMENT = /\b(tu|toi|ton|ta|tes|t')\b/i

/** Les apostrophes typographiques de l'application (’) valent l'apostrophe droite. */
function normaliser(texte: string): string {
  return texte.replaceAll('’', "'")
}

/** Texte lisible d'un e-mail HTML : balises retirées, entités courantes décodées. */
function texteDuHtml(html: string): string {
  return html
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&rsquo;', "'")
    .replaceAll(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------------------------
// CA-E1-11 : valeurs de configuration
// ---------------------------------------------------------------------------------------------

describe('schemaValeursEssai (CA-E1-11)', () => {
  const valide = { actif: true, dureeJours: 14, relanceServicesJour: 2, relanceStatistiquesJour: 7 }

  it('should accept the values of the seeded version 1 and the code fallback, which are the same', () => {
    expect(schemaValeursEssai.safeParse(valide).success).toBe(true)
    expect(schemaValeursEssai.parse(ESSAI_DEFAUT)).toEqual(valide)
  })

  it('should accept a switched-off version and the extreme valid shapes (3 days minimum, 90 days maximum)', () => {
    expect(schemaValeursEssai.safeParse({ ...valide, actif: false }).success).toBe(true)
    expect(schemaValeursEssai.safeParse({ actif: true, dureeJours: 3, relanceServicesJour: 1, relanceStatistiquesJour: 2 }).success).toBe(true)
    expect(schemaValeursEssai.safeParse({ actif: true, dureeJours: ESSAI_DUREE_MAX_JOURS, relanceServicesJour: 1, relanceStatistiquesJour: ESSAI_DUREE_MAX_JOURS - 1 }).success).toBe(true)
  })

  it.each([
    ['a duration of 0', { dureeJours: 0 }],
    ['a negative duration', { dureeJours: -14 }],
    ['a duration of 91', { dureeJours: 91 }],
    ['a fractional duration', { dureeJours: 14.5 }],
    ['a duration as text', { dureeJours: '14' }],
    ['a null duration', { dureeJours: null }],
    ['a statistics day equal to the duration', { relanceStatistiquesJour: 14 }],
    ['a statistics day after the end of the trial', { relanceStatistiquesJour: 20 }],
    ['a statistics day equal to the services day', { relanceStatistiquesJour: 2 }],
    ['a statistics day before the services day', { relanceServicesJour: 8 }],
    ['a services day of 0', { relanceServicesJour: 0 }],
    ['a negative services day', { relanceServicesJour: -1 }],
    ['a fractional services day', { relanceServicesJour: 1.5 }],
    ['a non-boolean flag', { actif: 'oui' }],
    ['a missing flag', { actif: undefined }],
  ])('should refuse %s', (_libelle, surcharge) => {
    expect(schemaValeursEssai.safeParse({ ...valide, ...surcharge }).success).toBe(false)
  })

  it('should refuse a duration too short to hold both reminders (2 days: 1 < statistics < 2 is impossible)', () => {
    expect(schemaValeursEssai.safeParse({ actif: true, dureeJours: 2, relanceServicesJour: 1, relanceStatistiquesJour: 1 }).success).toBe(false)
    expect(schemaValeursEssai.safeParse({ actif: true, dureeJours: 1, relanceServicesJour: 1, relanceStatistiquesJour: 1 }).success).toBe(false)
  })

  it('should hold the real minimum duration of 3 days (1 < 2 < 3) and name it in the message', () => {
    const resultat = schemaValeursEssai.safeParse({ actif: true, dureeJours: 2, relanceServicesJour: 1, relanceStatistiquesJour: 2 })

    expect(ESSAI_DUREE_MIN_JOURS).toBe(3)
    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues.map((i) => i.message).join(' ')).toContain('au moins 3 jours')
  })

  it('should refuse an unknown key and a missing key (strict, nothing mass-assigned)', () => {
    expect(schemaValeursEssai.safeParse({ ...valide, prix: 0 }).success).toBe(false)
    expect(schemaValeursEssai.safeParse({ ...valide, cle: 'inscription' }).success).toBe(false)
    const { dureeJours: _duree, ...sansDuree } = valide
    expect(schemaValeursEssai.safeParse(sansDuree).success).toBe(false)
    expect(schemaValeursEssai.safeParse({}).success).toBe(false)
    expect(schemaValeursEssai.safeParse(null).success).toBe(false)
    expect(schemaValeursEssai.safeParse([]).success).toBe(false)
  })

  it('should report the failing field of the ordering rule, so that the administration form can show it', () => {
    const resultat = schemaValeursEssai.safeParse({ ...valide, relanceStatistiquesJour: 14 })

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues.map((i) => i.path.join('.'))).toContain('relanceStatistiquesJour')
  })
})

describe('schemaCreerVersionEssai (POST /api/admin/versions/essai)', () => {
  const valeurs = { actif: true, dureeJours: 30, relanceServicesJour: 3, relanceStatistiquesJour: 10 }

  it('should accept the only key `inscription` with valid values and a motive', () => {
    expect(schemaCreerVersionEssai.safeParse({ cle: 'inscription', valeurs, motif: MOTIF_ADMIN }).success).toBe(true)
  })

  it('should refuse any other key (the CHECK of the migration only knows `inscription`), a missing motive and extra keys', () => {
    expect(schemaCreerVersionEssai.safeParse({ cle: 'autre', valeurs, motif: MOTIF_ADMIN }).success).toBe(false)
    expect(schemaCreerVersionEssai.safeParse({ cle: 'Inscription', valeurs, motif: MOTIF_ADMIN }).success).toBe(false)
    expect(schemaCreerVersionEssai.safeParse({ cle: 'inscription', valeurs }).success).toBe(false)
    expect(schemaCreerVersionEssai.safeParse({ cle: 'inscription', valeurs, motif: MOTIF_ADMIN, effectiveA: '2026-12-01T00:00:00Z' }).success).toBe(false)
    expect(schemaCreerVersionEssai.safeParse({ cle: 'inscription', valeurs: { ...valeurs, dureeJours: 0 }, motif: MOTIF_ADMIN }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// CA-E1-30 : empreinte « un essai par personne »
// ---------------------------------------------------------------------------------------------

describe('empreinteEssai (CA-E1-30)', () => {
  it('should be a HMAC-SHA256 in lowercase hexadecimal: 64 characters, no clear data inside', () => {
    const empreinte = empreinteEssai('email', 'marie.dupont@exemple.test', SECRET_A)

    expect(empreinte).toMatch(ESSAI_EMPREINTE_FORMAT)
    expect(empreinte).not.toContain('marie')
    expect(empreinte).not.toContain('exemple')
  })

  it('should ignore case and surrounding spaces of an e-mail address', () => {
    const reference = empreinteEssai('email', 'marie.dupont@exemple.test', SECRET_A)

    expect(empreinteEssai('email', 'Marie.Dupont@Exemple.TEST', SECRET_A)).toBe(reference)
    expect(empreinteEssai('email', '  marie.dupont@exemple.test  ', SECRET_A)).toBe(reference)
    expect(empreinteEssai('email', '\tMARIE.DUPONT@EXEMPLE.TEST\n', SECRET_A)).toBe(reference)
  })

  it('should keep one key per phone number whatever its formatting (digits only)', () => {
    const reference = empreinteEssai('telephone', '237612345678', SECRET_A)

    expect(empreinteEssai('telephone', '+237 6 12 34 56 78', SECRET_A)).toBe(reference)
    expect(empreinteEssai('telephone', '+237612345678', SECRET_A)).toBe(reference)
    expect(empreinteEssai('telephone', '(237) 612-345-678', SECRET_A)).toBe(reference)
    expect(empreinteEssai('telephone', '237612345679', SECRET_A)).not.toBe(reference)
  })

  it('should fold the `+tag` of the local part for EVERY domain (anti-abuse: `marie+2@…` is the same person)', () => {
    const base = empreinteEssai('email', 'marie@exemple.test', SECRET_A)

    expect(empreinteEssai('email', 'marie+essai@exemple.test', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'Marie+A+B@Exemple.Test', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'marie+@exemple.test', SECRET_A)).toBe(base)
  })

  it('should keep the dots of a non-Gmail address: `ma.rie@` and `marie@` are two mailboxes elsewhere', () => {
    expect(empreinteEssai('email', 'ma.rie@exemple.test', SECRET_A)).not.toBe(empreinteEssai('email', 'marie@exemple.test', SECRET_A))
  })

  it('should fold the dots, the `+tag` and `googlemail.com` of a Gmail address into one key', () => {
    const base = empreinteEssai('email', 'marie.dupont@gmail.com', SECRET_A)

    expect(empreinteEssai('email', 'mariedupont@gmail.com', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'm.a.r.i.e.d.u.p.o.n.t@gmail.com', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'marie.dupont+essai@gmail.com', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'Marie.Dupont@GoogleMail.com', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'm.arie.dupont+x@googlemail.com', SECRET_A)).toBe(base)
    expect(empreinteEssai('email', 'mariedupont2@gmail.com', SECRET_A)).not.toBe(base)
  })

  it('should not fold a look-alike domain into Gmail (`notgmail.com`, `gmail.com.evil.test`)', () => {
    const base = empreinteEssai('email', 'marie@gmail.com', SECRET_A)

    expect(empreinteEssai('email', 'm.arie@notgmail.com', SECRET_A)).not.toBe(base)
    expect(empreinteEssai('email', 'marie@gmail.com.evil.test', SECRET_A)).not.toBe(base)
  })

  it('should give a one-key account the same fingerprint through `clesEssai` whatever the alias (idempotent normalisation)', () => {
    const compte = (email: string) => ({ email, phoneNumber: null, phoneNumberVerified: false })

    expect(clesEssai(compte('M.Arie+x@googlemail.com'), SECRET_A)).toEqual(clesEssai(compte('marie@gmail.com'), SECRET_A))
  })

  it('should give two different fingerprints for two different secrets, and the same one for the same secret', () => {
    const a = empreinteEssai('email', 'marie@exemple.test', SECRET_A)
    const b = empreinteEssai('email', 'marie@exemple.test', SECRET_B)

    expect(a).not.toBe(b)
    expect(empreinteEssai('email', 'marie@exemple.test', SECRET_A)).toBe(a)
  })

  it('should never mix the two natures: the e-mail `123` and the phone `123` are different keys', () => {
    expect(empreinteEssai('email', '123', SECRET_A)).not.toBe(empreinteEssai('telephone', '123', SECRET_A))
  })

  it('should stay compatible with the fingerprints already stored (HKDF-SHA256 key, HMAC-SHA256 of `<nature>:<normalised value>`)', () => {
    // Un changement ici rouvrirait TOUS les essais déjà consommés (D4 : `ESSAI_EMPREINTE_HKDF_INFO` ne se renomme jamais).
    const cle = Buffer.from(hkdfSync('sha256', SECRET_A, '', ESSAI_EMPREINTE_HKDF_INFO, 32))
    const attendu = createHmac('sha256', cle).update('email:marie@exemple.test').digest('hex')

    expect(ESSAI_EMPREINTE_HKDF_INFO).toBe('jesuispro:essai-empreinte:v1')
    expect(empreinteEssai('email', ' Marie@Exemple.test ', SECRET_A)).toBe(attendu)
  })

  it('should hash the NORMALISED Gmail form (golden): dots and `+tag` removed, `googlemail.com` becomes `gmail.com`', () => {
    // La normalisation des alias (E1, correction de revue) change l'entrée du HMAC pour ces adresses SEULEMENT : une adresse
    // ordinaire (`marie@exemple.test`, golden ci-dessus) garde son empreinte. Aucun essai n'est encore consommé en base
    // (D4bis : pas de production), il n'y a donc rien à migrer.
    const cle = Buffer.from(hkdfSync('sha256', SECRET_A, '', ESSAI_EMPREINTE_HKDF_INFO, 32))
    const attendu = createHmac('sha256', cle).update('email:mariedupont@gmail.com').digest('hex')

    expect(empreinteEssai('email', ' Marie.Dupont+essai@GoogleMail.com ', SECRET_A)).toBe(attendu)
  })

  it('should return the same fingerprint on repeated calls (the derived key is memoised per secret) and still separate two secrets', () => {
    const premiere = empreinteEssai('email', 'marie@exemple.test', SECRET_A)

    expect(empreinteEssai('email', 'marie@exemple.test', SECRET_A)).toBe(premiere)
    expect(empreinteEssai('email', 'marie@exemple.test', SECRET_B)).not.toBe(premiere)
    expect(empreinteEssai('email', 'marie@exemple.test', SECRET_A)).toBe(premiere)
  })
})

describe('clesEssai (CA-E1-30)', () => {
  const compteEmail = { email: 'Marie.Dupont@Exemple.test', phoneNumber: null, phoneNumberVerified: false }

  it('should hold the e-mail key of an account with a real address', () => {
    const cles = clesEssai(compteEmail, SECRET_A)

    expect(cles).toEqual([{ nature: 'email', empreinte: empreinteEssai('email', 'marie.dupont@exemple.test', SECRET_A) }])
  })

  it('should hold both keys when the phone number is verified', () => {
    const cles = clesEssai({ ...compteEmail, phoneNumber: '+237 612 345 678', phoneNumberVerified: true }, SECRET_A)

    expect(cles.map((c) => c.nature).sort()).toEqual(['email', 'telephone'])
    expect(cles.find((c) => c.nature === 'telephone')?.empreinte).toBe(empreinteEssai('telephone', '237612345678', SECRET_A))
  })

  it('should leave out a phone number that is not verified (not a proof of identity)', () => {
    const cles = clesEssai({ ...compteEmail, phoneNumber: '+237 612 345 678', phoneNumberVerified: false }, SECRET_A)

    expect(cles.map((c) => c.nature)).toEqual(['email'])
  })

  it('should leave out the technical e-mail of a phone-only account, whatever its case, and keep its verified number', () => {
    const cles = clesEssai({ email: `+237612345678@${TEMP_EMAIL_DOMAIN.toUpperCase()}`, phoneNumber: '+237612345678', phoneNumberVerified: true }, SECRET_A)

    expect(cles.map((c) => c.nature)).toEqual(['telephone'])
  })

  it('should hold NO key for a phone-only account whose number is not verified (no trial can be granted)', () => {
    expect(clesEssai({ email: `+237612345678@${TEMP_EMAIL_DOMAIN}`, phoneNumber: '+237612345678', phoneNumberVerified: false }, SECRET_A)).toEqual([])
    expect(clesEssai({ email: `x@${TEMP_EMAIL_DOMAIN}`, phoneNumber: null, phoneNumberVerified: false }, SECRET_A)).toEqual([])
  })

  it('should ignore an empty address and a verified number without any digit', () => {
    expect(clesEssai({ email: '   ', phoneNumber: null, phoneNumberVerified: false }, SECRET_A)).toEqual([])
    expect(clesEssai({ email: '', phoneNumber: 'abc', phoneNumberVerified: true }, SECRET_A)).toEqual([])
    expect(clesEssai({ email: '', phoneNumber: '   ', phoneNumberVerified: true }, SECRET_A)).toEqual([])
  })

  it('should return at most two keys, never twice the same, and nothing readable', () => {
    const cles = clesEssai({ ...compteEmail, phoneNumber: '+237612345678', phoneNumberVerified: true }, SECRET_A)

    expect(cles).toHaveLength(2)
    expect(new Set(cles.map((c) => c.empreinte)).size).toBe(2)
    const texte = JSON.stringify(cles)
    expect(texte).not.toContain('Marie')
    expect(texte).not.toContain('marie')
    expect(texte).not.toContain('612345678')
  })

  it('should give the same keys for two accounts that differ only by the case or the spaces of the address (cannot be bypassed by re-registering)', () => {
    const a = clesEssai({ email: 'Jean@Exemple.test', phoneNumber: null, phoneNumberVerified: false }, SECRET_A)
    const b = clesEssai({ email: '  jean@exemple.TEST ', phoneNumber: null, phoneNumberVerified: false }, SECRET_A)

    expect(b).toEqual(a)
  })
})

// ---------------------------------------------------------------------------------------------
// D8 : instant d'envoi des relances (9 h locale du compte)
// ---------------------------------------------------------------------------------------------

describe('instantRelance (D8)', () => {
  it('should be 9:00 local, `jour` civil days after the grant, in the time zone of the account (Douala is UTC+1)', () => {
    expect(instantRelance(GENERE_LE, 2, 'Africa/Douala').toISOString()).toBe('2026-11-25T08:00:00.000Z')
    expect(instantRelance(GENERE_LE, 7, 'Africa/Douala').toISOString()).toBe('2026-11-30T08:00:00.000Z')
  })

  it('should count the civil days of the LOCAL calendar: 10:00Z on Monday is still Sunday 23:00 in Pago Pago (UTC-11)', () => {
    expect(instantRelance(GENERE_LE, 2, 'Pacific/Pago_Pago').toISOString()).toBe('2026-11-24T20:00:00.000Z')
  })

  it('should fall back on Africa/Douala when the time zone is unknown, never throw', () => {
    expect(instantRelance(GENERE_LE, 2, 'Mars/Olympus').toISOString()).toBe('2026-11-25T08:00:00.000Z')
    expect(instantRelance(GENERE_LE, 2, '').toISOString()).toBe('2026-11-25T08:00:00.000Z')
  })

  it('should follow the clock change: 9:00 in Paris is 07:00Z in summer time and 08:00Z in winter time', () => {
    // Fin de l'heure d'été en Europe : dimanche 25 octobre 2026 à 3 h. Accordé le 20 octobre (UTC+2), relance le 27 (UTC+1).
    expect(instantRelance(new Date('2026-10-20T10:00:00.000Z'), 7, 'Europe/Paris').toISOString()).toBe('2026-10-27T08:00:00.000Z')
    expect(instantRelance(new Date('2026-10-20T10:00:00.000Z'), 2, 'Europe/Paris').toISOString()).toBe('2026-10-22T07:00:00.000Z')
  })

  it('should be strictly after the grant for every reminder day >= 1, even when granted late in the evening', () => {
    const tard = new Date('2026-11-23T22:59:00.000Z')

    expect(instantRelance(tard, 1, 'Africa/Douala').getTime()).toBeGreaterThan(tard.getTime())
  })
})

// ---------------------------------------------------------------------------------------------
// CA-E1-17 : revalidation des relances à l'envoi (fonction pure)
// ---------------------------------------------------------------------------------------------

describe('evaluerPertinence : relances de l\'essai (CA-E1-17)', () => {
  const OCCURRENCE = `${ESSAI_OCCURRENCE_PREFIXE}${FIN_ESSAI.toISOString()}`
  const ENVOI = new Date('2026-11-25T08:05:00.000Z')
  const abonnementOk = { origine: 'essai', expireLe: FIN_ESSAI, emailHebdo: true, destinataire: true, contenuDejaAjoute: false, relationnelDejaPartiCetteSemaine: false }

  function entree(type: (typeof ESSAI_EMAIL_TYPES)[number], surcharges: Partial<EntreeEssaiRelance> = {}, abonnement: Partial<NonNullable<EntreeEssaiRelance['abonnement']>> | null = {}): EntreeEssaiRelance {
    return {
      type,
      occurrence: OCCURRENCE,
      createdAt: GENERE_LE,
      abonnement: abonnement === null ? null : { ...abonnementOk, ...abonnement },
      ...surcharges,
    }
  }

  it.each(ESSAI_EMAIL_TYPES)('should let %s go when everything still holds', (type) => {
    expect(evaluerPertinence(entree(type), ENVOI)).toBeNull()
  })

  it.each(ESSAI_EMAIL_TYPES)('should cancel %s with ENTITE_INTROUVABLE when the subscription row is gone (account deleted, back to the free plan)', (type) => {
    expect(evaluerPertinence(entree(type, {}, null), ENVOI)).toBe('ENTITE_INTROUVABLE')
  })

  it.each(['paiement', 'offert', 'admin'])('should cancel with ESSAI_TERMINE when the subscription origin became `%s` (paid during the trial, or changed by the administration)', (origine) => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { origine }), ENVOI)).toBe('ESSAI_TERMINE')
    expect(evaluerPertinence(entree('abonnement_essai_statistiques', {}, { origine }), ENVOI)).toBe('ESSAI_TERMINE')
  })

  it('should cancel with RAPPEL_PERIME once the end of the trial has been reached, and not one millisecond before', () => {
    const veille = new Date(FIN_ESSAI.getTime() - 1)

    expect(evaluerPertinence(entree('abonnement_essai_statistiques'), veille)).toBeNull()
    expect(evaluerPertinence(entree('abonnement_essai_statistiques'), FIN_ESSAI)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree('abonnement_essai_statistiques'), new Date(FIN_ESSAI.getTime() + 86_400_000))).toBe('RAPPEL_PERIME')
  })

  it('should cancel with RAPPEL_PERIME when the trial was extended or shortened after the planning (the key names ONE end date)', () => {
    const prolonge = new Date(FIN_ESSAI.getTime() + 7 * 86_400_000)

    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { expireLe: prolonge }), ENVOI)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree('abonnement_essai_statistiques', {}, { expireLe: new Date(FIN_ESSAI.getTime() - 1000) }), ENVOI)).toBe('RAPPEL_PERIME')
  })

  it.each(['', 'ESSAI:', 'ESSAI:demain', 'ESSAI:2026-12-07', 'ESSAI:2026-12-07T10:00:00Z', 'essai:2026-12-07T10:00:00.000Z', `J7:${FIN_ESSAI.toISOString()}`, ` ${OCCURRENCE}`])(
    'should cancel with RAPPEL_PERIME a line whose occurrence is not exactly `ESSAI:<end ISO>` (%j)',
    (occurrence) => {
      expect(evaluerPertinence(entree('abonnement_essai_services', { occurrence }), ENVOI)).toBe('RAPPEL_PERIME')
    },
  )

  it('should cancel with DESTINATAIRE_ABSENT when no address exists (phone account without contact e-mail)', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { destinataire: false }), ENVOI)).toBe('DESTINATAIRE_ABSENT')
  })

  it('should cancel with PREFERENCE_DESACTIVEE when the person switched off the e-mails (`email_hebdo`), the unsubscribe link of every relational message', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { emailHebdo: false }), ENVOI)).toBe('PREFERENCE_DESACTIVEE')
    expect(evaluerPertinence(entree('abonnement_essai_statistiques', {}, { emailHebdo: false }), ENVOI)).toBe('PREFERENCE_DESACTIVEE')
  })

  it('should cancel ONLY the « services » reminder with CONTENU_DEJA_AJOUTE: the « statistics » one is still useful', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { contenuDejaAjoute: true }), ENVOI)).toBe('CONTENU_DEJA_AJOUTE')
    expect(evaluerPertinence(entree('abonnement_essai_statistiques', {}, { contenuDejaAjoute: true }), ENVOI)).toBeNull()
  })

  it.each(ESSAI_EMAIL_TYPES)('should cancel %s with PLAFOND_RELATIONNEL when another relational e-mail already left this week (S9 #88: one per week and per account)', (type) => {
    expect(evaluerPertinence(entree(type, {}, { relationnelDejaPartiCetteSemaine: true }), ENVOI)).toBe('PLAFOND_RELATIONNEL')
  })

  it('should judge the weekly cap LAST: a reminder without object keeps its own code (CONTENU_DEJA_AJOUTE, ESSAI_TERMINE)', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { contenuDejaAjoute: true, relationnelDejaPartiCetteSemaine: true }), ENVOI)).toBe('CONTENU_DEJA_AJOUTE')
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { origine: 'paiement', relationnelDejaPartiCetteSemaine: true }), ENVOI)).toBe('ESSAI_TERMINE')
  })

  it('should judge the end of the trial before the privacy and content rules: a paid account gets ESSAI_TERMINE, not PREFERENCE_DESACTIVEE', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services', {}, { origine: 'paiement', emailHebdo: false, contenuDejaAjoute: true }), ENVOI)).toBe('ESSAI_TERMINE')
  })

  it('should not be late-sensitive: a reminder delayed by an outage is still sent while the trial runs (no catch-up window)', () => {
    expect(evaluerPertinence(entree('abonnement_essai_services'), new Date('2026-12-01T12:00:00.000Z'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// D9 : rappels d'échéance d'un essai (pur) et absence de grâce
// ---------------------------------------------------------------------------------------------

describe('rappelDu avec les paliers d\'un essai (D9, CA-E1-19 côté pur)', () => {
  /** Échéance alignée sur le minuit local suivant : dernier jour payé = 3 décembre à Douala (comme rappels-abonnement.test.ts). */
  const EXPIRE = new Date('2026-12-03T23:00:00.000Z')
  const FUSEAU = 'Africa/Douala'

  it('should keep J-7, J-3 and J0 for the default paliers (non-regression of a paid subscription)', () => {
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-26T08:00:00.000Z'), ABONNEMENT_RAPPELS_JOURS)).toBe(7)
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-30T08:00:00.000Z'), ABONNEMENT_RAPPELS_JOURS)).toBe(3)
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-12-03T08:00:00.000Z'), ABONNEMENT_RAPPELS_JOURS)).toBe(0)
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-26T08:00:00.000Z'))).toBe(7)
  })

  it('should skip J-7 for an essai (it would fall on the day of the « statistics » e-mail) and keep J-3 and J0', () => {
    expect([...ESSAI_RAPPELS_JOURS]).toEqual([3, 0])
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-26T08:00:00.000Z'), ESSAI_RAPPELS_JOURS)).toBeNull()
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-30T08:00:00.000Z'), ESSAI_RAPPELS_JOURS)).toBe(3)
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-12-03T08:00:00.000Z'), ESSAI_RAPPELS_JOURS)).toBe(0)
  })

  it('should plan nothing on a day without a reminder, nor outside the 9:00 window, nor after the end', () => {
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-12-01T08:00:00.000Z'), ESSAI_RAPPELS_JOURS)).toBeNull()
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-11-30T07:30:00.000Z'), ESSAI_RAPPELS_JOURS)).toBeNull()
    expect(rappelDu(EXPIRE, FUSEAU, new Date('2026-12-04T08:00:00.000Z'), ESSAI_RAPPELS_JOURS)).toBeNull()
  })
})

describe('resoudrePlanEffectif : un essai n\'a aucune période de grâce (D9, CA-E1-28 côté pur)', () => {
  const NOW = new Date('2026-12-07T09:00:00.000Z')
  const essai = { plan: 'payant', expireLe: FIN_ESSAI, origine: 'essai' }

  it('should give the payant plan, active, until the very end of the trial', () => {
    const effectif = resoudrePlanEffectif(essai, new Date(FIN_ESSAI.getTime() - 1), 'Africa/Douala', 7)

    expect(effectif).toMatchObject({ plan: 'payant', etat: 'actif', graceJusquau: null })
  })

  it('should be free from the very end, even one second after (no grace for a trial)', () => {
    for (const decalage of [0, 1000, 86_400_000, 6 * 86_400_000]) {
      const effectif = resoudrePlanEffectif(essai, new Date(FIN_ESSAI.getTime() + decalage), 'Africa/Douala', 7)

      expect(effectif.plan, `+${decalage} ms`).toBe('gratuit')
      expect(effectif.etat, `+${decalage} ms`).toBe('gratuit')
    }
    expect(resoudrePlanEffectif(essai, NOW, 'Africa/Douala', 7).plan).toBe('payant')
  })

  it.each([undefined, null, 'paiement', 'offert', 'admin'])('should keep the grace of 7 days for an origin of `%s` (non-regression)', (origine) => {
    const echu = { plan: 'payant', expireLe: FIN_ESSAI, origine }

    const effectif = resoudrePlanEffectif(echu, new Date(FIN_ESSAI.getTime() + 1000), 'Africa/Douala', 7)

    expect(effectif).toMatchObject({ plan: 'payant', etat: 'grace' })
    expect(effectif.graceJusquau).toBeInstanceOf(Date)
    expect(resoudrePlanEffectif(echu, new Date(FIN_ESSAI.getTime() + 8 * 86_400_000), 'Africa/Douala', 7).plan).toBe('gratuit')
  })

  it('should ignore the configured grace for a trial, whatever its length (0, 7 or 30 days)', () => {
    for (const grace of [0, 7, 30]) {
      expect(resoudrePlanEffectif(essai, new Date(FIN_ESSAI.getTime() + 1000), 'Africa/Douala', grace).plan, `grâce ${grace}`).toBe('gratuit')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// CA-E1-20 et CA-E1-21 : contenus
// ---------------------------------------------------------------------------------------------

describe('rappel d\'échéance avec `essai: true` (CA-E1-20)', () => {
  function rappel(jours: number, surcharges: Partial<AbonnementRappelContent> = {}): AbonnementRappelContent {
    return {
      type: 'abonnement_rappel',
      outboxId: OUTBOX_ID,
      generatedAt: GENERE_LE,
      destinataire: 'cabrel.pro@exemple.test',
      prenom: 'Cabrel',
      fuseau: 'Africa/Douala',
      siteUrl: SITE,
      jours,
      expireLe: new Date('2026-12-07T23:00:00.000Z'),
      periodeMois: 1,
      essai: true,
      ...surcharges,
    }
  }

  it.each([
    [3, 'Votre essai se termine dans 3 jours'],
    [1, 'Votre essai se termine demain'],
    [0, "Votre essai se termine aujourd'hui"],
  ])('should say « essai » in the subject for J-%i: %s', (jours, objet) => {
    expect(buildAbonnementRappelEmail(rappel(jours)).subject).toBe(objet)
  })

  it('should say that the vitrine goes back to the free plan, that nothing is deleted, and never speak of a grace period or of a subscription', () => {
    const { text } = buildAbonnementRappelEmail(rappel(3))
    const lisible = normaliser(text)

    expect(lisible).toContain('essai gratuit')
    expect(lisible).toContain("jusqu'au 7 décembre 2026 inclus")
    expect(lisible).toMatch(/revient au plan gratuit/)
    expect(lisible.toLowerCase()).toMatch(/rien n'est supprimé/)
    expect(lisible).toContain("Rien n'est prélevé sans votre accord.")
    // L'ancre de l'adresse (`#abonnement`) n'est pas un mot du message : seuls les mots écrits comptent.
    const sansAdresses = lisible.replaceAll(/https?:\/\/\S+/g, '')
    expect(sansAdresses).not.toMatch(/grâce/i)
    expect(sansAdresses).not.toMatch(/abonnement/i)
    expect(sansAdresses).not.toMatch(/automatiquement/i)
  })

  it('should word the last day: « Aujourd\'hui est le dernier jour de votre essai gratuit »', () => {
    const lisible = normaliser(buildAbonnementRappelEmail(rappel(0)).text)

    expect(lisible).toMatch(/Aujourd'hui est le dernier jour de votre essai gratuit/)
    expect(lisible).not.toMatch(/grâce/i)
  })

  it('should link to the renewal page with the SHORTEST period preselected (an essai has no paid period)', () => {
    const { text, html } = buildAbonnementRappelEmail(rappel(3, { periodeMois: 1 }))

    expect(text).toContain(`${SITE}/studio/compte?periode=1#abonnement`)
    expect(html).toContain(`${SITE}/studio/compte?periode=1#abonnement`)
  })

  it('should be rendered in HTML AND in text from the same document, with the same facts', () => {
    const message = buildAbonnementRappelEmail(rappel(3))
    const lisible = normaliser(texteDuHtml(message.html ?? ''))

    expect(message.html).toBeTruthy()
    expect(lisible).toContain('Votre essai se termine dans 3 jours')
    expect(lisible).toContain('Garder le plan payant')
    expect(lisible).toContain("jusqu'au 7 décembre 2026 inclus")
    expect(lisible).not.toMatch(/grâce/i)
    expect(message.attachments).toEqual([])
  })

  it('should stay a service message: no List-Unsubscribe header, no unsubscribe link (end of access)', () => {
    const message = buildAbonnementRappelEmail(rappel(3))

    expect(message.headers).toBeUndefined()
    expect(message.text).not.toMatch(/desabonnement|Ne plus recevoir/i)
    expect(message.text).toMatch(/message de service/)
  })

  it('should show the last included day in the time zone of the recipient (Paris is two hours ahead in summer)', () => {
    // 2026-07-31T23:00Z = 1er août 01 h à Paris (UTC+2) : dernier jour payé = 1er août ; à Douala : 31 juillet.
    const douala = buildAbonnementRappelEmail(rappel(3, { expireLe: new Date('2026-07-31T23:00:00.000Z') }))
    const paris = buildAbonnementRappelEmail(rappel(3, { expireLe: new Date('2026-07-31T23:00:00.000Z'), fuseau: 'Europe/Paris' }))

    expect(normaliser(douala.text)).toContain("jusqu'au 31 juillet 2026 inclus")
    expect(normaliser(paris.text)).toContain("jusqu'au 1er août 2026 inclus")
  })

  it('should leave the paid-subscription message untouched when `essai` is absent or false (non-regression)', () => {
    for (const essai of [undefined, false]) {
      const message = buildAbonnementRappelEmail(rappel(3, { essai, graceJours: 7 }))

      expect(message.subject).toBe('Votre abonnement se termine dans 3 jours')
      expect(normaliser(message.text)).toContain('période de grâce de 7 jours')
      expect(message.text).not.toMatch(/essai/i)
    }
  })

  it('should reach the same message through the generic entry point `buildTransactionalEmail`', () => {
    const direct = buildAbonnementRappelEmail(rappel(3))
    const generique = buildTransactionalEmail(rappel(3) as TransactionalEmailContent)

    expect(generique.subject).toBe(direct.subject)
    expect(generique.text).toBe(direct.text)
  })
})

describe('relances « services » (jour 2) et « statistiques » (jour 7) (CA-E1-21)', () => {
  function relance(surcharges: Partial<EssaiRelanceContent> & { type: EssaiRelanceContent['type'] }): EssaiRelanceContent {
    const base = {
      outboxId: OUTBOX_ID,
      generatedAt: GENERE_LE,
      destinataire: 'cabrel.pro@exemple.test',
      prenom: 'Cabrel',
      fuseau: 'Africa/Douala',
      siteUrl: SITE,
      jetonDesabonnement: JETON,
      expireLe: new Date('2026-12-07T23:00:00.000Z'),
    }
    return (surcharges.type === 'abonnement_essai_services'
      ? { ...base, ...surcharges }
      : { visites: 12, clics: 3, ...base, ...surcharges }) as EssaiRelanceContent
  }

  it('should write the jour 2 message: « Ajoutez vos services à votre vitrine », with a link to the services of the studio', () => {
    const message = buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_services' }))

    expect(message.subject).toBe('Ajoutez vos services à votre vitrine')
    expect(message.to).toBe('cabrel.pro@exemple.test')
    expect(message.text).toContain('Bonjour Cabrel,')
    expect(message.text).toContain(`${SITE}/studio/services`)
    expect(message.html).toContain(`${SITE}/studio/services`)
  })

  it('should write the jour 7 message with the visits and the clicks since the creation of the vitrine', () => {
    const message = buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', visites: 12, clics: 3 }))

    expect(message.subject).toBe('Votre vitrine cette semaine')
    expect(message.text).toMatch(/Visites\s*:?\s*12/)
    expect(message.text).toMatch(/Clics sur vos liens\s*:?\s*3/)
    expect(message.text).not.toContain('Partagez votre adresse')
    expect(normaliser(message.text)).toContain('Votre essai se termine le 7 décembre 2026.')
  })

  it('should invite to share the address when the vitrine had no visit and no click (never « 0 visite » as the only news)', () => {
    const message = buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', visites: 0, clics: 0 }))

    expect(message.text).toContain('Partagez votre adresse')
    expect(message.text).not.toMatch(/Visites\s*:?\s*0/)
  })

  it('should show the visits when only the clicks are non-zero, and the opposite', () => {
    expect(buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', visites: 0, clics: 2 })).text).toMatch(/Clics sur vos liens\s*:?\s*2/)
    expect(buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', visites: 5, clics: 0 })).text).toMatch(/Visites\s*:?\s*5/)
  })

  it.each(['abonnement_essai_services', 'abonnement_essai_statistiques'] as const)('should carry an unsubscribe link and the List-Unsubscribe headers of the one-click standard on %s (relational message)', (type) => {
    const message = buildEssaiRelanceEmail(relance({ type }))

    expect(message.headers?.['List-Unsubscribe']).toContain(`${SITE}/api/public/desabonnement?jeton=${JETON}`)
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(message.text).toContain(`${SITE}/desabonnement?jeton=${JETON}`)
    expect(message.html).toContain(`${SITE}/desabonnement?jeton=${JETON}`)
    expect(message.attachments).toEqual([])
  })

  it.each(['abonnement_essai_services', 'abonnement_essai_statistiques'] as const)('should refuse a malformed unsubscribe token on %s: no relational e-mail without a valid opt-out', (type) => {
    expect(() => buildEssaiRelanceEmail(relance({ type, jetonDesabonnement: 'pas un jeton valide !' }))).toThrow('JETON_DESABONNEMENT_INVALIDE')
    expect(() => buildEssaiRelanceEmail(relance({ type, jetonDesabonnement: '' }))).toThrow('JETON_DESABONNEMENT_INVALIDE')
  })

  it.each(['abonnement_essai_services', 'abonnement_essai_statistiques'] as const)('should be routed by buildTransactionalEmail for %s', (type) => {
    const contenu = relance({ type })

    expect(buildTransactionalEmail(contenu as TransactionalEmailContent).subject).toBe(buildEssaiRelanceEmail(contenu).subject)
  })

  it('should greet without a first name instead of printing an empty one', () => {
    const message = buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_services', prenom: '' }))

    expect(message.text).toContain('Bonjour,')
    expect(message.text).not.toMatch(/Bonjour\s+,/)
  })

  it('should say the essai ends the last included day in the time zone of the recipient', () => {
    const paris = buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', fuseau: 'Europe/Paris', expireLe: new Date('2026-07-31T23:00:00.000Z') }))

    expect(normaliser(paris.text)).toContain('Votre essai se termine le 1er août 2026.')
  })

  it('should never use the forbidden vocabulary nor the informal « tu », in the subject, the text or the HTML of the four e-mails', () => {
    const messages = [
      buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_services' })),
      buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques' })),
      buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques', visites: 0, clics: 0 })),
      buildAbonnementRappelEmail({
        type: 'abonnement_rappel', outboxId: OUTBOX_ID, generatedAt: GENERE_LE, destinataire: 'a@exemple.test', prenom: 'Cabrel', fuseau: 'Africa/Douala', siteUrl: SITE,
        jours: 3, expireLe: new Date('2026-12-07T23:00:00.000Z'), periodeMois: 1, essai: true,
      }),
      buildAbonnementRappelEmail({
        type: 'abonnement_rappel', outboxId: OUTBOX_ID, generatedAt: GENERE_LE, destinataire: 'a@exemple.test', prenom: 'Cabrel', fuseau: 'Africa/Douala', siteUrl: SITE,
        jours: 0, expireLe: new Date('2026-12-07T23:00:00.000Z'), periodeMois: 1, essai: true,
      }),
    ]

    for (const message of messages) {
      const corps = normaliser(`${message.subject}\n${message.text}\n${texteDuHtml(message.html ?? '')}`)
      expect(corps, message.subject).not.toMatch(MOTS_INTERDITS)
      expect(corps, message.subject).not.toMatch(TUTOIEMENT)
      expect(corps, message.subject).toMatch(/\bvotre\b/i)
    }
  })

  it('should never promise a trial without engagement or a cancellation, a payment it does not take, nor a price', () => {
    const messages = [
      buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_services' })),
      buildEssaiRelanceEmail(relance({ type: 'abonnement_essai_statistiques' })),
    ]

    for (const message of messages) {
      expect(message.text).not.toMatch(/sans engagement|résili|annul/i)
      expect(message.text).not.toMatch(/FCFA|€|\$|KPAY/)
    }
  })
})

describe('textes de l\'application (/tarifs, landing, fin d\'inscription, carte Abonnement)', () => {
  it('should word the public mention with the duration of the active version (D10)', () => {
    expect(mentionEssaiPublic(14)).toBe('14 jours du plan payant offerts à la création de votre vitrine. Aucun paiement demandé.')
    expect(mentionEssaiPublic(30)).toContain('30 jours')
    expect(mentionEssaiPublic(1)).toBe('1 jour du plan payant offert à la création de votre vitrine. Aucun paiement demandé.')
  })

  it('should word the end-of-sign-up message with the duration of the trial actually granted', () => {
    expect(messageEssaiAccorde(14)).toBe('14 jours du plan payant vous sont offerts. Aucun paiement demandé.')
    expect(messageEssaiAccorde(1)).toBe('1 jour du plan payant vous est offert. Aucun paiement demandé.')
  })

  it('should never say « sans engagement » nor « résiliable », nor the forbidden vocabulary', () => {
    for (const texte of [mentionEssaiPublic(14), messageEssaiAccorde(14), phraseRappelsEssai(), MESSAGE_APRES_ESSAI, MESSAGE_JOURS_ESSAI_CONSERVES]) {
      expect(texte).not.toMatch(/sans engagement|résiliable|résili/i)
      expect(texte).not.toMatch(MOTS_INTERDITS)
    }
  })

  it('should read the reminder steps of the essai from the shared configuration (no J-7)', () => {
    const phrase = phraseRappelsEssai()

    expect(phrase).toContain('3 jours')
    expect(phrase).not.toContain('7 jours')
  })

  it('should word the in-trial card with the last included day and one reminder sentence', () => {
    expect(titreEssaiEnCours('7 décembre 2026')).toBe('Essai gratuit jusqu’au 7 décembre 2026 inclus')
    expect(phraseRappelsEssai()).toBe('Nous vous prévenons 3 jours avant la fin, puis le dernier jour.')
    expect(MESSAGE_APRES_ESSAI).toContain('masqué, jamais supprimé')
  })
})
