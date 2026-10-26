import { describe, expect, it } from 'vitest'

// U13 — règles pures des services (server/services/services-regles.ts) : aucune base, aucun réseau.
// Imports paresseux : tant que le module n'existe pas (phase RED), chaque test échoue pour la bonne raison.
//
// CONTRAT ATTENDU (à respecter en GREEN) :
//   normalizeServiceState(etat, patch)  -> état fusionné ET normalisé (R5), nouvel objet, entrées intactes
//   checkServiceCoherence(etat)         -> Record<champ, string[]> ; {} si cohérent (R1 à R4, R6)
//   resolveEnVedette({ demande, actif, autresEnVedette: number, max }) -> boolean | 'COMPLET'
//   computeALaUne(visibles, max)        -> sous-ensemble ordonné (mêmes objets), vedettes sinon les `max` premiers
//   computeCompteurs(lignes, max)       -> { total, visibles, enVedette, vedetteMax }
const regles = () => import('../../server/services/services-regles')

interface Etat {
  type: string
  nbSeances: number | null
  rythme: string | null
  dureeMin: number | null
  tarif: string
  prixMontant: number | null
  prixDevise: string | null
  paiementMode: string | null
  paiementInstructions: string | null
  actif: boolean
  enVedette: boolean
}

const RDV_GRATUIT: Etat = {
  type: 'rdv',
  nbSeances: null,
  rythme: null,
  dureeMin: 30,
  tarif: 'gratuit',
  prixMontant: null,
  prixDevise: null,
  paiementMode: null,
  paiementInstructions: null,
  actif: true,
  enVedette: false,
}

const RDV_PAYANT: Etat = {
  ...RDV_GRATUIT,
  tarif: 'payant',
  prixMontant: 15000,
  prixDevise: 'XAF',
  paiementMode: 'sur_place',
  paiementInstructions: 'Espèces',
}

const ACCOMPAGNEMENT: Etat = { ...RDV_PAYANT, type: 'accompagnement', nbSeances: 6, rythme: 'hebdomadaire' }

describe('normalizeServiceState (U13, R5)', () => {
  it('should return the state unchanged for an empty patch', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_PAYANT, {})).toEqual(RDV_PAYANT)
  })

  it('should merge the patch over the state', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_PAYANT, { dureeMin: 60, prixMontant: 20000 })).toEqual({ ...RDV_PAYANT, dureeMin: 60, prixMontant: 20000 })
  })

  it('should ignore patch keys whose value is undefined', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_PAYANT, { dureeMin: undefined, enVedette: undefined })).toEqual(RDV_PAYANT)
  })

  it('should not mutate its inputs and return a new object', async () => {
    const { normalizeServiceState } = await regles()
    const etat = Object.freeze({ ...RDV_PAYANT })
    const patch = Object.freeze({ tarif: 'gratuit' })

    const resultat = normalizeServiceState(etat, patch)

    expect(resultat).not.toBe(etat)
    expect(etat).toEqual(RDV_PAYANT)
  })

  it('should clear sessions and rhythm when the type is not accompagnement', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_GRATUIT, { nbSeances: 6, rythme: 'hebdomadaire' })).toMatchObject({ nbSeances: null, rythme: null })
    expect(normalizeServiceState(ACCOMPAGNEMENT, { type: 'rdv' })).toMatchObject({ type: 'rdv', nbSeances: null, rythme: null })
    expect(normalizeServiceState(ACCOMPAGNEMENT, { type: 'atelier' })).toMatchObject({ nbSeances: null, rythme: null })
  })

  it('should keep sessions and rhythm for an accompagnement', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(ACCOMPAGNEMENT, {})).toMatchObject({ nbSeances: 6, rythme: 'hebdomadaire' })
    expect(normalizeServiceState(RDV_PAYANT, { type: 'accompagnement', nbSeances: 4, rythme: 'mensuel' })).toMatchObject({ nbSeances: 4, rythme: 'mensuel' })
  })

  it.each(['gratuit', 'devis'])('should clear price, currency, payment mode and instructions when the tarif is %s', async (tarif) => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_PAYANT, { tarif })).toMatchObject({
      tarif,
      prixMontant: null,
      prixDevise: null,
      paiementMode: null,
      paiementInstructions: null,
    })
  })

  it('should default the payment mode to sur_place for a paid service without one, and keep an existing one', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_GRATUIT, { tarif: 'payant', prixMontant: 1000, prixDevise: 'EUR' })).toMatchObject({ paiementMode: 'sur_place' })
    expect(normalizeServiceState(RDV_PAYANT, { paiementMode: 'au_choix' })).toMatchObject({ paiementMode: 'au_choix' })
  })

  it('should NOT invent a price for a paid service that has none (that is a coherence error, not a normalisation)', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_GRATUIT, { tarif: 'payant' })).toMatchObject({ prixMontant: null, prixDevise: null })
  })

  it('should withdraw the vedette of a service that becomes masked when enVedette is not sent', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState({ ...RDV_GRATUIT, enVedette: true }, { actif: false })).toMatchObject({ actif: false, enVedette: false })
  })

  it('should keep an explicit enVedette true next to actif false so that the coherence check can report it (R6)', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState(RDV_GRATUIT, { actif: false, enVedette: true })).toMatchObject({ actif: false, enVedette: true })
  })

  it('should keep an explicit enVedette true on an already masked service (R6)', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState({ ...RDV_GRATUIT, actif: false }, { enVedette: true })).toMatchObject({ actif: false, enVedette: true })
  })

  it('should leave the vedette alone when the service stays visible', async () => {
    const { normalizeServiceState } = await regles()

    expect(normalizeServiceState({ ...RDV_GRATUIT, enVedette: true }, {})).toMatchObject({ actif: true, enVedette: true })
  })
})

