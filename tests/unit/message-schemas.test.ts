import { describe, expect, it } from 'vitest'
import { CONTACT_EMAIL_MAX, CONTACT_NOM_MAX } from '../../shared/agenda'
import { MESSAGE_MAX, SUJET_LIBELLES, SUJETS_MESSAGE } from '../../shared/message'
import {
  schemaMessageCreate,
  schemaMessageIdParams,
  schemaMessageLu,
} from '../../shared/schemas/message'

// Contrat S7-bis §4.4/§5 : schéma strict, honeypot `siteWeb` littéral vide,
// téléphone E.164 facultatif (absent, jamais null), sujet parmi les 4 valeurs
// tranchées par le client le 2026-10-31.

const corpsValide = {
  nom: 'Marie Ndzi',
  email: 'marie.ndzi@example.com',
  telephone: '+237699000001',
  sujet: 'question_avant_reservation',
  message: 'Bonjour, le rendez-vous peut-il être décalé ?',
  siteWeb: '',
}

describe('constantes des messages (shared/message)', () => {
  it('expose exactement les quatre sujets tranchés par le client le 2026-10-31', () => {
    expect([...SUJETS_MESSAGE]).toEqual([
      'question_avant_reservation',
      'demande_information',
      'suivi_reservation',
      'autre',
    ])
  })

  it('donne un libellé non vide et unique à chaque sujet (SUJET_LIBELLES)', () => {
    expect(Object.keys(SUJET_LIBELLES).sort()).toEqual([...SUJETS_MESSAGE].sort())
    const libelles = [...SUJETS_MESSAGE].map((sujet) => SUJET_LIBELLES[sujet])
    for (const libelle of libelles) {
      expect(typeof libelle).toBe('string')
      expect(libelle.trim()).not.toBe('')
    }
    expect(new Set(libelles)).toHaveLength(SUJETS_MESSAGE.length)
  })

  it('fixe la borne du texte du message à 1000 caractères (MESSAGE_MAX)', () => {
    expect(MESSAGE_MAX).toBe(1000)
  })
})

describe('schemaMessageCreate (strict)', () => {
  it('accepte un corps complet avec téléphone E.164', () => {
    expect(schemaMessageCreate.parse(corpsValide)).toEqual(corpsValide)
  })

  it('accepte le corps sans téléphone (facultatif, CA13) ', () => {
    const { telephone: _omis, ...sansTelephone } = corpsValide
    expect(schemaMessageCreate.parse(sansTelephone)).toEqual(sansTelephone)
  })

  it('trimme le nom et refuse le nom vide après suppression des espaces', () => {
    const trimme = schemaMessageCreate.parse({ ...corpsValide, nom: '  Marie Ndzi  ' })
    expect(trimme.nom).toBe('Marie Ndzi')
    expect(schemaMessageCreate.safeParse({ ...corpsValide, nom: '   ' }).success).toBe(false)
  })

  it('applique la borne CONTACT_NOM_MAX inclusive', () => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, nom: 'a'.repeat(CONTACT_NOM_MAX) }).success)
      .toBe(true)
    expect(schemaMessageCreate.safeParse({ ...corpsValide, nom: 'a'.repeat(CONTACT_NOM_MAX + 1) }).success)
      .toBe(false)
  })

  it.each([
    'pas-un-email',
    'a@',
    '@example.com',
    'a b@example.com',
    'a@example',
  ])('refuse l’email invalide %j', (email) => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, email }).success).toBe(false)
  })

  it('refuse un email de plus de CONTACT_EMAIL_MAX (254) caractères', () => {
    const tropLong = `${'a'.repeat(249)}@example.com`
    expect(tropLong.length).toBeGreaterThan(CONTACT_EMAIL_MAX)
    expect(schemaMessageCreate.safeParse({ ...corpsValide, email: tropLong }).success).toBe(false)
  })

  it.each([
    '699000001',
    '00237699000001',
    '+237 699 000 001',
    '+23760',
    'telephone',
  ])('refuse le téléphone non E.164 %j', (telephone) => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, telephone }).success).toBe(false)
  })

  it('refuse un téléphone null : le champs est absent, jamais null', () => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, telephone: null }).success).toBe(false)
  })

  it.each([...SUJETS_MESSAGE])('accepte le sujet %j', (sujet) => {
    expect(schemaMessageCreate.parse({ ...corpsValide, sujet }).sujet).toBe(sujet)
  })

  it.each([
    'reservation',
    'facture',
    'DEMANDE_INFORMATION',
    '',
    null,
  ])('refuse le sujet hors liste %j', (sujet) => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, sujet }).success).toBe(false)
  })

  it('applique la borne MESSAGE_MAX (1000) et refuse le texte vide', () => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, message: 'a'.repeat(MESSAGE_MAX) }).success)
      .toBe(true)
    expect(schemaMessageCreate.safeParse({ ...corpsValide, message: 'a'.repeat(MESSAGE_MAX + 1) }).success)
      .toBe(false)
    expect(schemaMessageCreate.safeParse({ ...corpsValide, message: '' }).success).toBe(false)
    expect(schemaMessageCreate.safeParse({ ...corpsValide, message: '   ' }).success).toBe(false)
  })

  it.each([
    'https://robot.example',
    ' ',
    'x',
    null,
  ])('exige un honeypot siteWeb exactement vide, reçu %j', (siteWeb) => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, siteWeb }).success).toBe(false)
  })

  it('refuse un honeypot absent (strict : littéral requis)', () => {
    const { siteWeb: _omis, ...sansHoneypot } = corpsValide
    expect(schemaMessageCreate.safeParse(sansHoneypot).success).toBe(false)
  })

  it.each([
    'id',
    'vitrineId',
    'createdAt',
    'luLe',
    'statut',
  ])('refuse la clef serveur ou inconnue %s (mass assignment)', (clef) => {
    expect(schemaMessageCreate.safeParse({ ...corpsValide, [clef]: 'x' }).success).toBe(false)
  })
})

describe('schemaMessageIdParams (§4.7, corps vide du marquage lu)', () => {
  it('accepte un identifiant uuid', () => {
    const params = { id: '0199a3b2-7c1d-7f0e-9b2a-3d4c5e6f7a8b' }
    expect(schemaMessageIdParams.parse(params)).toEqual(params)
  })

  it.each([
    'sans-uuid',
    'message-1',
    '',
  ])('refuse l’identifiant non uuid %j', (id) => {
    expect(schemaMessageIdParams.safeParse({ id }).success).toBe(false)
  })

  it('refuse une clef supplémentaire (strict)', () => {
    expect(schemaMessageIdParams.safeParse({ id: '0199a3b2-7c1d-7f0e-9b2a-3d4c5e6f7a8b', x: '1' }).success)
      .toBe(false)
  })
})

describe('schemaMessageLu (corps vide §4.7)', () => {
  it('accepte un corps vide', () => {
    expect(schemaMessageLu.parse({})).toEqual({})
  })

  it.each([
    { motif: 'refus' },
    { statut: 'refusee' },
  ])('refuse le corps non vide %j (strict)', (corps) => {
    expect(schemaMessageLu.safeParse(corps).success).toBe(false)
  })
})
