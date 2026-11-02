import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  schemaGenerationIdParams,
  schemaOnboardingEtape,
  schemaOnboardingGenerer,
  schemaOnboardingIdentite,
  schemaOnboardingProposition,
  schemaOnboardingTerminer,
} from '../../shared/schemas/onboarding'
import { BIO_MAX, METIER_MAX } from '../../shared/vitrine'

// S8 §3.3 / CA08 / CA14 / CA41 : une étape = un schéma strict, union discriminée par `etape`.

const identite = { etape: 1, titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'CM' }
const photo = { etape: 2, photoMediaId: randomUUID() }
const proposition = { etape: 3, accrocheIndex: 1, presentation: 'Texte modifié.', servicesActifs: [true, false, true] }

function champsEnErreur(corps: unknown): string[] {
  const resultat = schemaOnboardingEtape.safeParse(corps)
  if (resultat.success) return []
  return [...new Set(resultat.error.issues.map((issue) => String(issue.path[0] ?? '')))].sort()
}

describe('schemaOnboardingEtape : étape 1 (CA08)', () => {
  it('should accept the demonstration identity', () => {
    expect(schemaOnboardingEtape.safeParse(identite).success).toBe(true)
  })

  it('should trim the text fields', () => {
    const resultat = schemaOnboardingIdentite.parse({ ...identite, prenom: '  Cabrel ', ville: ' Douala  ', metier: '  Cardiologue ' })

    expect(resultat).toMatchObject({ prenom: 'Cabrel', ville: 'Douala', metier: 'Cardiologue' })
  })

  it('should turn a blank title into null (« Sans titre »)', () => {
    expect(schemaOnboardingIdentite.parse({ ...identite, titre: '' }).titre).toBeNull()
    expect(schemaOnboardingIdentite.parse({ ...identite, titre: null }).titre).toBeNull()
  })

  it.each([
    ['prénom vide', { prenom: '' }, 'prenom'],
    ['prénom d’espaces', { prenom: '   ' }, 'prenom'],
    ['nom vide', { nom: '' }, 'nom'],
    ['métier vide', { metier: '' }, 'metier'],
    ['ville vide', { ville: '' }, 'ville'],
    ['ville d’espaces', { ville: '    ' }, 'ville'],
    ['ville de 81 caractères', { ville: 'v'.repeat(81) }, 'ville'],
    ['pays inconnu XX', { pays: 'XX' }, 'pays'],
    ['pays en minuscules', { pays: 'cm' }, 'pays'],
    ['pays absent', { pays: undefined }, 'pays'],
    ['métier de 81 caractères', { metier: 'm'.repeat(METIER_MAX + 1) }, 'metier'],
    ['titre inconnu', { titre: 'prof' }, 'titre'],
  ])('should reject %s and point at the field', (_nom, surcharge, champ) => {
    expect(champsEnErreur({ ...identite, ...surcharge })).toContain(champ)
  })

  it('should accept a métier of exactly 80 characters', () => {
    expect(schemaOnboardingEtape.safeParse({ ...identite, metier: 'm'.repeat(METIER_MAX) }).success).toBe(true)
  })

  it.each([
    ['username', { username: 'dr-cabrel' }],
    ['userId', { userId: 'autre-utilisateur' }],
    ['palette', { palette: 'sauge' }],
    ['termineLe', { termineLe: '2020-01-01T00:00:00Z' }],
    ['generationId', { generationId: randomUUID() }],
  ])('should reject the unknown key %s (mass assignment)', (_cle, extra) => {
    expect(schemaOnboardingEtape.safeParse({ ...identite, ...extra }).success).toBe(false)
  })
})

describe('schemaOnboardingEtape : union discriminée', () => {
  it.each([5, 0, -1, '1', null, undefined])('should reject the step %j', (etape) => {
    expect(schemaOnboardingEtape.safeParse({ ...identite, etape }).success).toBe(false)
  })

  it('should not accept the fields of one step under another step number', () => {
    expect(schemaOnboardingEtape.safeParse({ ...photo, etape: 1 }).success).toBe(false)
    expect(schemaOnboardingEtape.safeParse({ ...identite, etape: 2 }).success).toBe(false)
    expect(schemaOnboardingEtape.safeParse({ ...proposition, etape: 2 }).success).toBe(false)
  })

  it.each([null, undefined, 'texte', 3, []])('should reject the non-object body %j', (corps) => {
    expect(schemaOnboardingEtape.safeParse(corps).success).toBe(false)
  })
})

describe('schemaOnboardingEtape : étape 2', () => {
  it('should accept a uuid', () => {
    expect(schemaOnboardingEtape.safeParse(photo).success).toBe(true)
  })

  it.each([
    ['not a uuid', { photoMediaId: 'abc' }],
    ['empty id', { photoMediaId: '' }],
    ['null id', { photoMediaId: null }],
    ['a path instead of an id', { photoMediaId: '../../etc/passwd' }],
    ['an unknown key', { userId: 'x' }],
  ])('should reject %s', (_nom, surcharge) => {
    expect(schemaOnboardingEtape.safeParse({ ...photo, ...surcharge }).success).toBe(false)
  })
})

