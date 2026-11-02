import { describe, expect, it } from 'vitest'
import { isReserved } from '../../shared/reserved'
import { hasValidUsernameFormat } from '../../server/utils/username'
import { IDENTITE_DEMO, progressionIdentite, progressionVide } from './support/ia-fixtures'

// S8 §0 #68 / §6 : règles pures de l'inscription guidée. L'étape de reprise n'est jamais stockée, elle se
// DÉDUIT des données : identité incomplète → 1 ; pas de photo → 2 ; proposition non validée → 3 ; sinon 4.
// Import paresseux : tant que le module n'existe pas, chaque test échoue pour la bonne raison.

const regles = () => import('../../server/services/onboarding-regles')

const PHOTO = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const VALIDEE = new Date('2026-11-02T10:05:00.000Z')

const avecPhoto = (extra = {}) => progressionIdentite({ photoMediaId: PHOTO, ...extra })
const avecProposition = (extra = {}) => avecPhoto({
  accroche: 'Une accroche choisie.',
  presentation: 'Une présentation.',
  servicesProposes: [],
  propositionValideeLe: VALIDEE,
  ...extra,
})

describe('computeEtapeReprise', () => {
  it('should start at step 1 for an empty progression', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(progressionVide())).toBe(1)
  })

  it.each(['prenom', 'nom', 'metier', 'ville', 'pays'] as const)('should stay at step 1 when %s is missing', async (champ) => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecPhoto({ [champ]: null }))).toBe(1)
  })

  it.each(['prenom', 'nom', 'metier', 'ville', 'pays'] as const)('should treat a blank %s as missing', async (champ) => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecPhoto({ [champ]: '   ' }))).toBe(1)
    expect(computeEtapeReprise(avecPhoto({ [champ]: '' }))).toBe(1)
  })

  it('should not require a title (« Sans titre » is a valid choice)', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(progressionIdentite({ titre: null }))).toBe(2)
  })

  it('should go to step 2 once the identity is complete and there is no photo', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(progressionIdentite())).toBe(2)
  })

  it('should go to step 3 with a photo and a proposition that is not validated', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecPhoto())).toBe(3)
    expect(computeEtapeReprise(avecPhoto({ generationId: crypto.randomUUID() }))).toBe(3)
  })

  it('should go to step 4 once the proposition is validated', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecProposition())).toBe(4)
  })

  it('should fall back to step 2 when the photo disappears after the proposition was validated', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecProposition({ photoMediaId: null }))).toBe(2)
  })

  it('should fall back to step 1 when the identity is erased, whatever comes after', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecProposition({ metier: null }))).toBe(1)
  })

  it('should only look at the validation date, not at the loose draft fields', async () => {
    const { computeEtapeReprise } = await regles()

    expect(computeEtapeReprise(avecPhoto({ accroche: 'x', presentation: 'y', servicesProposes: [] }))).toBe(3)
  })

  it('should be a pure function that does not mutate its input', async () => {
    const { computeEtapeReprise } = await regles()
    const entree = Object.freeze(avecProposition())

    expect(computeEtapeReprise(entree)).toBe(4)
    expect(computeEtapeReprise(entree)).toBe(4)
  })
})

describe('computeManquants', () => {
  it('should list everything for an absent progression', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(null)).toEqual(['identite', 'photo', 'proposition'])
  })

  it('should list everything for an empty progression', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(progressionVide())).toEqual(['identite', 'photo', 'proposition'])
  })

  it('should list nothing for a complete progression', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(avecProposition())).toEqual([])
  })

  it('should list the photo only (CA42)', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(avecProposition({ photoMediaId: null }))).toEqual(['photo'])
  })

  it('should list the proposition only (CA42)', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(avecPhoto())).toEqual(['proposition'])
  })

  it('should list the identity only', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(avecProposition({ ville: null }))).toEqual(['identite'])
  })

  it('should keep the canonical order whatever the combination', async () => {
    const { computeManquants } = await regles()

    expect(computeManquants(avecProposition({ ville: null, photoMediaId: null, propositionValideeLe: null }))).toEqual([
      'identite',
      'photo',
      'proposition',
    ])
    expect(computeManquants(avecPhoto({ pays: null }))).toEqual(['identite', 'proposition'])
    expect(computeManquants(progressionIdentite())).toEqual(['photo', 'proposition'])
  })
})

