import { describe, expect, it } from 'vitest'
import { ADMIN_HOST_DEV_DEFAUT } from '../../../shared/admin'
import { loadDrapeauxPublics, loadEnv } from '../../../shared/env'

// A1 (D-A1-02) : `ADMIN_HOST` = nom d'hôte seul (sans port, sans schéma, sans chemin), en minuscules, obligatoire en
// production, différent de l'hôte public, `admin.localhost` par défaut hors production.

const valide = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}

const production = {
  ...valide,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_x',
  EMAIL_EXPEDITEUR: 'Brandself <bonjour@jesuis.pro>',
  NUXT_PUBLIC_SITE_URL: 'https://jesuis.pro/',
  ADMIN_HOST: 'admin.jesuis.pro',
  // Éviction du cache des images : obligatoire en production.
  MEDIAS_CACHE_REFRESH_SECRET: 'secret-de-test-cache-images-0123456789',
  // E1 (D4) : secret dédié de l'empreinte d'essai, obligatoire en production (32 caractères au moins).
  ESSAI_EMPREINTE_SECRET: 'secret-de-test-empreinte-essai-0123456789',
}

function messageDe(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source)
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
  throw new Error('loadEnv devait refuser cette configuration.')
}

describe('ADMIN_HOST : valeurs acceptées', () => {
  it.each([
    ['admin.jesuis.pro', 'admin.jesuis.pro'],
    ['admin.localhost', 'admin.localhost'],
    ['admin.staging.jesuis.pro', 'admin.staging.jesuis.pro'],
    ['a-dmin.jesuis.pro', 'a-dmin.jesuis.pro'],
    ['admin.ci.example', 'admin.ci.example'],
  ])('should accept the host name %s', (brut, attendu) => {
    expect(loadEnv({ ...valide, ADMIN_HOST: brut }).ADMIN_HOST).toBe(attendu)
  })

  it('should bring uppercase letters back to lowercase', () => {
    expect(loadEnv({ ...valide, ADMIN_HOST: 'ADMIN.JesuIs.PRO' }).ADMIN_HOST).toBe('admin.jesuis.pro')
  })

  it('should trim surrounding spaces', () => {
    expect(loadEnv({ ...valide, ADMIN_HOST: '  admin.jesuis.pro \n' }).ADMIN_HOST).toBe('admin.jesuis.pro')
  })

  it('should accept it in production when it differs from the public host', () => {
    expect(loadEnv(production).ADMIN_HOST).toBe('admin.jesuis.pro')
  })

  it('should accept a sibling sub-domain of the public host (admin.jesuis.pro vs jesuis.pro)', () => {
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'admin.jesuis.pro', NUXT_PUBLIC_SITE_URL: 'https://jesuis.pro' })).not.toThrow()
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'admin.jesuis.pro', NUXT_PUBLIC_SITE_URL: 'https://www.jesuis.pro' })).not.toThrow()
  })
})

