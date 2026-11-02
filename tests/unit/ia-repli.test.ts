import { describe, expect, it } from 'vitest'
import { schemaPropositionRepli } from '../../shared/schemas/ia'
import { ACCROCHE_MAX, BIO_MAX, METIER_MAX, VILLE_MAX } from '../../shared/vitrine'
import { ENTREE_ONBOARDING_DEMO } from './support/ia-fixtures'

// S8 §4.7 / CA34 : le repli est écrit dans le code, il est déterministe et n'invente rien.
// Une vitrine ne reste jamais vide, même quand le fournisseur est absent, en panne ou piégé.

const repli = () => import('../../server/services/ia/repli')

const TEXTE_NUMERIQUE = /\d/

function textesDe(resultat: { accroches: string[], presentation: string, services: Array<{ titre: string, description: string }> }): string[] {
  return [
    ...resultat.accroches,
    resultat.presentation,
    ...resultat.services.flatMap((service) => [service.titre, service.description]),
  ]
}

describe('repliOnboarding (CA34)', () => {
  it('should be deterministic: two calls on the same input give the same result', async () => {
    const { repliOnboarding } = await repli()

    expect(repliOnboarding(ENTREE_ONBOARDING_DEMO)).toEqual(repliOnboarding({ ...ENTREE_ONBOARDING_DEMO }))
  })

  it('should conform to schemaPropositionRepli (3 accroches, a presentation, 3 services)', async () => {
    const { repliOnboarding } = await repli()

    const resultat = repliOnboarding(ENTREE_ONBOARDING_DEMO)

    expect(schemaPropositionRepli.safeParse(resultat).success).toBe(true)
    expect(resultat.accroches).toHaveLength(3)
    expect(resultat.services).toHaveLength(3)
    expect(resultat.presentation.trim()).not.toBe('')
  })

  it('should write the three accroches of the specification (métier capitalised, city quoted)', async () => {
    const { repliOnboarding } = await repli()

    const { accroches } = repliOnboarding(ENTREE_ONBOARDING_DEMO)

    expect(accroches[0]).toBe('Cardiologue interventionnel à Douala, à votre écoute pour vous accompagner pas à pas.')
    expect(accroches[1]).toBe('Un accompagnement attentif et clair, pensé pour vous, à Douala.')
    expect(accroches[2]).toBe('Prenez rendez-vous simplement et avancez avec un professionnel à votre écoute.')
  })

  it('should introduce the professional in the first person with the lower-cased métier, the city and the country', async () => {
    const { repliOnboarding } = await repli()

    const { presentation } = repliOnboarding(ENTREE_ONBOARDING_DEMO)

    expect(presentation).toContain('Je suis cardiologue interventionnel à Douala (Cameroun).')
    expect(presentation).toContain('Sur cette vitrine, vous trouverez mes services.')
  })

  it('should keep an acronym métier as written (ORL is not « oRL »)', async () => {
    const { repliOnboarding } = await repli()

    const { presentation, accroches } = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier: 'ORL' })

    expect(presentation).toContain('Je suis ORL à Douala')
    expect(accroches[0]).toMatch(/^ORL à Douala,/)
  })

  it('should capitalise the first letter of the métier in the first accroche only', async () => {
    const { repliOnboarding } = await repli()

    const { accroches, presentation } = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier: 'coach de vie' })

    expect(accroches[0]).toMatch(/^Coach de vie à Douala,/)
    expect(presentation).toContain('Je suis coach de vie à Douala')
  })

  it('should offer the three generic services of the specification, with only closed-list values', async () => {
    const { repliOnboarding } = await repli()

    const { services } = repliOnboarding(ENTREE_ONBOARDING_DEMO)

    expect(services.map(({ titre, type, dureeMin, nbSeances }) => ({ titre, type, dureeMin, nbSeances }))).toEqual([
      { titre: 'Premier rendez-vous', type: 'rdv', dureeMin: 60, nbSeances: null },
      { titre: 'Rendez-vous de suivi', type: 'rdv', dureeMin: 45, nbSeances: null },
      { titre: 'Prestation sur mesure', type: 'devis', dureeMin: null, nbSeances: null },
    ])
    for (const service of services) expect(service.description.trim()).not.toBe('')
  })

  it('should contain no digit in any text, and no fact other than métier, city and country', async () => {
    const { repliOnboarding } = await repli()

    const textes = textesDe(repliOnboarding(ENTREE_ONBOARDING_DEMO))

    for (const texte of textes) expect(texte).not.toMatch(TEXTE_NUMERIQUE)
    const tout = textes.join(' ')
    expect(tout).not.toMatch(/diplôm|université|CHU|hôpital|clinique|certifi|prix|tarif|expérience|\bans\b/i)
  })

  it('should quote the city and the country of the input, not the demonstration ones', async () => {
    const { repliOnboarding } = await repli()

    const tout = textesDe(repliOnboarding({ titre: null, metier: 'Avocat', ville: 'Dakar', pays: 'Sénégal' })).join(' ')

    expect(tout).toContain('Dakar')
    expect(tout).toContain('Sénégal')
    expect(tout).not.toContain('Douala')
    expect(tout).not.toContain('Cameroun')
  })

  it('should never carry the first name or last name (they are not part of the input)', async () => {
    const { repliOnboarding } = await repli()

    const json = JSON.stringify(repliOnboarding(ENTREE_ONBOARDING_DEMO))

    expect(json).not.toContain('Cabrel')
    expect(json).not.toContain('Nguesso')
  })

  it('should stay conform with a métier of 80 characters (CA34)', async () => {
    const { repliOnboarding } = await repli()
    const metier = 'M'.repeat(METIER_MAX)

    const resultat = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier })

    expect(schemaPropositionRepli.safeParse(resultat).success).toBe(true)
  })

  it('should stay conform with a métier AND a city of 80 characters each (the first accroche must not overflow 160 characters)', async () => {
    const { repliOnboarding } = await repli()

    const resultat = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier: 'M'.repeat(METIER_MAX), ville: 'V'.repeat(VILLE_MAX) })

    expect(schemaPropositionRepli.safeParse(resultat).success).toBe(true)
    for (const accroche of resultat.accroches) expect(accroche.length).toBeLessThanOrEqual(ACCROCHE_MAX)
    expect(resultat.presentation.length).toBeLessThanOrEqual(BIO_MAX)
  })

  it('should stay conform with the longest country label', async () => {
    const { repliOnboarding } = await repli()

    const resultat = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier: 'M'.repeat(METIER_MAX), ville: 'V'.repeat(VILLE_MAX), pays: 'République démocratique du Congo' })

    expect(schemaPropositionRepli.safeParse(resultat).success).toBe(true)
  })

  it('should not interpret regular-expression or replacement patterns in the métier', async () => {
    const { repliOnboarding } = await repli()

    const resultat = repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, metier: 'Coach $& (pro) $1 \\d+', ville: 'Douala' })

    expect(resultat.accroches[0]).toBe('Coach $& (pro) $1 \\d+ à Douala, à votre écoute pour vous accompagner pas à pas.')
  })

  it('should return the text of the input untouched when the title is null', async () => {
    const { repliOnboarding } = await repli()

    expect(schemaPropositionRepli.safeParse(repliOnboarding({ ...ENTREE_ONBOARDING_DEMO, titre: null })).success).toBe(true)
  })
})

describe('repliAmelioration (CA49)', () => {
  it('should hand back the original text unchanged and flag it as not modified', async () => {
    const { repliAmelioration } = await repli()

    const resultat = repliAmelioration({ champ: 'bio', texte: 'Mon texte d’origine, tel quel.', objectif: 'reformuler' })

    expect(resultat).toEqual({ champ: 'bio', avant: 'Mon texte d’origine, tel quel.', apres: 'Mon texte d’origine, tel quel.', modifie: false })
  })

  it.each(['bio', 'accroche'] as const)('should keep the field %s', async (champ) => {
    const { repliAmelioration } = await repli()

    expect(repliAmelioration({ champ, texte: 'Un texte assez long pour passer.', objectif: 'reformuler' }).champ).toBe(champ)
  })
})
