import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { schemaServiceCreate, schemaServiceReorder, schemaServiceUpdate } from '../../shared/schemas/service'
import {
  DUREE_MIN_MAX,
  DUREE_MIN_MIN,
  INCLUS_LIGNE_MAX,
  INCLUS_MAX,
  PAIEMENT_INSTRUCTIONS_MAX,
  SEANCES_MAX,
  SEANCES_MIN,
  SERVICES_REORDER_MAX,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_TITRE_MAX,
} from '../../shared/services'
import { PRIX_MAX_MINOR } from '../../shared/devises'

// U12 — schémas Zod des services (création, mise à jour partielle, réordonnancement) et partie « schéma »
// des critères S3-CA11 et S3-CA25. La cohérence ENTRE champs (durée, séances, prix, vedette) n'est pas
// vérifiée ici : elle l'est côté serveur sur l'état fusionné (services-regles.test.ts, services.test.ts).

const minimal = { titre: 'Consultation', type: 'rdv', tarif: 'gratuit' }

function champsEnErreur(resultat: ReturnType<typeof schemaServiceCreate.safeParse>): string[] {
  if (resultat.success) return []
  return [...new Set(resultat.error.issues.map((i) => String(i.path[0] ?? '')))]
}

describe('schemaServiceCreate (U12)', () => {
  it('should apply the defaults: nulls, empty inclus, reservable and actif true, enVedette absent (automatic)', () => {
    const resultat = schemaServiceCreate.safeParse(minimal)

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      titre: 'Consultation',
      description: null,
      imageMediaId: null,
      type: 'rdv',
      nbSeances: null,
      rythme: null,
      dureeMin: null,
      tarif: 'gratuit',
      prixMontant: null,
      prixDevise: null,
      paiementMode: null,
      paiementInstructions: null,
      inclus: [],
      reservable: true,
      actif: true,
    })
    expect('enVedette' in (resultat.data ?? {})).toBe(false)
  })

  it('should keep an explicit enVedette (true and false) distinct from an absent one', () => {
    expect(schemaServiceCreate.parse({ ...minimal, enVedette: true }).enVedette).toBe(true)
    expect(schemaServiceCreate.parse({ ...minimal, enVedette: false }).enVedette).toBe(false)
  })

  it('should accept a complete valid payload and keep every value', () => {
    const imageMediaId = randomUUID()
    const complet = {
      titre: 'Suivi après infarctus',
      description: 'Un accompagnement pas à pas.',
      imageMediaId,
      type: 'accompagnement',
      nbSeances: 6,
      rythme: 'hebdomadaire',
      dureeMin: 30,
      tarif: 'payant',
      prixMontant: 60000,
      prixDevise: 'XAF',
      paiementMode: 'sur_place',
      paiementInstructions: 'Mobile Money ou espèces.',
      inclus: ['Bilan initial', 'Plan de suivi'],
      reservable: false,
      enVedette: true,
      actif: false,
    }

    expect(schemaServiceCreate.parse(complet)).toEqual(complet)
  })

  describe('titre', () => {
    it('should trim the title', () => {
      expect(schemaServiceCreate.parse({ ...minimal, titre: '  Bilan  ' }).titre).toBe('Bilan')
    })

    it.each([[''], ['   '], ['\t\n']])('should refuse the empty title %j', (titre) => {
      const resultat = schemaServiceCreate.safeParse({ ...minimal, titre })

      expect(champsEnErreur(resultat)).toEqual(['titre'])
    })

    it('should refuse a missing or non-string title', () => {
      expect(schemaServiceCreate.safeParse({ type: 'rdv', tarif: 'gratuit' }).success).toBe(false)
      expect(schemaServiceCreate.safeParse({ ...minimal, titre: 42 }).success).toBe(false)
      expect(schemaServiceCreate.safeParse({ ...minimal, titre: null }).success).toBe(false)
    })

    it(`should accept ${SERVICE_TITRE_MAX} characters and refuse ${SERVICE_TITRE_MAX + 1}`, () => {
      expect(schemaServiceCreate.safeParse({ ...minimal, titre: 'a'.repeat(SERVICE_TITRE_MAX) }).success).toBe(true)
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, titre: 'a'.repeat(SERVICE_TITRE_MAX + 1) }))).toEqual(['titre'])
    })

    it('should give a message in French for an empty title', () => {
      const resultat = schemaServiceCreate.safeParse({ ...minimal, titre: '' })

      expect(resultat.error?.issues[0]?.message).toBe('Le titre est requis.')
    })
  })

  describe('description', () => {
    it.each([[''], ['   '], [null]])('should turn the description %j into null', (description) => {
      expect(schemaServiceCreate.parse({ ...minimal, description }).description).toBeNull()
    })

    it('should trim the description and keep its line breaks', () => {
      expect(schemaServiceCreate.parse({ ...minimal, description: '  ligne 1\nligne 2  ' }).description).toBe('ligne 1\nligne 2')
    })

    it(`should accept ${SERVICE_DESCRIPTION_MAX} characters and refuse ${SERVICE_DESCRIPTION_MAX + 1}`, () => {
      expect(schemaServiceCreate.safeParse({ ...minimal, description: 'a'.repeat(SERVICE_DESCRIPTION_MAX) }).success).toBe(true)
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, description: 'a'.repeat(SERVICE_DESCRIPTION_MAX + 1) }))).toEqual(['description'])
    })
  })

  describe('enums', () => {
    it.each([['consultation'], ['RDV'], [''], [null], [3]])('should refuse the type %j', (type) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, type }))).toEqual(['type'])
    })

    it.each([['offert'], ['PAYANT'], [''], [null]])('should refuse the tarif %j', (tarif) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, tarif }))).toEqual(['tarif'])
    })

    it.each([['cheque'], ['EN_LIGNE'], [7]])('should refuse the payment mode %j', (paiementMode) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, paiementMode }))).toEqual(['paiementMode'])
    })

    it.each([['quotidien'], ['Hebdomadaire'], [12]])('should refuse the rhythm %j', (rythme) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, rythme }))).toEqual(['rythme'])
    })

    it.each([[''], ['   '], [null]])('should turn the blank rhythm / payment mode / currency %j into null', (vide) => {
      const lu = schemaServiceCreate.parse({ ...minimal, rythme: vide, paiementMode: vide, prixDevise: vide })

      expect(lu).toMatchObject({ rythme: null, paiementMode: null, prixDevise: null })
    })
  })

  describe('dureeMin', () => {
    it.each([[DUREE_MIN_MIN], [30], [DUREE_MIN_MAX]])('should accept %i minutes', (dureeMin) => {
      expect(schemaServiceCreate.parse({ ...minimal, dureeMin }).dureeMin).toBe(dureeMin)
    })

    it.each([[DUREE_MIN_MIN - 1], [0], [-10], [DUREE_MIN_MAX + 1], [30.5], ['30'], [Number.NaN]])('should refuse the duration %j', (dureeMin) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, dureeMin }))).toEqual(['dureeMin'])
    })
  })

  describe('nbSeances', () => {
    it.each([[SEANCES_MIN], [6], [SEANCES_MAX]])('should accept %i sessions', (nbSeances) => {
      expect(schemaServiceCreate.parse({ ...minimal, nbSeances }).nbSeances).toBe(nbSeances)
    })

    it.each([[1], [0], [-2], [SEANCES_MAX + 1], [2.5], ['6']])('should refuse %j sessions', (nbSeances) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, nbSeances }))).toEqual(['nbSeances'])
    })
  })

  describe('prixMontant et prixDevise', () => {
    it.each([[1], [15000], [PRIX_MAX_MINOR]])('should accept the price %i', (prixMontant) => {
      expect(schemaServiceCreate.parse({ ...minimal, prixMontant }).prixMontant).toBe(prixMontant)
    })

    it.each([[0], [-5], [12.5], [PRIX_MAX_MINOR + 1], ['1000'], [Number.NaN], [Number.POSITIVE_INFINITY]])('should refuse the price %j', (prixMontant) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, prixMontant }))).toEqual(['prixMontant'])
    })

    it.each([['XAF'], ['EUR'], ['USD']])('should accept the currency %s', (prixDevise) => {
      expect(schemaServiceCreate.parse({ ...minimal, prixDevise }).prixDevise).toBe(prixDevise)
    })

    it.each([['GBP'], ['xaf'], ['FCFA']])('should refuse the currency %s', (prixDevise) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, prixDevise }))).toEqual(['prixDevise'])
    })
  })

  describe('imageMediaId', () => {
    it('should accept a uuid and null, and refuse anything else', () => {
      expect(schemaServiceCreate.safeParse({ ...minimal, imageMediaId: randomUUID() }).success).toBe(true)
      expect(schemaServiceCreate.safeParse({ ...minimal, imageMediaId: null }).success).toBe(true)
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, imageMediaId: '../../etc/passwd' }))).toEqual(['imageMediaId'])
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, imageMediaId: '' }))).toEqual(['imageMediaId'])
    })
  })

  describe('paiementInstructions', () => {
    it(`should accept ${PAIEMENT_INSTRUCTIONS_MAX} characters, refuse ${PAIEMENT_INSTRUCTIONS_MAX + 1} and turn blank into null`, () => {
      expect(schemaServiceCreate.safeParse({ ...minimal, paiementInstructions: 'a'.repeat(PAIEMENT_INSTRUCTIONS_MAX) }).success).toBe(true)
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, paiementInstructions: 'a'.repeat(PAIEMENT_INSTRUCTIONS_MAX + 1) }))).toEqual(['paiementInstructions'])
      expect(schemaServiceCreate.parse({ ...minimal, paiementInstructions: '  ' }).paiementInstructions).toBeNull()
    })
  })

  describe('inclus', () => {
    it('should trim each line and drop the empty ones', () => {
      expect(schemaServiceCreate.parse({ ...minimal, inclus: ['  a ', '', 'b', '   '] }).inclus).toEqual(['a', 'b'])
    })

    it(`should accept ${INCLUS_MAX} lines`, () => {
      const lignes = Array.from({ length: INCLUS_MAX }, (_, i) => `ligne ${i}`)

      expect(schemaServiceCreate.parse({ ...minimal, inclus: lignes }).inclus).toEqual(lignes)
    })

    it(`should refuse ${INCLUS_MAX + 1} non-empty lines (S3-CA11)`, () => {
      const lignes = Array.from({ length: INCLUS_MAX + 1 }, (_, i) => `ligne ${i}`)

      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, inclus: lignes }))).toEqual(['inclus'])
    })

    it('should count only the non-empty lines (13 entries of which one blank is accepted)', () => {
      const lignes = [...Array.from({ length: INCLUS_MAX }, (_, i) => `ligne ${i}`), '   ']

      expect(schemaServiceCreate.parse({ ...minimal, inclus: lignes }).inclus).toHaveLength(INCLUS_MAX)
    })

    it(`should accept a line of ${INCLUS_LIGNE_MAX} characters and refuse ${INCLUS_LIGNE_MAX + 1}`, () => {
      expect(schemaServiceCreate.safeParse({ ...minimal, inclus: ['a'.repeat(INCLUS_LIGNE_MAX)] }).success).toBe(true)
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, inclus: ['a'.repeat(INCLUS_LIGNE_MAX + 1)] }))).toEqual(['inclus'])
    })

    it.each([['une ligne'], [42], [{ 0: 'a' }]])('should refuse the non-array value %j', (inclus) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, inclus }))).toEqual(['inclus'])
    })

    it('should refuse an array containing non-strings', () => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, inclus: ['a', 1] }))).toEqual(['inclus'])
    })
  })

  describe('booléens', () => {
    it.each(['reservable', 'actif', 'enVedette'])('should refuse "true" (a string) for %s', (champ) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, [champ]: 'true' }))).toEqual([champ])
    })

    it.each(['reservable', 'actif', 'enVedette'])('should refuse 1 (a number) for %s', (champ) => {
      expect(champsEnErreur(schemaServiceCreate.safeParse({ ...minimal, [champ]: 1 }))).toEqual([champ])
    })
  })

  describe('mass assignment (strict)', () => {
    it.each(['slug', 'ordre', 'vitrineId', 'id', 'userId', 'createdAt', 'updatedAt', 'creeLe', 'imageMediaID'])('should refuse the unknown or forbidden key %s (S3-CA11)', (cle) => {
      const resultat = schemaServiceCreate.safeParse({ ...minimal, [cle]: 'x' })

      expect(resultat.success).toBe(false)
    })

    it('should refuse a body that is not an object', () => {
      expect(schemaServiceCreate.safeParse(null).success).toBe(false)
      expect(schemaServiceCreate.safeParse([]).success).toBe(false)
      expect(schemaServiceCreate.safeParse('titre').success).toBe(false)
      expect(schemaServiceCreate.safeParse(undefined).success).toBe(false)
    })
  })

  it('should NOT check the consistency between fields (that is the job of the server on the merged state)', () => {
    // rdv sans durée, accompagnement sans séances, payant sans prix, devis payant : valides pour Zod.
    expect(schemaServiceCreate.safeParse({ ...minimal, type: 'rdv' }).success).toBe(true)
    expect(schemaServiceCreate.safeParse({ ...minimal, type: 'accompagnement' }).success).toBe(true)
    expect(schemaServiceCreate.safeParse({ ...minimal, tarif: 'payant' }).success).toBe(true)
    expect(schemaServiceCreate.safeParse({ ...minimal, type: 'devis', tarif: 'payant' }).success).toBe(true)
  })
})

