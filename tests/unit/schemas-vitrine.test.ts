import { describe, expect, it } from 'vitest'
import { PALETTES } from '../../shared/palettes'
import { schemaVitrineCreate, schemaVitrineUpdate } from '../../shared/schemas/vitrine'
import { ACCROCHE_MAX, BIO_MAX, METIER_MAX, NOM_MAX, PAYS_CODES, PRENOM_MAX, VILLE_MAX } from '../../shared/vitrine'

// U4 — schémas vitrine (création et mise à jour)

const creationValide = { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username: 'dr-cabrel' }

describe('schemaVitrineCreate (U4)', () => {
  it('should accept a complete valid payload', () => {
    expect(schemaVitrineCreate.safeParse(creationValide)).toMatchObject({ success: true, data: creationValide })
  })

  it('should default titre to null when absent', () => {
    const { titre: _titre, ...sansTitre } = creationValide
    expect(schemaVitrineCreate.safeParse(sansTitre)).toMatchObject({ success: true, data: { titre: null } })
  })

  it.each(['', '   ', null])('should turn titre %j into null', (titre) => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, titre })).toMatchObject({ success: true, data: { titre: null } })
  })

  it.each(['docteur', 'DR', 'Dr', 'prof', 42])('should refuse the titre %j', (titre) => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, titre }).success).toBe(false)
  })

  it('should normalise the username (trim + lowercase)', () => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, username: '  DR-Cabrel ' })).toMatchObject({
      success: true,
      data: { username: 'dr-cabrel' },
    })
  })

  it.each(['medias', 'admin', 'ab', 'Bad_Name', 'a--b'])('should refuse the username %j', (username) => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, username }).success).toBe(false)
  })

  it('should trim the first name, last name and job', () => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, prenom: '  Cabrel ', nom: ' Nguesso ', metier: ' Cardiologue ' })).toMatchObject({
      success: true,
      data: { prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue' },
    })
  })

  it.each(['prenom', 'nom', 'metier'] as const)('should require %s (missing, empty, blank)', (champ) => {
    const { [champ]: _retire, ...incomplet } = creationValide
    expect(schemaVitrineCreate.safeParse(incomplet).success).toBe(false)
    expect(schemaVitrineCreate.safeParse({ ...creationValide, [champ]: '' }).success).toBe(false)
    expect(schemaVitrineCreate.safeParse({ ...creationValide, [champ]: '   ' }).success).toBe(false)
  })

  it.each([
    ['prenom', PRENOM_MAX],
    ['nom', NOM_MAX],
    ['metier', METIER_MAX],
  ] as const)('should accept %s at its limit of %i characters and refuse one more', (champ, max) => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, [champ]: 'a'.repeat(max) }).success).toBe(true)
    expect(schemaVitrineCreate.safeParse({ ...creationValide, [champ]: 'a'.repeat(max + 1) }).success).toBe(false)
  })

  it.each([
    ['userId', 'autre-utilisateur'],
    ['id', 'x'],
    ['publieeLe', '2026-01-01T00:00:00Z'],
    ['palette', 'sauge'],
    ['ville', 'Douala'],
  ])('should refuse the extra key %s (strict schema, no mass-assignment)', (cle, valeur) => {
    expect(schemaVitrineCreate.safeParse({ ...creationValide, [cle]: valeur }).success).toBe(false)
  })

  it.each([null, undefined, 'texte', 42, [], [creationValide]])('should refuse a non-object body: %j', (corps) => {
    expect(schemaVitrineCreate.safeParse(corps).success).toBe(false)
  })

  it('should refuse a body carrying a __proto__ key', () => {
    const corps: unknown = JSON.parse(`{"prenom":"A","nom":"B","metier":"C","username":"abc","__proto__":{"isAdmin":true}}`)
    expect(schemaVitrineCreate.safeParse(corps).success).toBe(false)
  })
})