describe('checkServiceCoherence (U13, R1 à R4 et R6)', () => {
  it.each([
    ['un rendez-vous gratuit', RDV_GRATUIT],
    ['un rendez-vous payant', RDV_PAYANT],
    ['un accompagnement complet', ACCOMPAGNEMENT],
    ['un atelier payant', { ...RDV_PAYANT, type: 'atelier' }],
    ['un devis sans durée', { ...RDV_GRATUIT, type: 'devis', tarif: 'devis', dureeMin: null }],
    ['un devis avec durée', { ...RDV_GRATUIT, type: 'devis', tarif: 'devis', dureeMin: 40 }],
    ['un service masqué hors vedette', { ...RDV_GRATUIT, actif: false, enVedette: false }],
    ['une vedette visible', { ...RDV_GRATUIT, enVedette: true }],
  ])('should report nothing for %s', async (_libelle, etat) => {
    const { checkServiceCoherence } = await regles()

    expect(checkServiceCoherence(etat)).toEqual({})
  })

  it.each(['rdv', 'atelier', 'accompagnement'])('should require a duration for the type %s (R1)', async (type) => {
    const { checkServiceCoherence } = await regles()
    const etat = { ...ACCOMPAGNEMENT, type, nbSeances: type === 'accompagnement' ? 6 : null, rythme: null, dureeMin: null }

    const erreurs = checkServiceCoherence(etat)

    expect(Object.keys(erreurs)).toEqual(['dureeMin'])
    expect(erreurs.dureeMin.length).toBeGreaterThan(0)
    expect(erreurs.dureeMin.every((m) => m.length > 0)).toBe(true)
  })

  it('should require the number of sessions for an accompagnement (R2)', async () => {
    const { checkServiceCoherence } = await regles()

    expect(Object.keys(checkServiceCoherence({ ...ACCOMPAGNEMENT, nbSeances: null }))).toEqual(['nbSeances'])
  })

  it('should not require a rhythm for an accompagnement (R2)', async () => {
    const { checkServiceCoherence } = await regles()

    expect(checkServiceCoherence({ ...ACCOMPAGNEMENT, rythme: null })).toEqual({})
  })

  it.each(['payant', 'gratuit'])('should force the tarif devis on a devis type, whatever the tarif %s (R3)', async (tarif) => {
    const { checkServiceCoherence } = await regles()
    const etat = { ...RDV_GRATUIT, type: 'devis', dureeMin: null, tarif, prixMontant: tarif === 'payant' ? 1000 : null, prixDevise: tarif === 'payant' ? 'XAF' : null, paiementMode: tarif === 'payant' ? 'sur_place' : null }

    expect(Object.keys(checkServiceCoherence(etat))).toEqual(['tarif'])
  })

  it('should require a price and a currency for a paid service (R4)', async () => {
    const { checkServiceCoherence } = await regles()

    expect(Object.keys(checkServiceCoherence({ ...RDV_PAYANT, prixMontant: null }))).toEqual(['prixMontant'])
    expect(Object.keys(checkServiceCoherence({ ...RDV_PAYANT, prixDevise: null }))).toEqual(['prixDevise'])
    expect(Object.keys(checkServiceCoherence({ ...RDV_PAYANT, prixMontant: null, prixDevise: null })).sort()).toEqual(['prixDevise', 'prixMontant'])
  })

  it('should refuse a masked service in vedette with the exact French message (R6)', async () => {
    const { checkServiceCoherence } = await regles()

    const erreurs = checkServiceCoherence({ ...RDV_GRATUIT, actif: false, enVedette: true })

    expect(erreurs).toEqual({ enVedette: ['Un service masqué ne peut pas être en vedette.'] })
  })

  it('should accumulate the errors of several fields at once', async () => {
    const { checkServiceCoherence } = await regles()
    const etat = { ...RDV_GRATUIT, type: 'accompagnement', dureeMin: null, tarif: 'payant', actif: false, enVedette: true }

    const erreurs = checkServiceCoherence(etat)

    expect(Object.keys(erreurs).sort()).toEqual(['dureeMin', 'enVedette', 'nbSeances', 'prixDevise', 'prixMontant'])
  })

  it('should treat a duration of 0 as a duration (0 is not "missing"; the bounds are the schema job)', async () => {
    const { checkServiceCoherence } = await regles()

    expect(checkServiceCoherence({ ...RDV_GRATUIT, dureeMin: 0 })).toEqual({})
  })
})

