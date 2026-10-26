import { describe, expect, it } from 'vitest'
import { RESERVED_USERNAMES, isReserved } from '../../shared/reserved'
import { schemaUsernameQuery, validateUsername } from '../../shared/schemas/username'
import { schemaUsernameChange } from '../../shared/schemas/vitrine'

// U1 — username et mots réservés (S2 ajoute medias, compte, brandself, support, blog,
// mentions-legales, services). Complète tests/username.test.ts, qui reste inchangé.

const MOTS_AJOUTES_PAR_S2 = ['medias', 'compte', 'brandself', 'support', 'blog', 'mentions-legales', 'services']

describe('mots réservés (U1)', () => {
  it.each(MOTS_AJOUTES_PAR_S2)('should reserve %s', (mot) => {
    expect(isReserved(mot)).toBe(true)
    const resultat = validateUsername(mot)
    expect(resultat.success).toBe(false)
  })

  it.each(['MEDIAS', 'Services', ' compte '])('should reject %j even with another case or surrounding spaces', (saisie) => {
    expect(validateUsername(saisie).success).toBe(false)
  })

  it('should keep the original reserved words', () => {
    for (const mot of ['api', 'studio', 'connexion', 'inscription', 'onboarding', 'tarifs', 'l', 'admin', 'www', 'app', 'aide', 'contact', 'cgu', 'confidentialite', 'sitemap', 'robots', 'assets', '_nuxt']) {
      expect(RESERVED_USERNAMES).toContain(mot)
    }
  })

  it('should not reserve words that merely contain a reserved word', () => {
    for (const nom of ['mon-blog', 'medias-sante', 'dr-support', 'services-plus']) {
      expect(validateUsername(nom).success).toBe(true)
    }
  })

  it('should keep every reserved word lowercase and unique (the comparison is made on the normalised username)', () => {
    expect(new Set(RESERVED_USERNAMES).size).toBe(RESERVED_USERNAMES.length)
    for (const mot of RESERVED_USERNAMES) {
      expect(mot).toBe(mot.toLowerCase())
    }
  })

  it('should apply the same rules to a username change', () => {
    expect(schemaUsernameChange.safeParse({ username: 'medias' }).success).toBe(false)
    expect(schemaUsernameChange.safeParse({ username: ' Nouveau-Nom ' })).toMatchObject({ success: true, data: { username: 'nouveau-nom' } })
    expect(schemaUsernameChange.safeParse({ username: 'ok-nom', userId: 'x' }).success).toBe(false)
    expect(schemaUsernameChange.safeParse({}).success).toBe(false)
  })
})

describe('schemaUsernameQuery', () => {
  it('should accept any string up to 64 characters (the format is judged by the service)', () => {
    expect(schemaUsernameQuery.safeParse({ username: 'Bad_Name!' }).success).toBe(true)
    expect(schemaUsernameQuery.safeParse({ username: 'a'.repeat(64) }).success).toBe(true)
    expect(schemaUsernameQuery.safeParse({ username: '' }).success).toBe(true)
  })

  it('should reject 65 characters, a missing value and a repeated query parameter (array)', () => {
    expect(schemaUsernameQuery.safeParse({ username: 'a'.repeat(65) }).success).toBe(false)
    expect(schemaUsernameQuery.safeParse({}).success).toBe(false)
    expect(schemaUsernameQuery.safeParse({ username: ['a', 'b'] }).success).toBe(false)
  })
})
