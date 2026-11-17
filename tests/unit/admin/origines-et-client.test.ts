import { describe, expect, it } from 'vitest'
import { baseUrlAuthAdmin } from '../../../app/utils/admin-auth'
import { originesAdminAutorisees } from '../../../server/utils/admin'

// A1 (M3, MINOR b) : base du client d'authentification de l'hôte admin et origines de confiance pour les écritures.

describe('baseUrlAuthAdmin', () => {
  it('should append /api/auth to the origin', () => {
    expect(baseUrlAuthAdmin('https://admin.exemple.test')).toBe('https://admin.exemple.test/api/auth')
  })

  it.each([[''], [null], [undefined], ['pas-une-url'], ['admin.exemple.test'], ['//admin.exemple.test']])('should fall back to the relative path for %j', (origine) => {
    expect(baseUrlAuthAdmin(origine)).toBe('/api/auth')
  })

  it('should keep the origin only: path, query and fragment are dropped', () => {
    expect(baseUrlAuthAdmin('https://admin.exemple.test/admin/connexion?x=1#a')).toBe('https://admin.exemple.test/api/auth')
  })

  it('should keep the port in the origin', () => {
    expect(baseUrlAuthAdmin('http://admin.localhost:3000/admin')).toBe('http://admin.localhost:3000/api/auth')
    expect(baseUrlAuthAdmin('https://admin.exemple.test:8443')).toBe('https://admin.exemple.test:8443/api/auth')
  })

  it('should never return the public site URL: the result only depends on the argument', () => {
    expect(baseUrlAuthAdmin('https://admin.exemple.test')).not.toContain('jesuis.pro')
  })
})

describe('originesAdminAutorisees', () => {
  it('should only trust https://ADMIN_HOST in production', () => {
    expect([...originesAdminAutorisees('admin.jesuis.pro', true)]).toEqual(['https://admin.jesuis.pro'])
  })

  it('should add the local development origins outside production', () => {
    expect([...originesAdminAutorisees('admin.jesuis.pro', false)].sort()).toEqual([
      'http://admin.jesuis.pro:3000',
      'http://admin.localhost:3000',
      'https://admin.jesuis.pro',
    ])
  })

  it('should normalise the configured host (case, port, trailing dot)', () => {
    expect([...originesAdminAutorisees('ADMIN.Jesuis.PRO:443.', true)]).toEqual(['https://admin.jesuis.pro'])
  })

  it('should never trust the public host, a look-alike, or a plain-http production origin', () => {
    const production = originesAdminAutorisees('admin.jesuis.pro', true)

    for (const origine of ['https://jesuis.pro', 'http://admin.jesuis.pro', 'https://admin.jesuis.pro:8443', 'https://admin.jesuis.pro.evil.test', 'http://admin.localhost:3000', 'null']) {
      expect(production.has(origine), origine).toBe(false)
    }
  })
})
