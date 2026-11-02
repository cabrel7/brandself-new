import { describe, expect, it } from 'vitest'
import { ACCROCHE_MAX, BIO_MAX } from '../../shared/vitrine'
import {
  ENTREE_ONBOARDING_DEMO,
  motsSurs,
  phraseDeMots,
  propositionAccrochesCourtes,
  propositionFaitsInventes,
  propositionValide,
  texteDeMots,
} from './support/ia-fixtures'
import type { PropositionFixture } from './support/ia-fixtures'

// S8 §4.5 / CA24 / CA25 : la sortie du fournisseur n'est jamais crue sur parole.
// validerSortie = schéma Zod (longueurs, cohérence) puis vérification déterministe des faits.
// `verifierFaits` n'a pas de type de retour fixé par la spec : il est éprouvé ici à travers `validerSortie`,
// qui est le contrat observable ({ ok: true, valeur } | { ok: false, code }).

const verification = () => import('../../server/services/ia/verification')

const ORIGINAL_BIO = "Je suis cardiologue à Douala. J'accompagne mes patients avec attention."
const ENTREE_AMELIORER = {
  champ: 'bio' as const,
  objectif: 'reformuler' as const,
  texte: ORIGINAL_BIO,
  contexte: { titre: 'Dr', metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'Cameroun' },
}

async function valider(donnees: unknown, entree: object = ENTREE_ONBOARDING_DEMO) {
  const { validerSortie } = await verification()
  return validerSortie('onboarding_vitrine', donnees, entree)
}

function proposition(surcharges: Partial<PropositionFixture> = {}): PropositionFixture {
  return { ...propositionValide(), ...surcharges }
}

/** Complète un fragment (sans point final) jusqu'à `total` mots avec des mots sûrs. */
function completer(fragment: string, total: number): string {
  const deja = fragment.trim().split(/\s+/).length
  return `${fragment} ${motsSurs(total - deja, 4).join(' ')}.`
}

/** Place un fragment dans l'accroche n°1, la présentation ou la description du service n°1. */
const EMPLACEMENTS = {
  accroche: (fragment: string): PropositionFixture => proposition({
    accroches: [completer(fragment, 12), propositionValide().accroches[1]!, propositionValide().accroches[2]!],
  }),
  presentation: (fragment: string): PropositionFixture => proposition({
    presentation: `${fragment}. ${texteDeMots(85, 3)}`,
  }),
  description: (fragment: string): PropositionFixture => {
    const [premier, ...reste] = propositionValide().services
    return proposition({ services: [{ ...premier!, description: completer(fragment, 14) }, ...reste] })
  },
  titre: (fragment: string): PropositionFixture => {
    const [premier, ...reste] = propositionValide().services
    return proposition({ services: [{ ...premier!, titre: fragment }, ...reste] })
  },
}