describe('schemaServiceUpdate (U12)', () => {
  it('should refuse an empty patch with the message "Aucune modification à enregistrer." (S3-CA25)', () => {
    const resultat = schemaServiceUpdate.safeParse({})

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues.map((i) => i.message)).toContain('Aucune modification à enregistrer.')
  })

  it('should accept a single field and inject NO default for the others', () => {
    const resultat = schemaServiceUpdate.safeParse({ description: 'x' })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({ description: 'x' })
  })

  it.each([
    [{ titre: '  Nouveau  ' }, { titre: 'Nouveau' }],
    [{ description: '' }, { description: null }],
    [{ rythme: '' }, { rythme: null }],
    [{ paiementInstructions: '  ' }, { paiementInstructions: null }],
    [{ inclus: [' a ', ''] }, { inclus: ['a'] }],
    [{ inclus: [] }, { inclus: [] }],
    [{ imageMediaId: null }, { imageMediaId: null }],
    [{ enVedette: true }, { enVedette: true }],
    [{ actif: false }, { actif: false }],
    [{ reservable: false }, { reservable: false }],
    [{ nbSeances: null, dureeMin: null }, { nbSeances: null, dureeMin: null }],
  ])('should accept and normalise the patch %j', (patch, attendu) => {
    expect(schemaServiceUpdate.parse(patch)).toEqual(attendu)
  })

  it.each([
    [{ titre: '' }, 'titre'],
    [{ titre: 'a'.repeat(SERVICE_TITRE_MAX + 1) }, 'titre'],
    [{ dureeMin: DUREE_MIN_MIN - 1 }, 'dureeMin'],
    [{ nbSeances: 1 }, 'nbSeances'],
    [{ prixMontant: 12.5 }, 'prixMontant'],
    [{ prixMontant: 0 }, 'prixMontant'],
    [{ prixDevise: 'GBP' }, 'prixDevise'],
    [{ type: 'consultation' }, 'type'],
    [{ tarif: 'offert' }, 'tarif'],
    [{ paiementMode: 'cheque' }, 'paiementMode'],
    [{ inclus: Array.from({ length: INCLUS_MAX + 1 }, (_, i) => `l${i}`) }, 'inclus'],
    [{ imageMediaId: 'pas-un-uuid' }, 'imageMediaId'],
    [{ actif: 'non' }, 'actif'],
  ])('should refuse the invalid patch %j on %s', (patch, champ) => {
    const resultat = schemaServiceUpdate.safeParse(patch)

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues.map((i) => String(i.path[0]))).toContain(champ)
  })

  it.each(['slug', 'ordre', 'vitrineId', 'id', 'userId', 'createdAt'])('should refuse the forbidden key %s, alone or next to a valid field (S3-CA25)', (cle) => {
    expect(schemaServiceUpdate.safeParse({ [cle]: 'x' }).success).toBe(false)
    expect(schemaServiceUpdate.safeParse({ titre: 'Valide', [cle]: 'x' }).success).toBe(false)
  })

  it('should not check the consistency between fields (type change without sessions is valid for Zod)', () => {
    expect(schemaServiceUpdate.safeParse({ type: 'accompagnement' }).success).toBe(true)
    expect(schemaServiceUpdate.safeParse({ tarif: 'payant' }).success).toBe(true)
  })

  it('should refuse a body that is not an object', () => {
    expect(schemaServiceUpdate.safeParse(null).success).toBe(false)
    expect(schemaServiceUpdate.safeParse(undefined).success).toBe(false)
    expect(schemaServiceUpdate.safeParse([{ titre: 'x' }]).success).toBe(false)
  })
})

