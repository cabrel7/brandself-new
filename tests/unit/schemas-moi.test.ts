import { describe, expect, it } from 'vitest'
import { ACCOUNT_DELETION_PHRASE, DEVISES, LOCALES } from '../../shared/compte'
import { schemaAccountDeletion, schemaMoiUpdate } from '../../shared/schemas/moi'

// U5 — schemaMoiUpdate et schemaAccountDeletion

describe('schemaMoiUpdate (U5)', () => {
  it.each([
    [{ fuseau: 'Europe/Paris' }],
    [{ devise: 'EUR' }],
    [{ locale: 'fr' }],
    [{ fuseau: 'Africa/Lagos', devise: 'USD', locale: 'fr' }],
  ])('should accept %j', (entree) => {
    expect(schemaMoiUpdate.safeParse(entree)).toMatchObject({ success: true, data: entree })
  })

  it('should only return the keys that were sent (no default would overwrite the account)', () => {
    const resultat = schemaMoiUpdate.safeParse({ devise: 'EUR' })
    expect(Object.keys(resultat.data ?? {})).toEqual(['devise'])
  })

  it.each([
    ['fuseau inconnu', { fuseau: 'Mars/Olympus' }],
    ['fuseau vide', { fuseau: '' }],
    ['fuseau non texte', { fuseau: 42 }],
    ['devise inconnue', { devise: 'GBP' }],
    ['devise en minuscules', { devise: 'xaf' }],
    ['langue inconnue', { locale: 'en' }],
    ['objet vide', {}],
    ['clé inconnue (email)', { email: 'pirate@exemple.com', devise: 'EUR' }],
    ['clé inconnue (id)', { id: 'autre', fuseau: 'Europe/Paris' }],
    ['null', null],
    ['tableau', []],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaMoiUpdate.safeParse(entree).success).toBe(false)
  })

  it('should accept every published devise and locale', () => {
    for (const devise of DEVISES) expect(schemaMoiUpdate.safeParse({ devise }).success).toBe(true)
    for (const locale of LOCALES) expect(schemaMoiUpdate.safeParse({ locale }).success).toBe(true)
  })
})

describe('schemaAccountDeletion (U5)', () => {
  it('should accept an object carrying a confirmation string (the phrase is judged by the service)', () => {
    expect(schemaAccountDeletion.safeParse({ confirmation: ACCOUNT_DELETION_PHRASE }).success).toBe(true)
    expect(schemaAccountDeletion.safeParse({ confirmation: 'oui' }).success).toBe(true)
  })

  it.each([
    ['sans confirmation', {}],
    ['confirmation non texte', { confirmation: true }],
    ['clé en trop', { confirmation: 'SUPPRIMER', userId: 'autre' }],
    ['null', null],
  ])('should refuse a body %s', (_libelle, entree) => {
    expect(schemaAccountDeletion.safeParse(entree).success).toBe(false)
  })
})