describe('ADMIN_HOST : valeurs refusées', () => {
  it.each([
    ['avec un port', 'admin.jesuis.pro:3000'],
    ['avec le port de développement', 'admin.localhost:3000'],
    ['avec un schéma https', 'https://admin.jesuis.pro'],
    ['avec un schéma http et un port', 'http://admin.localhost:3000'],
    ['avec un chemin', 'admin.jesuis.pro/admin'],
    ['avec une barre finale', 'admin.jesuis.pro/'],
    ['avec une requête', 'admin.jesuis.pro?x=1'],
    ['avec des identifiants', 'user@admin.jesuis.pro'],
    ['avec un espace au milieu', 'admin .jesuis.pro'],
    ['avec une liste d\'hôtes', 'admin.jesuis.pro,evil.com'],
    ['avec un joker', '*.jesuis.pro'],
    ['avec un tiret en tête de libellé', '-admin.jesuis.pro'],
    ['avec un libellé vide (deux points)', 'admin..jesuis.pro'],
    ['avec un point initial', '.jesuis.pro'],
    ['avec un point final', 'admin.jesuis.pro.'],
    ['avec un caractère non DNS', 'admin_jesuis.pro'],
    ['réduit à un seul libellé', 'admin'],
    ['réduit à localhost', 'localhost'],
    ['avec un antislash', 'admin.jesuis.pro\\x'],
    ['qui est une adresse IPv4 (loopback)', '127.0.0.1'],
    ['qui est une adresse IPv4 privée', '192.168.1.10'],
  ])('should refuse a value %s (%s)', (_cas, brut) => {
    expect(() => loadEnv({ ...valide, ADMIN_HOST: brut })).toThrow(/ADMIN_HOST/)
  })

  it('should never echo the rejected value in the error message', () => {
    const message = messageDe({ ...valide, ADMIN_HOST: 'https://valeur-unique-a-ne-pas-reveler.example:9999/x' })

    expect(message).toContain('ADMIN_HOST')
    expect(message).not.toContain('valeur-unique-a-ne-pas-reveler')
    expect(message).not.toContain('9999')
  })

  it('should refuse the same invalid value in production', () => {
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'admin.jesuis.pro:443' })).toThrow(/ADMIN_HOST/)
  })
})

describe('ADMIN_HOST : absent, vide, défaut', () => {
  it.each([
    ['absente', undefined],
    ['vide', ''],
    ['réduite à des espaces', '   '],
  ])('should fall back to admin.localhost outside production when the variable is %s', (_cas, brut) => {
    const source: Record<string, string | undefined> = { ...valide }
    if (brut !== undefined) source.ADMIN_HOST = brut

    expect(loadEnv(source).ADMIN_HOST).toBe(ADMIN_HOST_DEV_DEFAUT)
    expect(ADMIN_HOST_DEV_DEFAUT).toBe('admin.localhost')
  })

  it.each(['development', 'test'])('should fall back to admin.localhost with NODE_ENV=%s', (nodeEnv) => {
    expect(loadEnv({ ...valide, NODE_ENV: nodeEnv }).ADMIN_HOST).toBe('admin.localhost')
  })

  it('should be required in production when absent', () => {
    const { ADMIN_HOST: _absent, ...sansAdminHost } = production

    expect(() => loadEnv(sansAdminHost)).toThrow(/ADMIN_HOST/)
    expect(messageDe(sansAdminHost)).toMatch(/requis en production/)
  })

  it.each([
    ['vide', ''],
    ['réduite à des espaces', '   '],
  ])('should be required in production when the variable is %s (empty = absent, never the dev default)', (_cas, brut) => {
    expect(() => loadEnv({ ...production, ADMIN_HOST: brut })).toThrow(/ADMIN_HOST/)
  })

  it('should never apply the development default in production', () => {
    const { ADMIN_HOST: _absent, ...sansAdminHost } = production

    expect(() => loadEnv(sansAdminHost)).toThrow()
  })
})