describe('resolveEnVedette (U13, R7)', () => {
  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [4, false],
  ])('should decide automatically (demande absente) with %i other vedettes on 3: %j', async (autresEnVedette, attendu) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: undefined, actif: true, autresEnVedette, max: 3 })).toBe(attendu)
  })

  it('should never choose a vedette automatically for a masked service', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: undefined, actif: false, autresEnVedette: 0, max: 3 })).toBe(false)
  })

  it('should honour an explicit false even when there is room', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: false, actif: true, autresEnVedette: 0, max: 3 })).toBe(false)
    expect(resolveEnVedette({ demande: false, actif: true, autresEnVedette: 3, max: 3 })).toBe(false)
  })

  it.each([0, 1, 2])('should accept an explicit true with %i other vedettes on 3', async (autresEnVedette) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette, max: 3 })).toBe(true)
  })

  it.each([3, 4, 10])('should answer COMPLET for an explicit true with %i other vedettes on 3', async (autresEnVedette) => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette, max: 3 })).toBe('COMPLET')
  })

  it('should use the max it receives (not a hard-coded 3)', async () => {
    const { resolveEnVedette } = await regles()

    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette: 1, max: 1 })).toBe('COMPLET')
    expect(resolveEnVedette({ demande: true, actif: true, autresEnVedette: 4, max: 5 })).toBe(true)
    expect(resolveEnVedette({ demande: undefined, actif: true, autresEnVedette: 0, max: 0 })).toBe(false)
  })
})

describe('computeALaUne (U13, R11)', () => {
  const ligne = (slug: string, enVedette = false) => ({ slug, enVedette })

  it('should return the vedettes in order when there are some', async () => {
    const { computeALaUne } = await regles()
    const visibles = [ligne('a'), ligne('b', true), ligne('c'), ligne('d', true), ligne('e')]

    expect(computeALaUne(visibles, 3).map((l) => l.slug)).toEqual(['b', 'd'])
  })

  it('should fall back to the first three visible services when none is a vedette', async () => {
    const { computeALaUne } = await regles()
    const visibles = ['a', 'b', 'c', 'd', 'e'].map((s) => ligne(s))

    expect(computeALaUne(visibles, 3).map((l) => l.slug)).toEqual(['a', 'b', 'c'])
  })

  it('should return every visible service when there are fewer than the max and no vedette', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne([ligne('a'), ligne('b')], 3).map((l) => l.slug)).toEqual(['a', 'b'])
  })

  it('should return an empty list for no visible service', async () => {
    const { computeALaUne } = await regles()

    expect(computeALaUne([], 3)).toEqual([])
  })

  it('should never return more than max entries, even if the data holds too many vedettes', async () => {
    const { computeALaUne } = await regles()
    const visibles = ['a', 'b', 'c', 'd', 'e'].map((s) => ligne(s, true))

    expect(computeALaUne(visibles, 3).map((l) => l.slug)).toEqual(['a', 'b', 'c'])
  })

  it('should return the same objects it received (no copy) and leave the input untouched', async () => {
    const { computeALaUne } = await regles()
    const visibles = [ligne('a', true), ligne('b')]
    const copie = structuredClone(visibles)

    const resultat = computeALaUne(visibles, 3)

    expect(resultat[0]).toBe(visibles[0])
    expect(visibles).toEqual(copie)
  })
})

describe('computeCompteurs (U13)', () => {
  it('should count total, visible and vedette services and carry the max', async () => {
    const { computeCompteurs } = await regles()
    const lignes = [
      { actif: true, enVedette: true },
      { actif: true, enVedette: true },
      { actif: true, enVedette: true },
      { actif: true, enVedette: false },
      { actif: true, enVedette: false },
      { actif: false, enVedette: false },
    ]

    expect(computeCompteurs(lignes, 3)).toEqual({ total: 6, visibles: 5, enVedette: 3, vedetteMax: 3 })
  })

  it('should answer zeros for no service', async () => {
    const { computeCompteurs } = await regles()

    expect(computeCompteurs([], 3)).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
  })

  it('should count only masked services as total, not as visible', async () => {
    const { computeCompteurs } = await regles()

    expect(computeCompteurs([{ actif: false, enVedette: false }, { actif: false, enVedette: false }], 3)).toEqual({
      total: 2,
      visibles: 0,
      enVedette: 0,
      vedetteMax: 3,
    })
  })
})