describe('schemaVitrineUpdate (U4)', () => {
  it('should refuse an empty object (nothing to save)', () => {
    expect(schemaVitrineUpdate.safeParse({}).success).toBe(false)
  })

  it.each([
    ['username', 'nouveau-nom'],
    ['userId', 'u1'],
    ['id', 'v1'],
    ['publieeLe', '2026-01-01T00:00:00Z'],
    ['seoTitre', 'Titre'],
    ['sectionsMasquees', ['services']],
  ])('should refuse the key %s (not editable through this route)', (cle, valeur) => {
    expect(schemaVitrineUpdate.safeParse({ ville: 'Douala', [cle]: valeur }).success).toBe(false)
  })

  it('should accept a partial payload and return only the keys that were sent', () => {
    const resultat = schemaVitrineUpdate.safeParse({ ville: 'Douala' })
    expect(resultat).toMatchObject({ success: true, data: { ville: 'Douala' } })
    expect(Object.keys(resultat.data ?? {})).toEqual(['ville'])
  })

  it.each(['titre', 'ville', 'accroche', 'bio', 'emailContact', 'telephone', 'whatsapp'])(
    'should turn "" and blank %s into null',
    (champ) => {
      expect(schemaVitrineUpdate.safeParse({ [champ]: '' })).toMatchObject({ success: true, data: { [champ]: null } })
      expect(schemaVitrineUpdate.safeParse({ [champ]: '   ' })).toMatchObject({ success: true, data: { [champ]: null } })
    },
  )

  it('should refuse an empty first name, last name or job (they are required to exist)', () => {
    for (const champ of ['prenom', 'nom', 'metier']) {
      expect(schemaVitrineUpdate.safeParse({ [champ]: '' }).success).toBe(false)
    }
  })

  it.each(PAYS_CODES)('should accept the country code %s', (pays) => {
    expect(schemaVitrineUpdate.safeParse({ pays }).success).toBe(true)
  })

  it.each(['Cameroun', 'cm', 'CMR', 'ZZ', 'C', '12', 'XX'])('should refuse the country %j', (pays) => {
    expect(schemaVitrineUpdate.safeParse({ pays }).success).toBe(false)
  })

  it('should accept pays null (country removed)', () => {
    expect(schemaVitrineUpdate.safeParse({ pays: null })).toMatchObject({ success: true, data: { pays: null } })
  })

  it.each([
    ['ville', VILLE_MAX],
    ['accroche', ACCROCHE_MAX],
    ['bio', BIO_MAX],
  ] as const)('should accept %s at %i characters and refuse one more', (champ, max) => {
    expect(schemaVitrineUpdate.safeParse({ [champ]: 'a'.repeat(max) }).success).toBe(true)
    expect(schemaVitrineUpdate.safeParse({ [champ]: 'a'.repeat(max + 1) }).success).toBe(false)
  })

  it('should count characters, not bytes, for accented text at the limit', () => {
    expect(schemaVitrineUpdate.safeParse({ accroche: 'é'.repeat(ACCROCHE_MAX) }).success).toBe(true)
  })

  it('should accept a photoMediaId that is a uuid or null, and refuse anything else', () => {
    expect(schemaVitrineUpdate.safeParse({ photoMediaId: '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10' }).success).toBe(true)
    expect(schemaVitrineUpdate.safeParse({ photoMediaId: null }).success).toBe(true)
    for (const invalide of ['abc', '../../etc/passwd', '', 123, '3f2b8c1e-9d4a-4e7b-8a61']) {
      expect(schemaVitrineUpdate.safeParse({ photoMediaId: invalide }).success).toBe(false)
    }
  })

  it('should validate the contact email and cap it at 254 characters', () => {
    expect(schemaVitrineUpdate.safeParse({ emailContact: 'contact@exemple.com' }).success).toBe(true)
    expect(schemaVitrineUpdate.safeParse({ emailContact: 'pas-un-email' }).success).toBe(false)
    expect(schemaVitrineUpdate.safeParse({ emailContact: `${'a'.repeat(250)}@x.co` }).success).toBe(false)
  })

  it.each(['telephone', 'whatsapp'])('should require the E.164 format for %s', (champ) => {
    expect(schemaVitrineUpdate.safeParse({ [champ]: '+237600000000' }).success).toBe(true)
    for (const invalide of ['600000000', '+0123456', '+237 600 000 000', '+23760', '+2376000000000000', '00237600000000', 'abc']) {
      expect(schemaVitrineUpdate.safeParse({ [champ]: invalide }).success).toBe(false)
    }
  })

  it.each(PALETTES)('should accept the palette %s', (palette) => {
    expect(schemaVitrineUpdate.safeParse({ palette }).success).toBe(true)
  })

  it.each(['rose', 'Terracotta', '', null])('should refuse the palette %j', (palette) => {
    expect(schemaVitrineUpdate.safeParse({ palette }).success).toBe(false)
  })

  it('should refuse values of the wrong type instead of coercing them', () => {
    expect(schemaVitrineUpdate.safeParse({ ville: 123 }).success).toBe(false)
    expect(schemaVitrineUpdate.safeParse({ bio: ['a'] }).success).toBe(false)
    expect(schemaVitrineUpdate.safeParse({ palette: 1 }).success).toBe(false)
  })

  it('should report validation problems per field (flattenError)', () => {
    const resultat = schemaVitrineUpdate.safeParse({ ville: 'a'.repeat(VILLE_MAX + 1), pays: 'Cameroun' })
    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      const champs = Object.keys(resultat.error.flatten().fieldErrors)
      expect(champs.sort()).toEqual(['pays', 'ville'])
    }
  })

  it.each([null, undefined, 'texte', 42, []])('should refuse a non-object body: %j', (corps) => {
    expect(schemaVitrineUpdate.safeParse(corps).success).toBe(false)
  })
})