describe('ADMIN_HOST : différent de l\'hôte public (NUXT_PUBLIC_SITE_URL)', () => {
  it('should refuse the same host name as the public site in production', () => {
    const message = messageDe({ ...production, ADMIN_HOST: 'jesuis.pro' })

    expect(message).toContain('ADMIN_HOST')
    expect(message).toMatch(/différent/)
  })

  it('should compare case-insensitively (URL host names are lowercased, ADMIN_HOST is too)', () => {
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'JESUIS.PRO' })).toThrow(/ADMIN_HOST/)
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'jesuis.pro', NUXT_PUBLIC_SITE_URL: 'https://JesuIs.Pro/' })).toThrow(/ADMIN_HOST/)
  })

  it('should ignore the port and the path of the public URL when comparing', () => {
    expect(() => loadEnv({ ...production, ADMIN_HOST: 'jesuis.pro', NUXT_PUBLIC_SITE_URL: 'https://jesuis.pro:8443/accueil' })).toThrow(/ADMIN_HOST/)
  })

  it('should also refuse it outside production when both hosts are the same', () => {
    expect(() => loadEnv({ ...valide, ADMIN_HOST: 'admin.localhost', NUXT_PUBLIC_SITE_URL: 'http://admin.localhost:3000' })).toThrow(/ADMIN_HOST/)
  })

  it('should accept the development default against the default public site (localhost)', () => {
    expect(() => loadEnv({ ...valide, NUXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).not.toThrow()
  })

  it('should not fail on the host comparison when the public URL is unreadable (the URL rule reports it)', () => {
    const message = messageDe({ ...valide, ADMIN_HOST: 'admin.jesuis.pro', NUXT_PUBLIC_SITE_URL: 'pas-une-url' })

    expect(message).toContain('NUXT_PUBLIC_SITE_URL')
    expect(message).not.toMatch(/ADMIN_HOST/)
  })
})

describe('loadDrapeauxPublics : adminHost (runtimeConfig.public.adminHost)', () => {
  it('should expose the configured host', () => {
    expect(loadDrapeauxPublics({ ...valide, ADMIN_HOST: 'admin.jesuis.pro' }, ['dev']).adminHost).toBe('admin.jesuis.pro')
  })

  it('should expose the development default when the variable is absent', () => {
    expect(loadDrapeauxPublics(valide, ['dev']).adminHost).toBe('admin.localhost')
  })

  it('should expose the lowercase host', () => {
    expect(loadDrapeauxPublics({ ...valide, ADMIN_HOST: 'ADMIN.JESUIS.PRO' }, ['dev']).adminHost).toBe('admin.jesuis.pro')
  })

  it('should expose the host of a valid production configuration', () => {
    expect(loadDrapeauxPublics(production, ['build']).adminHost).toBe('admin.jesuis.pro')
  })

  it('should fail a dev/build run when the value is invalid or missing in production', () => {
    expect(() => loadDrapeauxPublics({ ...valide, ADMIN_HOST: 'admin.jesuis.pro:3000' }, ['dev'])).toThrow(/ADMIN_HOST/)
    const { ADMIN_HOST: _absent, ...sansAdminHost } = production
    expect(() => loadDrapeauxPublics(sansAdminHost, ['build'])).toThrow(/ADMIN_HOST/)
  })

  it('should expose a host name only: no port, no scheme', () => {
    const { adminHost } = loadDrapeauxPublics({ ...valide, ADMIN_HOST: 'admin.jesuis.pro' }, ['dev'])

    expect(adminHost).not.toMatch(/[:/]/)
  })

  it.each([['prepare'], ['typecheck']])('should tolerate an empty environment for %s with the development default', (commande) => {
    expect(loadDrapeauxPublics({}, ['node', 'nuxt', commande]).adminHost).toBe('admin.localhost')
  })

  it.each([['prepare'], ['typecheck']])('should read ADMIN_HOST for %s, in lowercase', (commande) => {
    expect(loadDrapeauxPublics({ ADMIN_HOST: 'ADMIN.JESUIS.PRO' }, ['node', 'nuxt', commande]).adminHost).toBe('admin.jesuis.pro')
  })

  it.each([['prepare'], ['typecheck']])('should fall back to the safe default for %s when the value is invalid (never throw)', (commande) => {
    expect(loadDrapeauxPublics({ ADMIN_HOST: 'https://admin.jesuis.pro:3000/x' }, ['node', 'nuxt', commande]).adminHost).toBe('admin.localhost')
  })

  it('should keep the other public flags untouched', () => {
    expect(loadDrapeauxPublics(valide, ['dev'])).toEqual({ googleActif: false, boiteOtpDev: true, paiementEnLigne: false, adminHost: 'admin.localhost' })
  })
})
