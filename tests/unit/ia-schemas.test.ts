import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  schemaAmeliorerInput,
  schemaIaJobData,
  schemaPromptParametres,
  schemaPropositionOnboarding,
  schemaPropositionRepli,
  schemaServicePropose,
  schemaTexteAmeliore,
} from '../../shared/schemas/ia'
import { ACCROCHE_MAX, BIO_MAX } from '../../shared/vitrine'
import { SERVICE_TITRE_MAX } from '../../shared/services'
import { phraseDeMots, propositionValide, texteDeMots } from './support/ia-fixtures'
import type { PropositionFixture } from './support/ia-fixtures'

// S8 §3.4 / CA25 / CA47 : sorties du fournisseur (jamais crues sur parole) et entrées des routes IA.

function avec(surcharges: Partial<PropositionFixture>): unknown {
  return { ...propositionValide(), ...surcharges }
}

function valide(donnees: unknown): boolean {
  return schemaPropositionOnboarding.safeParse(donnees).success
}

describe('schemaPropositionOnboarding (CA25)', () => {
  it('should accept the reference proposition (fixture sanity check)', () => {
    expect(valide(propositionValide())).toBe(true)
  })

  it.each([
    [9, false],
    [10, true],
    [15, true],
    [16, false],
  ])('should judge an accroche of %i words (accepted: %s)', (mots, attendu) => {
    const base = propositionValide()
    const accroches = [phraseDeMots(mots, 0), base.accroches[1]!, base.accroches[2]!]

    expect(valide(avec({ accroches }))).toBe(attendu)
  })

  it.each([
    [79, false],
    [80, true],
    [260, true],
    [261, false],
  ])('should judge a presentation of %i words (accepted: %s)', (mots, attendu) => {
    expect(valide(avec({ presentation: texteDeMots(mots) }))).toBe(attendu)
  })

  it('should reject a presentation that exceeds BIO_MAX characters even within 260 words', () => {
    const mots = Array.from({ length: 200 }, () => 'extraordinairement').join(' ')

    expect(mots.length).toBeGreaterThan(BIO_MAX)
    expect(valide(avec({ presentation: mots }))).toBe(false)
  })

  it('should reject an accroche above ACCROCHE_MAX characters even within 15 words', () => {
    const base = propositionValide()
    const longue = Array.from({ length: 12 }, () => 'extraordinairement').join(' ')

    expect(longue.length).toBeGreaterThan(ACCROCHE_MAX)
    expect(valide(avec({ accroches: [longue, base.accroches[1]!, base.accroches[2]!] }))).toBe(false)
  })

  it.each([
    ['two accroches', { accroches: propositionValide().accroches.slice(0, 2) }],
    ['four accroches', { accroches: [...propositionValide().accroches, phraseDeMots(12, 30)] }],
    ['two services', { services: propositionValide().services.slice(0, 2) }],
    ['four services', { services: [...propositionValide().services, propositionValide().services[0]!] }],
  ])('should reject %s', (_nom, surcharges) => {
    expect(valide(avec(surcharges))).toBe(false)
  })

  it('should reject two identical accroches, ignoring case and surrounding spaces', () => {
    const base = propositionValide()
    const doublon = [base.accroches[0]!, ` ${base.accroches[0]!.toUpperCase()} `, base.accroches[2]!]

    expect(valide(avec({ accroches: doublon }))).toBe(false)
  })

  it('should reject two services with the same title', () => {
    const [a, b, c] = propositionValide().services
    const memeTitre = [a!, { ...b!, titre: a!.titre }, c!]

    expect(valide(avec({ services: memeTitre }))).toBe(false)
  })

  it('should reject an unknown key (strict) at the root and inside a service', () => {
    expect(valide({ ...propositionValide(), extra: 1 })).toBe(false)
    const [a, ...reste] = propositionValide().services
    expect(valide(avec({ services: [{ ...a!, prix: 15000 }, ...reste] }))).toBe(false)
  })

  it.each([null, undefined, 'texte', 42, [], {}])('should reject the non-proposition value %j', (valeur) => {
    expect(valide(valeur)).toBe(false)
  })
})