describe('schemaServiceReorder (U12)', () => {
  it('should accept a list of distinct uuids and keep their order', () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()]

    expect(schemaServiceReorder.parse({ ids })).toEqual({ ids })
  })

  it('should refuse a duplicated id and point at the ids field', () => {
    const id = randomUUID()

    const resultat = schemaServiceReorder.safeParse({ ids: [id, randomUUID(), id] })

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues.some((i) => i.path[0] === 'ids')).toBe(true)
  })

  it.each([
    ['une liste vide', { ids: [] }],
    ['un identifiant qui n’est pas un uuid', { ids: ['abc'] }],
    ['un identifiant numérique', { ids: [1] }],
    ['ids absent', {}],
    ['ids qui n’est pas un tableau', { ids: randomUUID() }],
    ['une clé inconnue', { ids: [randomUUID()], ordre: 3 }],
  ])('should refuse %s', (_libelle, corps) => {
    expect(schemaServiceReorder.safeParse(corps).success).toBe(false)
  })

  it(`should accept ${SERVICES_REORDER_MAX} ids and refuse ${SERVICES_REORDER_MAX + 1}`, () => {
    const ids = Array.from({ length: SERVICES_REORDER_MAX }, () => randomUUID())

    expect(schemaServiceReorder.safeParse({ ids }).success).toBe(true)
    expect(schemaServiceReorder.safeParse({ ids: [...ids, randomUUID()] }).success).toBe(false)
  })
})