describe('validerSortie : proposition d’inscription', () => {
  it('should accept the reference proposition and return it as the validated value', async () => {
    const resultat = await valider(propositionValide())

    expect(resultat).toEqual({ ok: true, valeur: propositionValide() })
  })

  it('should accept the maquette sentence « Cardiologue interventionnel à Douala, j’accompagne… après une hospitalisation. » (no false positive)', async () => {
    const maquette = 'Cardiologue interventionnel à Douala, j’accompagne votre cœur avec attention après une hospitalisation.'
    const [, deuxieme, troisieme] = propositionValide().accroches

    const resultat = await valider(proposition({ accroches: [maquette, deuxieme!, troisieme!] }))

    expect(resultat).toMatchObject({ ok: true })
  })

  it.each([
    ['accroche de 9 mots', proposition({ accroches: [phraseDeMots(9), phraseDeMots(12, 12), phraseDeMots(12, 24)] })],
    ['accroche de 16 mots', proposition({ accroches: [phraseDeMots(16), phraseDeMots(12, 12), phraseDeMots(12, 24)] })],
    ['présentation de 79 mots', proposition({ presentation: texteDeMots(79) })],
    ['présentation de 261 mots', proposition({ presentation: texteDeMots(261) })],
    ['deux services seulement', proposition({ services: propositionValide().services.slice(0, 2) })],
    ['deux accroches identiques', proposition({ accroches: [phraseDeMots(12), phraseDeMots(12), phraseDeMots(12, 24)] })],
    [
      'accompagnement sans nombre de séances',
      proposition({ services: [{ ...propositionValide().services[1]!, nbSeances: null }, propositionValide().services[0]!, propositionValide().services[2]!] }),
    ],
    [
      'devis avec une durée',
      proposition({ services: [{ ...propositionValide().services[2]!, dureeMin: 60 }, propositionValide().services[0]!, propositionValide().services[1]!] }),
    ],
  ])('should reject %s with the code sortie_invalide (CA25)', async (_nom, donnees) => {
    expect(await valider(donnees)).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it.each([
    ['accroche de 10 mots', proposition({ accroches: [phraseDeMots(10), phraseDeMots(12, 12), phraseDeMots(12, 24)] })],
    ['accroche de 15 mots', proposition({ accroches: [phraseDeMots(15), phraseDeMots(12, 12), phraseDeMots(12, 24)] })],
    ['présentation de 80 mots', proposition({ presentation: texteDeMots(80) })],
    ['présentation de 260 mots', proposition({ presentation: texteDeMots(260) })],
  ])('should accept the exact bound: %s (CA25)', async (_nom, donnees) => {
    expect(await valider(donnees)).toMatchObject({ ok: true })
  })

  it('should reject a 260-word presentation that exceeds the character limit of the vitrine', async () => {
    const trop = Array.from({ length: 200 }, () => 'bienveillamment').join(' ')

    expect(trop.length).toBeGreaterThan(BIO_MAX)
    expect(await valider(proposition({ presentation: trop }))).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it.each([null, undefined, 'du texte libre', 42, true, [], {}, [propositionValide()]])(
    'should answer sortie_invalide, never throw, on the non-proposition output %j',
    async (donnees) => {
      expect(await valider(donnees)).toEqual({ ok: false, code: 'sortie_invalide' })
    },
  )

  it('should reject a proposition carrying an extra field the provider was not asked for', async () => {
    expect(await valider({ ...propositionValide(), prix: 15000 })).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it('should reject the rendering of a refusal sentence in place of the proposition', async () => {
    const refus = { texte: 'Je ne peux pas répondre à cette demande.' }

    expect(await valider(refus)).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it('should reject the proposition the fake provider builds in « invalide » mode (accroches of 5 words)', async () => {
    expect(await valider(propositionAccrochesCourtes())).toEqual({ ok: false, code: 'sortie_invalide' })
  })
})

describe('validerSortie : aucun fait inventé (CA24)', () => {
  const FAITS_INVENTES = [
    "J'ai 15 ans d'expérience",
    "Diplômé de l'Université de Yaoundé",
    "J'exerce à Paris",
    "J'ai suivi plus de 2000 patients",
    "J'ai travaillé au CHU de Douala",
  ]

  describe.each(Object.keys(EMPLACEMENTS) as Array<keyof typeof EMPLACEMENTS>)('dans %s', (emplacement) => {
    it.each(FAITS_INVENTES)('should reject the invented fact %j with the code faits_inventes', async (fait) => {
      const fragment = emplacement === 'titre' ? fait.split(' ').slice(0, 8).join(' ') : fait

      expect(await valider(EMPLACEMENTS[emplacement](fragment))).toEqual({ ok: false, code: 'faits_inventes' })
    })
  })

  it('should reject the whole output of the fake provider in « invente » mode', async () => {
    expect(await valider(propositionFaitsInventes())).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it.each([
    ['trente ans de pratique', 'Je vous accompagne après trente ans de pratique'],
    ['quinze années', 'Je vous écoute avec quinze années de recul'],
    ['cinquante patients', 'Je suis auprès de cinquante patients'],
    ['vingt clients', 'Je suis auprès de vingt clients'],
    ['cent clients', 'Je suis auprès de cent clients'],
  ])('should reject the spelled-out number « %s »', async (_nom, fait) => {
    expect(await valider(EMPLACEMENTS.presentation(fait))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it.each([
    ['one digit', 'Je reçois 3 patients par heure'],
    ['a year', 'Je vous accueille en 2024'],
    ['a percentage', 'Je suis à 100% avec vous'],
    ['a decimal', 'Je vous consacre 1.5 heures'],
    ['a digit stuck to a unit', 'Je vous consacre 30min'],
  ])('should reject %s that is absent from the source data', async (_nom, fait) => {
    expect(await valider(EMPLACEMENTS.presentation(fait))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it.each([
    'diplômé', 'Diplôme', 'doctorat', 'Master', 'licence', 'certifié', 'agréé', 'lauréat', 'ancien',
    'membre de', 'université', 'faculté', 'école', 'institut', 'CHU', 'hôpital', 'clinique',
    "ans d'expérience", "années d'expérience", 'depuis', 'prix', 'récompense', 'primé',
  ])('should reject the sensitive word %j when the sources do not contain it', async (mot) => {
    const fait = `Je suis ${mot} auprès de vous`

    expect(await valider(EMPLACEMENTS.presentation(fait))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should reject the sensitive words whatever their case', async () => {
    expect(await valider(EMPLACEMENTS.presentation('Je suis DIPLÔMÉ auprès de vous'))).toEqual({ ok: false, code: 'faits_inventes' })
    expect(await valider(EMPLACEMENTS.presentation('Je suis passé par une UNIVERSITÉ'))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should reject a sensitive word written without its accent', async () => {
    expect(await valider(EMPLACEMENTS.presentation('Je suis diplome auprès de vous'))).toEqual({ ok: false, code: 'faits_inventes' })
    expect(await valider(EMPLACEMENTS.presentation('Je suis passé par une universite'))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should reject a capitalised place or name that is not in the source data', async () => {
    for (const fait of ['Je consulte à Yaoundé', 'Je travaille avec Marie', 'Je suis installé au Sénégal']) {
      expect(await valider(EMPLACEMENTS.presentation(fait)), fait).toEqual({ ok: false, code: 'faits_inventes' })
    }
  })

  it('should accept the city, the country and the title of the source data in the text', async () => {
    for (const fait of ['Je consulte à Douala', 'Je suis installé au Cameroun', 'Je suis le Dr de votre région']) {
      expect(await valider(EMPLACEMENTS.presentation(fait)), fait).toMatchObject({ ok: true })
    }
  })

  it('should accept a digit or a sensitive word that comes from the source data', async () => {
    const entree = { ...ENTREE_ONBOARDING_DEMO, metier: 'Coach 360 et formateur en université' }

    expect(await valider(EMPLACEMENTS.presentation('Je suis coach 360 et formateur en université'), entree)).toMatchObject({ ok: true })
    // Sans ces sources, la même phrase est refusée.
    expect(await valider(EMPLACEMENTS.presentation('Je suis coach 360 et formateur en université'))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it.each(['Brandself', 'WhatsApp'])('should allow the whitelisted proper noun %s mid-sentence', async (nom) => {
    expect(await valider(EMPLACEMENTS.presentation(`Vous pouvez me joindre par ${nom} sans souci`))).toMatchObject({ ok: true })
  })

  it('should not take the first word of a sentence, a paragraph or a question for an invented name', async () => {
    const presentation = `Comment aller mieux ? Je vous écoute avec soin.\n\nVoici ma méthode ! Elle est simple et claire. ${texteDeMots(80)}`

    expect(await valider(proposition({ presentation }))).toMatchObject({ ok: true })
  })

  it('should not take a quantity word without a counted noun for an invented figure', async () => {
    // « deux fois » n'est pas « deux ans / patients / clients » : pas de faux positif.
    expect(await valider(EMPLACEMENTS.presentation('Je vous revois deux fois par mois'))).toMatchObject({ ok: true })
  })

  it('should treat the typographic and the straight apostrophe the same way', async () => {
    expect(await valider(EMPLACEMENTS.presentation('J’ai 15 ans d’expérience'))).toEqual({ ok: false, code: 'faits_inventes' })
    expect(await valider(EMPLACEMENTS.presentation("J'ai 15 ans d'expérience"))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should prefer sortie_invalide over faits_inventes when the shape is wrong (shape is checked first)', async () => {
    const donnees = proposition({ accroches: [completer("J'ai 15 ans d'expérience", 5), phraseDeMots(12, 12), phraseDeMots(12, 24)] })

    expect(await valider(donnees)).toEqual({ ok: false, code: 'sortie_invalide' })
  })
})

describe('validerSortie : amélioration d’un texte', () => {
  async function ameliorer(texte: unknown, entree: object = ENTREE_AMELIORER) {
    const { validerSortie } = await verification()
    return validerSortie('ameliorer_texte', texte, entree)
  }

  it('should accept a reformulation without new fact', async () => {
    const donnees = { texte: "Cardiologue à Douala, j'accompagne mes patients avec attention et clarté." }

    expect(await ameliorer(donnees)).toEqual({ ok: true, valeur: donnees })
  })

  it('should accept the context values (métier, ville, country) in the reformulation', async () => {
    const donnees = { texte: 'Cardiologue interventionnel au Cameroun, je suis à Douala pour vous écouter.' }

    expect(await ameliorer(donnees)).toMatchObject({ ok: true })
  })

  it('should keep a fact that was already in the original text', async () => {
    const entree = { ...ENTREE_AMELIORER, texte: 'Diplômé en médecine, je vous accompagne avec 12 ans de recul.' }

    expect(await ameliorer({ texte: 'Je vous accompagne avec 12 ans de recul, diplômé en médecine.' }, entree)).toMatchObject({ ok: true })
  })

  it.each([
    ['a new number', 'Cardiologue avec 20 ans de pratique à Douala.'],
    ['a new diploma', "Cardiologue diplômé de l'Université de Douala."],
    ['a new place', "Cardiologue à Douala et à Paris, j'accompagne mes patients."],
  ])('should reject %s that is not in the original text (faits_inventes)', async (_nom, texte) => {
    expect(await ameliorer({ texte })).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it.each([
    ['empty text', { texte: '' }],
    ['blank text', { texte: '   ' }],
    ['missing text', {}],
    ['non-string text', { texte: 42 }],
    ['an extra field', { texte: 'Un texte.', commentaire: 'autre' }],
    ['null', null],
    ['a string', 'Un texte.'],
  ])('should reject %s (sortie_invalide)', async (_nom, donnees) => {
    expect(await ameliorer(donnees)).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it('should bound a bio to BIO_MAX characters and 260 words', async () => {
    expect(await ameliorer({ texte: 'a '.repeat(BIO_MAX) })).toEqual({ ok: false, code: 'sortie_invalide' })
    expect(await ameliorer({ texte: texteDeMots(261) })).toEqual({ ok: false, code: 'sortie_invalide' })
    expect(await ameliorer({ texte: texteDeMots(260) })).toMatchObject({ ok: true })
  })

  it('should bound an accroche to ACCROCHE_MAX characters', async () => {
    const entree = { ...ENTREE_AMELIORER, champ: 'accroche' as const, texte: 'Cardiologue à Douala, à votre écoute.' }
    const exacte = 'a'.repeat(ACCROCHE_MAX)

    expect(await ameliorer({ texte: exacte }, entree)).toMatchObject({ ok: true })
    expect(await ameliorer({ texte: `${exacte}a` }, entree)).toEqual({ ok: false, code: 'sortie_invalide' })
  })
})