describe('schemaServicePropose (cohérence type / durée / séances)', () => {
  const base = { titre: 'Premier rendez-vous', description: phraseDeMots(12), type: 'rdv', dureeMin: 60, nbSeances: null }

  it('should accept a rdv with a duration and no sessions', () => {
    expect(schemaServicePropose.safeParse(base).success).toBe(true)
  })

  it('should reject an accompagnement without nbSeances', () => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'accompagnement', nbSeances: null }).success).toBe(false)
  })

  it('should accept an accompagnement with a closed-list session count', () => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'accompagnement', nbSeances: 6 }).success).toBe(true)
  })

  it('should reject a devis with a duration, and a rdv with sessions', () => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'devis', dureeMin: 60 }).success).toBe(false)
    expect(schemaServicePropose.safeParse({ ...base, nbSeances: 6 }).success).toBe(false)
  })

  it('should accept a devis with neither duration nor sessions', () => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'devis', dureeMin: null, nbSeances: null }).success).toBe(true)
  })

  it('should reject a rdv without duration', () => {
    expect(schemaServicePropose.safeParse({ ...base, dureeMin: null }).success).toBe(false)
  })

  it.each([29, 31, 100, 0, -60, 60.5])('should reject the duration %s (closed list 30/45/60/90/120)', (duree) => {
    expect(schemaServicePropose.safeParse({ ...base, dureeMin: duree }).success).toBe(false)
  })

  it.each([3, 5, 7, 13, 52])('should reject %i sessions (closed list 4/6/8/10/12)', (seances) => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'accompagnement', nbSeances: seances }).success).toBe(false)
  })

  it('should reject a duration sent as a string (no coercion of provider output)', () => {
    expect(schemaServicePropose.safeParse({ ...base, dureeMin: '60' }).success).toBe(false)
  })

  it.each([
    [9, false],
    [10, true],
    [60, true],
    [61, false],
  ])('should judge a description of %i words (accepted: %s)', (mots, attendu) => {
    expect(schemaServicePropose.safeParse({ ...base, description: phraseDeMots(mots) }).success).toBe(attendu)
  })

  it('should reject a title above 8 words, and above SERVICE_TITRE_MAX characters', () => {
    expect(schemaServicePropose.safeParse({ ...base, titre: 'un deux trois quatre cinq six sept huit neuf' }).success).toBe(false)
    expect(schemaServicePropose.safeParse({ ...base, titre: 'a'.repeat(SERVICE_TITRE_MAX + 1) }).success).toBe(false)
    expect(schemaServicePropose.safeParse({ ...base, titre: 'un deux trois quatre cinq six sept huit' }).success).toBe(true)
  })

  it('should reject an unknown service type', () => {
    expect(schemaServicePropose.safeParse({ ...base, type: 'consultation' }).success).toBe(false)
  })
})

describe('schemaPropositionRepli (limites en caractères seulement)', () => {
  it('should accept short texts that the strict schema would refuse', () => {
    const repli = {
      accroches: ['Un.', 'Deux.', 'Trois.'],
      presentation: 'Court.',
      services: [
        { titre: 'A', description: 'Court.', type: 'rdv', dureeMin: 60, nbSeances: null },
        { titre: 'B', description: 'Court.', type: 'rdv', dureeMin: 45, nbSeances: null },
        { titre: 'C', description: 'Court.', type: 'devis', dureeMin: null, nbSeances: null },
      ],
    }

    expect(schemaPropositionRepli.safeParse(repli).success).toBe(true)
    expect(schemaPropositionOnboarding.safeParse(repli).success).toBe(false)
  })

  it('should still refuse an accroche above ACCROCHE_MAX characters and an incoherent service', () => {
    const base = propositionValide()

    expect(schemaPropositionRepli.safeParse({ ...base, accroches: ['x'.repeat(ACCROCHE_MAX + 1), 'b', 'c'] }).success).toBe(false)
    expect(
      schemaPropositionRepli.safeParse({
        ...base,
        services: [{ ...base.services[0]!, type: 'devis' }, base.services[1]!, base.services[2]!],
      }).success,
    ).toBe(false)
  })
})

describe('schemaTexteAmeliore', () => {
  it('should accept a text and trim it', () => {
    expect(schemaTexteAmeliore.parse({ texte: '  Bonjour  ' })).toEqual({ texte: 'Bonjour' })
  })

  it.each([{ texte: '' }, { texte: '   ' }, {}, { texte: 'a', extra: 1 }, { texte: 12 }])(
    'should reject %j',
    (valeur) => {
      expect(schemaTexteAmeliore.safeParse(valeur).success).toBe(false)
    },
  )
})

