import { describe, expect, it } from 'vitest'
import { demandeValable, lireErreurOauth } from '../../app/composables/useAutorisationOauth'
import { extraireQueryOauth } from '../../app/composables/useRepriseOauth'

const MAINTENANT = 1_800_000_000_000
const DANS_UN_QUART_D_HEURE = Math.floor(MAINTENANT / 1000) + 900

describe('écran de consentement : validité de la query', () => {
  it('query vide : invalide', () => {
    expect(demandeValable('', MAINTENANT)).toBe(false)
  })

  it('client_id et sig sans portée : invalide', () => {
    expect(demandeValable('client_id=bidon&sig=zzz&exp=1', MAINTENANT)).toBe(false)
  })

  it('exp=1 (expirée) avec portée : invalide', () => {
    expect(demandeValable('client_id=bidon&scope=vitrine%3Alecture&sig=zzz&exp=1', MAINTENANT)).toBe(false)
  })

  it('exp illisible : invalide', () => {
    expect(demandeValable('client_id=a&scope=vitrine%3Alecture&sig=z&exp=abc', MAINTENANT)).toBe(false)
  })

  it('non expirée avec portée : valable', () => {
    expect(demandeValable(`client_id=a&scope=vitrine%3Alecture&sig=z&exp=${DANS_UN_QUART_D_HEURE}`, MAINTENANT)).toBe(true)
  })

  it('exp absente : valable (le serveur tranche)', () => {
    expect(demandeValable('client_id=a&scope=vitrine%3Alecture&sig=z', MAINTENANT)).toBe(true)
  })

  it('sans client_id ou sans sig, la query est écartée en amont', () => {
    expect(extraireQueryOauth('?scope=vitrine%3Alecture&sig=z')).toBe('')
    expect(extraireQueryOauth('?client_id=a&scope=vitrine%3Alecture')).toBe('')
    expect(demandeValable(extraireQueryOauth('?client_id=a&scope=x&sig=z'), MAINTENANT)).toBe(true)
  })
})

describe('écran de consentement : lecture de l’erreur plan gratuit', () => {
  it('reconnaît le 403 PLAN_PAYANT_REQUIS du serveur (forme réelle)', () => {
    const erreur = {
      statusCode: 403,
      data: { error: true, statusCode: 403, statusMessage: 'PLAN_PAYANT_REQUIS', message: 'x', data: { code: 'PLAN_PAYANT_REQUIS' } },
    }
    expect(lireErreurOauth(erreur)).toEqual({ statut: 403, code: 'PLAN_PAYANT_REQUIS' })
  })

  it('garde le code Better Auth (invalid_signature) et tolère une erreur inconnue', () => {
    expect(lireErreurOauth({ statusCode: 400, data: { error: 'invalid_signature' } }).code).toBe('invalid_signature')
    expect(lireErreurOauth(new Error('réseau'))).toEqual({ statut: null, code: null })
  })
})
