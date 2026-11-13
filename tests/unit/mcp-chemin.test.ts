import { describe, expect, it } from 'vitest'
import { estSousChemin, normaliserChemin } from '../../server/mcp/chemin'
import { PREFIXES_OAUTH, estCheminOauth } from '../../server/middleware/mcp-inactif'
import { corpsAccepte } from '../../server/mcp/consentement'

describe('normaliserChemin (S16)', () => {
  it.each([
    ['/api/auth/oauth2/register', '/api/auth/oauth2/register'],
    ['//api/auth/oauth2/register', '/api/auth/oauth2/register'],
    ['/api//auth///oauth2/register', '/api/auth/oauth2/register'],
    ['/API/Auth/OAuth2/Register', '/api/auth/oauth2/register'],
    ['/api/auth/%6fauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/%6Fauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/%256fauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/%2e/oauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/./oauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/x/../oauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/oauth2/register?a=1#b', '/api/auth/oauth2/register'],
    ['/api/auth/oauth2;x=1/register', '/api/auth/oauth2/register'],
    ['/api\\auth\\oauth2/register', '/api/auth/oauth2/register'],
    ['/api/auth/oauth2/register/', '/api/auth/oauth2/register'],
  ])('should turn %s into %s', (brut, attendu) => {
    expect(normaliserChemin(brut)).toBe(attendu)
  })

  it('should not throw on an invalid percent sequence and still decode its valid octets', () => {
    expect(() => normaliserChemin('/api/auth/%zz/%6fauth2')).not.toThrow()
    expect(normaliserChemin('/api/auth/%zz/%6fauth2')).toBe('/api/auth/%zz/oauth2')
    expect(normaliserChemin('/api/auth/%e9/oauth2')).toBe('/api/auth/%e9/oauth2')
  })

  it('should not climb above the root', () => {
    expect(normaliserChemin('/../../api/auth/jwks')).toBe('/api/auth/jwks')
  })
})

describe('estSousChemin', () => {
  it('should match the prefix itself and its children, never a sibling sharing the prefix', () => {
    expect(estSousChemin('/api/auth/token', '/api/auth/token')).toBe(true)
    expect(estSousChemin('/api/auth/token/x', '/api/auth/token')).toBe(true)
    expect(estSousChemin('/api/auth/tokens', '/api/auth/token')).toBe(false)
  })
})

describe('estCheminOauth (middleware mcp-inactif)', () => {
  it.each([
    '/api/auth/oauth2/register',
    '//api/auth/oauth2/register',
    '/API/AUTH/OAUTH2/REGISTER',
    '/api/auth/%6fauth2/register',
    '/api/auth/%2e/oauth2/token',
    '/api/auth/jwks',
    '/api/auth/token',
    '/api/auth/.well-known/openid-configuration',
    '/api/auth/oauth2/public-client?client_id=x',
  ])('should block %s when MCP is disabled', (chemin) => {
    expect(estCheminOauth(chemin)).toBe(true)
  })

  it.each([
    '/api/auth/get-session',
    '/api/auth/sign-in/email-otp',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/phone-number/send-otp',
    '/api/auth/sign-out',
    '/api/auth/callback/google',
    '/api/auth/tokens-autre',
    '/api/studio/assistants',
  ])('should leave %s untouched (session, OTP and Google flows)', (chemin) => {
    expect(estCheminOauth(chemin)).toBe(false)
  })

  it('should list /api/auth/token among the blocked prefixes', () => {
    expect(PREFIXES_OAUTH).toContain('/api/auth/token')
  })
})

describe('corpsAccepte (consentement, fermé par défaut)', () => {
  it('should allow only an explicit refusal', () => {
    expect(corpsAccepte(JSON.stringify({ accept: false }), 'application/json')).toBe(false)
    expect(corpsAccepte('accept=false', 'application/x-www-form-urlencoded')).toBe(false)
  })

  it.each([
    [JSON.stringify({ accept: true }), 'application/json'],
    [JSON.stringify({ accept: 'true' }), 'application/json'],
    [JSON.stringify({}), 'application/json'],
    ['pas du json', 'application/json'],
    ['', 'application/json'],
    [undefined, undefined],
    ['accept=true', 'application/x-www-form-urlencoded'],
    [JSON.stringify({ accept: false }), 'application/x-www-form-urlencoded'],
  ])('should treat %s (%s) as an acceptance', (corps, type) => {
    expect(corpsAccepte(corps, type)).toBe(true)
  })
})