describe('schemaAmeliorerInput (CA47)', () => {
  const texte20 = 'Je vous accompagne.!'

  it('should accept a 20-character text and default the objective to "reformuler"', () => {
    expect(texte20).toHaveLength(20)
    expect(schemaAmeliorerInput.parse({ champ: 'bio', texte: texte20 })).toEqual({
      champ: 'bio',
      texte: texte20,
      objectif: 'reformuler',
    })
  })

  it('should reject a 19-character text, measured after trimming', () => {
    expect(schemaAmeliorerInput.safeParse({ champ: 'bio', texte: texte20.slice(0, 19) }).success).toBe(false)
    expect(schemaAmeliorerInput.safeParse({ champ: 'bio', texte: `   ${texte20.slice(0, 19)}   ` }).success).toBe(false)
    expect(schemaAmeliorerInput.safeParse({ champ: 'bio', texte: ' '.repeat(40) }).success).toBe(false)
  })

  it('should limit a bio to BIO_MAX characters (2000 accepted, 2001 refused)', () => {
    expect(schemaAmeliorerInput.safeParse({ champ: 'bio', texte: 'a'.repeat(BIO_MAX) }).success).toBe(true)
    expect(schemaAmeliorerInput.safeParse({ champ: 'bio', texte: 'a'.repeat(BIO_MAX + 1) }).success).toBe(false)
  })

  it('should limit an accroche to ACCROCHE_MAX characters (160 accepted, 161 refused) on the texte field', () => {
    expect(schemaAmeliorerInput.safeParse({ champ: 'accroche', texte: 'a'.repeat(ACCROCHE_MAX) }).success).toBe(true)
    const refus = schemaAmeliorerInput.safeParse({ champ: 'accroche', texte: 'a'.repeat(ACCROCHE_MAX + 1) })
    expect(refus.success).toBe(false)
    if (!refus.success) expect(refus.error.issues.some((i) => i.path[0] === 'texte')).toBe(true)
  })

  it.each([
    ['unknown champ', { champ: 'nom', texte: texte20 }],
    ['unknown objective', { champ: 'bio', texte: texte20, objectif: 'poeme' }],
    ['unknown key', { champ: 'bio', texte: texte20, userId: 'autre' }],
    ['missing champ', { texte: texte20 }],
    ['missing texte', { champ: 'bio' }],
    ['non-string texte', { champ: 'bio', texte: 12345 }],
  ])('should reject %s', (_nom, corps) => {
    expect(schemaAmeliorerInput.safeParse(corps).success).toBe(false)
  })
})

describe('schemaPromptParametres', () => {
  it('should accept the reglages of the v1 prompts', () => {
    expect(schemaPromptParametres.safeParse({ temperature: 0.7, maxTokens: 1500 }).success).toBe(true)
    expect(schemaPromptParametres.safeParse({ temperature: 0.4, maxTokens: 900 }).success).toBe(true)
  })

  it.each([
    [{ temperature: -0.1, maxTokens: 900 }],
    [{ temperature: 1.1, maxTokens: 900 }],
    [{ temperature: 0.5, maxTokens: 99 }],
    [{ temperature: 0.5, maxTokens: 4001 }],
    [{ temperature: 0.5, maxTokens: 900.5 }],
    [{ temperature: 0.5 }],
    [{ maxTokens: 900 }],
    [{ temperature: 0.5, maxTokens: 900, topP: 1 }],
    [{}],
  ])('should reject the parameters %j', (parametres) => {
    expect(schemaPromptParametres.safeParse(parametres).success).toBe(false)
  })
})

describe('schemaIaJobData (rien de personnel dans Redis)', () => {
  it('should accept a bare generation id', () => {
    expect(schemaIaJobData.safeParse({ generationId: crypto.randomUUID() }).success).toBe(true)
  })

  it.each([
    [{ generationId: 'pas-un-uuid' }],
    [{}],
    [{ generationId: crypto.randomUUID(), metier: 'Cardiologue' }],
    [{ generationId: crypto.randomUUID(), userId: 'u-1' }],
    [null],
  ])('should reject %j', (donnees) => {
    expect(schemaIaJobData.safeParse(donnees).success).toBe(false)
  })
})

describe('JSON Schema transmis au fournisseur', () => {
  it('should be producible from the Zod schema (tool input_schema)', () => {
    const jsonSchema = z.toJSONSchema(schemaPropositionOnboarding)

    expect(jsonSchema.type).toBe('object')
    expect(Object.keys((jsonSchema as { properties: Record<string, unknown> }).properties).sort()).toEqual([
      'accroches',
      'presentation',
      'services',
    ])
  })
})