describe('schemaOnboardingProposition (CA14)', () => {
  it('should accept the proposition choices', () => {
    expect(schemaOnboardingProposition.safeParse(proposition).success).toBe(true)
  })

  it.each([
    ['accrocheIndex 3', { accrocheIndex: 3 }],
    ['accrocheIndex -1', { accrocheIndex: -1 }],
    ['accrocheIndex 1.5', { accrocheIndex: 1.5 }],
    ['accrocheIndex as a string', { accrocheIndex: '1' }],
    ['empty presentation', { presentation: '' }],
    ['blank presentation', { presentation: '   \n  ' }],
    ['presentation of 2001 characters', { presentation: 'p'.repeat(BIO_MAX + 1) }],
    ['two switches', { servicesActifs: [true, false] }],
    ['four switches', { servicesActifs: [true, false, true, true] }],
    ['no switch', { servicesActifs: [] }],
    ['non-boolean switches', { servicesActifs: [1, 0, 1] }],
    ['a services field (content injection)', { services: [{ titre: 'Pirate', type: 'rdv' }] }],
    ['an accroche field (content injection)', { accroche: 'Texte imposé par le client' }],
    ['a generationId field', { generationId: randomUUID() }],
  ])('should reject %s', (_nom, surcharge) => {
    expect(schemaOnboardingProposition.safeParse({ ...proposition, ...surcharge }).success).toBe(false)
  })

  it('should accept a presentation of exactly 2000 characters', () => {
    expect(schemaOnboardingProposition.safeParse({ ...proposition, presentation: 'p'.repeat(BIO_MAX) }).success).toBe(true)
  })

  it('should trim the presentation', () => {
    expect(schemaOnboardingProposition.parse({ ...proposition, presentation: '  Bonjour  ' }).presentation).toBe('Bonjour')
  })

  it.each([0, 1, 2])('should accept the accroche index %i', (index) => {
    expect(schemaOnboardingProposition.safeParse({ ...proposition, accrocheIndex: index }).success).toBe(true)
  })
})

describe('schemaOnboardingTerminer (CA41)', () => {
  it('should accept an address and a known palette', () => {
    expect(schemaOnboardingTerminer.parse({ username: 'dr-cabrel-test', palette: 'sauge' })).toEqual({
      username: 'dr-cabrel-test',
      palette: 'sauge',
    })
  })

  it('should normalise the address (trim, lowercase)', () => {
    expect(schemaOnboardingTerminer.parse({ username: '  Dr-Cabrel ', palette: 'sauge' }).username).toBe('dr-cabrel')
  })

  it.each([
    ['studio'],
    ['api'],
    ['connexion'],
    ['onboarding'],
    ['admin'],
    ['Dr Cabrel'],
    ['ab'],
    ['a'.repeat(31)],
    ['-dr-cabrel'],
    ['dr--cabrel'],
    ['dr_cabrel'],
    ['dr.cabrel'],
    [''],
  ])('should reject the address %j on the username field', (username) => {
    const resultat = schemaOnboardingTerminer.safeParse({ username, palette: 'sauge' })

    expect(resultat.success).toBe(false)
    if (!resultat.success) expect(resultat.error.issues.every((issue) => issue.path[0] === 'username')).toBe(true)
  })

  it.each([['rose'], [''], ['TERRACOTTA'], [null]])('should reject the palette %j', (palette) => {
    expect(schemaOnboardingTerminer.safeParse({ username: 'dr-cabrel', palette }).success).toBe(false)
  })

  it('should reject unknown keys', () => {
    expect(schemaOnboardingTerminer.safeParse({ username: 'dr-cabrel', palette: 'sauge', publieeLe: '2020-01-01' }).success).toBe(false)
  })

  it('should require both fields', () => {
    expect(schemaOnboardingTerminer.safeParse({ username: 'dr-cabrel' }).success).toBe(false)
    expect(schemaOnboardingTerminer.safeParse({ palette: 'sauge' }).success).toBe(false)
  })
})

describe('schemaOnboardingGenerer et schemaGenerationIdParams', () => {
  it('should accept an empty body only', () => {
    expect(schemaOnboardingGenerer.safeParse({}).success).toBe(true)
    expect(schemaOnboardingGenerer.safeParse({ metier: 'Pirate' }).success).toBe(false)
    expect(schemaOnboardingGenerer.safeParse({ force: true }).success).toBe(false)
  })

  it('should accept a uuid and reject anything else (the route turns this into a 404)', () => {
    expect(schemaGenerationIdParams.safeParse({ id: randomUUID() }).success).toBe(true)
    for (const id of ['abc', '', '123', "' OR 1=1 --", '../etc', randomUUID().toUpperCase() + 'x']) {
      expect(schemaGenerationIdParams.safeParse({ id }).success).toBe(false)
    }
    expect(schemaGenerationIdParams.safeParse({ id: randomUUID(), autre: 1 }).success).toBe(false)
  })
})