describe('computeUsernameSuggere', () => {
  it('should suggest dr-cabrel for (dr, Cabrel, Nguesso)', async () => {
    const { computeUsernameSuggere } = await regles()

    expect(computeUsernameSuggere(IDENTITE_DEMO)).toBe('dr-cabrel')
  })

  it('should answer an empty string while the identity is incomplete', async () => {
    const { computeUsernameSuggere } = await regles()

    expect(computeUsernameSuggere({ titre: null, prenom: null, nom: null, metier: null, ville: null, pays: null })).toBe('')
    expect(computeUsernameSuggere({ ...IDENTITE_DEMO, prenom: null })).toBe('')
    expect(computeUsernameSuggere({ ...IDENTITE_DEMO, ville: null })).toBe('')
  })

  it('should transliterate accents and lower-case the result', async () => {
    const { computeUsernameSuggere } = await regles()

    expect(computeUsernameSuggere({ ...IDENTITE_DEMO, prenom: 'Éloïse' })).toBe('dr-eloise')
  })

  it('should build the suggestion from the first name when there is no title', async () => {
    const { computeUsernameSuggere } = await regles()

    expect(computeUsernameSuggere({ ...IDENTITE_DEMO, titre: null })).toContain('cabrel')
  })

  it.each([
    ['a reserved word', { titre: null, prenom: 'Admin' }],
    ['another reserved word', { titre: null, prenom: 'Contact' }],
    ['a very long first name', { prenom: 'a'.repeat(60) }],
    ['a first name with punctuation', { prenom: "Jean-Pierre N'Guessan" }],
    ['a first name with only symbols', { prenom: '***' }],
    ['a first name with spaces', { prenom: 'Marie Claire' }],
    ['a short first name', { titre: null, prenom: 'Al' }],
  ])('should never suggest an address that the studio would refuse (%s)', async (_nom, surcharge) => {
    const { computeUsernameSuggere } = await regles()

    const suggestion = computeUsernameSuggere({ ...IDENTITE_DEMO, ...surcharge })

    expect(suggestion === '' || (hasValidUsernameFormat(suggestion) && !isReserved(suggestion))).toBe(true)
  })
})

describe('détection d’un changement d’identité utile à l’IA', () => {
  const identite = { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'CM' }

  it.each([
    ['titre', { titre: 'pr' }],
    ['titre vers « sans titre »', { titre: null }],
    ['metier', { metier: 'Pédiatre' }],
    ['ville', { ville: 'Yaoundé' }],
    ['pays', { pays: 'SN' }],
  ])('should reset the proposition when %s changes', async (_nom, changement) => {
    const { identiteIaModifiee } = await regles()

    expect(identiteIaModifiee(identite, { ...identite, ...changement })).toBe(true)
  })

  it.each([
    ['prénom', { prenom: 'Autre' }],
    ['nom', { nom: 'Autre' }],
    ['prénom et nom', { prenom: 'Autre', nom: 'Autrement' }],
    ['rien', {}],
  ])('should keep the proposition when only %s changes (the names never reach the provider)', async (_nom, changement) => {
    const { identiteIaModifiee } = await regles()

    expect(identiteIaModifiee(identite, { ...identite, ...changement })).toBe(false)
  })

  it('should consider a first save (nothing before) as a change', async () => {
    const { identiteIaModifiee } = await regles()

    expect(identiteIaModifiee({ titre: null, prenom: null, nom: null, metier: null, ville: null, pays: null }, identite)).toBe(true)
  })
})
