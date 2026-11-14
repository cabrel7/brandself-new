import { describe, expect, it } from 'vitest'
import {
  ADMIN_NAV,
  ADMIN_PREFIXE_API,
  ADMIN_PREFIXE_PAGES,
  AUTH_ADMIN_PLUGIN_PREFIXE,
  CHEMINS_AUTH_ADMIN,
  cheminNormalise,
  decisionHote,
  estHoteAdmin,
  normaliserHote,
} from '../../../shared/admin'
import type { DecisionHote } from '../../../shared/admin'

// A1 (D-A1-01, D-A1-02, D-A1-06) : séparation par nom d'hôte. Ces fonctions pures portent TOUTE la décision du
// middleware `server/middleware/00-hote.ts` : la table ci-dessous est donc la preuve de CA02, CA03 et CA04 au
// niveau de la logique (l'e2e prouve le câblage HTTP).

const ADMIN_HOST = 'admin.jesuis.pro'

describe('normaliserHote', () => {
  it.each([
    ['admin.jesuis.pro', 'admin.jesuis.pro'],
    ['ADMIN.JESUIS.PRO', 'admin.jesuis.pro'],
    ['admin.jesuis.pro:443', 'admin.jesuis.pro'],
    ['admin.localhost:3000', 'admin.localhost'],
    ['admin.jesuis.pro.', 'admin.jesuis.pro'],
    ['  admin.jesuis.pro  ', 'admin.jesuis.pro'],
    ['Admin.JesuIs.Pro.:8443', 'admin.jesuis.pro'],
    ['', ''],
    ['   ', ''],
    [':3000', ''],
  ])('should reduce %j to %j', (brut, attendu) => {
    expect(normaliserHote(brut)).toBe(attendu)
  })

  it.each([[null], [undefined]])('should return an empty string for %s', (brut) => {
    expect(normaliserHote(brut)).toBe('')
  })

  it('should keep an IPv6 literal untouched (never an administration host)', () => {
    expect(normaliserHote('[::1]:3000')).toBe('[::1]:3000')
  })
})

describe('estHoteAdmin', () => {
  it.each([
    ['admin.jesuis.pro', true],
    ['ADMIN.JESUIS.PRO', true],
    ['admin.jesuis.pro:443', true],
    ['admin.jesuis.pro.', true],
    [' admin.jesuis.pro ', true],
    ['jesuis.pro', false],
    ['www.jesuis.pro', false],
    // Contournements classiques : sous-domaine ajouté devant ou derrière, hôte de l'attaquant.
    ['admin.jesuis.pro.evil.com', false],
    ['evil-admin.jesuis.pro', false],
    ['xadmin.jesuis.pro', false],
    ['admin.jesuis.pro@evil.com', false],
    ['evil.com/admin.jesuis.pro', false],
    ['admin.jesuis.pro, evil.com', false],
    ['admin.localhost', false],
    ['localhost:3000', false],
    ['[::1]', false],
    ['', false],
    ['   ', false],
  ])('should answer for the Host header %j : %s', (host, attendu) => {
    expect(estHoteAdmin(host, ADMIN_HOST)).toBe(attendu)
  })

  it.each([[null], [undefined]])('should refuse an absent Host header (%s)', (host) => {
    expect(estHoteAdmin(host, ADMIN_HOST)).toBe(false)
  })

  it('should never match when the configured administration host is empty (a missing config must not open anything)', () => {
    expect(estHoteAdmin('', '')).toBe(false)
    expect(estHoteAdmin(null, '')).toBe(false)
    expect(estHoteAdmin('jesuis.pro', '')).toBe(false)
    expect(estHoteAdmin('admin.jesuis.pro', '   ')).toBe(false)
  })

  it('should compare the development host with or without the port', () => {
    expect(estHoteAdmin('admin.localhost:3000', 'admin.localhost')).toBe(true)
    expect(estHoteAdmin('admin.localhost', 'admin.localhost')).toBe(true)
    expect(estHoteAdmin('localhost:3000', 'admin.localhost')).toBe(false)
  })
})

describe('cheminNormalise', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/', '/admin'],
    ['/', '/'],
    ['', '/'],
    ['/admin?x=1', '/admin'],
    ['/admin#ancre', '/admin'],
    ['/admin?a=/../studio', '/admin'],
    ['/%61dmin', '/admin'],
    ['/%41DMIN', '/admin'],
    ['/ADMIN', '/admin'],
    ['/Admin/Utilisateurs', '/admin/utilisateurs'],
    ['//admin', '/admin'],
    ['///admin///x', '/admin/x'],
    ['/x/../admin', '/admin'],
    ['/../admin', '/admin'],
    ['/../../../admin', '/admin'],
    ['/admin/./x', '/admin/x'],
    ['/admin/../studio', '/studio'],
    ['/admin%2fx', '/admin/x'],
    ['/admin%2Fx', '/admin/x'],
    ['/%2e%2e/admin', '/admin'],
    ['/%2E%2E%2Fadmin', '/admin'],
    ['/a/%2e%2e/%2e%2e/admin', '/admin'],
    // Décodé UNE seule fois : un double encodage ne devient pas un séparateur.
    ['/admin%252fx', '/admin%2fx'],
    ['/%2561dmin', '/%61dmin'],
    // Pas de repliement Unicode : un caractère pleine chasse n'est jamais « admin ».
    ['/ａdmin', '/ａdmin'],
  ])('should normalise %j to %j', (brut, attendu) => {
    expect(cheminNormalise(brut)).toBe(attendu)
  })

  it.each([
    ['antislash brut', '/admin\\x'],
    ['antislash seul', '\\admin'],
    ['antislash encodé', '/%5cadmin'],
    ['antislash encodé en majuscules', '/%5Cadmin'],
    ['encodage invalide (séquence UTF-8 tronquée)', '/%E0%A4%A'],
    ['pourcentage final', '/admin%'],
    ['pourcentage non hexadécimal', '/admin%zz'],
    ['octet nul encodé', '/admin%00'],
    ['octet nul brut', '/admin\0x'],
    ['octet nul au milieu', '/a%00b'],
  ])('should return null for an unreadable path (%s)', (_cas, brut) => {
    expect(cheminNormalise(brut)).toBeNull()
  })
})

type Cas = readonly [chemin: string, attendu: DecisionHote]

/** Tous les chemins qui DOIVENT être refusés sur l'hôte d'administration (studio, vitrines, PWA, MCP, SEO, OAuth…). */
const REFUSES_SUR_HOTE_ADMIN: readonly string[] = [
  '/',
  '',
  '/studio',
  '/studio/vitrine',
  '/@dr-cabrel',
  '/dr-cabrel',
  '/dr-cabrel/services',
  '/connexion',
  '/inscription',
  '/onboarding',
  '/tarifs',
  '/api/studio/moi',
  '/api/studio/vitrine',
  '/api/public/dr-cabrel/vue',
  '/api/health',
  '/sw.js',
  '/manifest.json',
  '/manifest.webmanifest',
  '/mcp',
  '/mcp/messages',
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/__sitemap__/urls.json',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/api/auth/sign-in/social',
  '/api/auth/sign-in/phone-number',
  '/api/auth/phone-number/send-otp',
  '/api/auth/phone-number/verify',
  '/api/auth/callback/google',
  '/api/auth/update-user',
  '/api/auth/delete-user',
  '/api/auth/list-sessions',
  '/api/auth/revoke-session',
  '/api/auth/oauth2/authorize',
  '/api/auth/oauth2/register',
  '/api/auth/mcp/register',
  '/api/auth/email-otp/check-verification-otp',
  '/api/auth',
  '/api/auth/',
  '/api/webhooks/kpay',
  // Préfixes qui commencent comme un préfixe autorisé sans en être un.
  '/administrateur',
  '/adminx',
  '/api/administrateur',
  '/api/adminx/session',
  '/apiadmin',
  '/_nuxtx/entry.js',
  '/_nuxt-evil',
  '/brandx/logo.svg',
  '/brand-evil',
  '/__nuxt_errorx',
  '/favicon.ico/x',
  '/favicon.icox',
  '/favicon.png',
  // Chemins exacts : une variante plus longue de la liste blanche /api/auth est refusée.
  '/api/auth/get-session/x',
  '/api/auth/sign-out/x',
  '/api/auth/sign-in/email-otp/x',
  '/api/auth/email-otp/send-verification-otp/x',
  '/api/auth/get-sessions',
  // Traversées qui sortent de l'hôte d'administration.
  '/x/../studio',
  '/admin/../studio',
  '/admin/..%2fstudio',
  '/admin/%2e%2e/studio',
  '/_nuxt/../studio',
  '/_nuxt/..%2f..%2fapi/studio/moi',
  '/api/admin/../studio/moi',
  '/api/admin/..%2f..%2fapi/studio/moi',
  '/brand/../sw.js',
  '/%73tudio',
  '/%53TUDIO',
  '//studio',
  '/./studio',
  // Illisibles : toujours refusés.
  '/admin\\x',
  '/%5cadmin',
  '/%E0%A4%A',
  '/admin%00',
  '/admin\0x',
  // Plugin admin de Better Auth : fermé partout.
  `${AUTH_ADMIN_PLUGIN_PREFIXE}/set-role`,
  `${AUTH_ADMIN_PLUGIN_PREFIXE}/impersonate-user`,
  `${AUTH_ADMIN_PLUGIN_PREFIXE}/stop-impersonating`,
  `${AUTH_ADMIN_PLUGIN_PREFIXE}/ban-user`,
  `${AUTH_ADMIN_PLUGIN_PREFIXE}/remove-user`,
  AUTH_ADMIN_PLUGIN_PREFIXE,
]

/** Tous les chemins qui DOIVENT passer sur l'hôte d'administration. */
const LAISSES_SUR_HOTE_ADMIN: readonly string[] = [
  '/admin',
  '/admin/',
  '/admin/connexion',
  '/admin/utilisateurs',
  '/admin/utilisateurs/une-fiche',
  '/admin?redirection=/admin/vitrines',
  '/admin#ancre',
  '/api/admin',
  '/api/admin/session',
  '/api/admin/vue-ensemble',
  '/api/admin/reauth/code',
  '/api/admin/deconnexion',
  '/api/admin/session?x=1',
  '/_nuxt/entry.js',
  '/_nuxt/builds/meta/dev.json',
  '/_nuxt',
  '/_fonts/Fraunces.woff2',
  '/api/_nuxt_icon/ph.json',
  '/__nuxt_error',
  '/brand/logo.svg',
  '/brand/icone.png',
  '/favicon.ico',
  '/favicon.ico?v=2',
  '/api/auth/get-session',
  '/api/auth/get-session/',
  '/api/auth/get-session?disableCookieCache=true',
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/sign-in/email-otp',
  '/api/auth/sign-out',
  // Normalisation : la décision porte sur le chemin réel, pas sur sa forme écrite.
  '/ADMIN',
  '/%61dmin',
  '//admin',
  '/x/../admin',
  '/API/ADMIN/session',
  '/admin%2fconnexion',
  '/api/auth/../admin/session',
]

describe('decisionHote : hôte d\'administration (D-A1-01, CA03)', () => {
  it.each(REFUSES_SUR_HOTE_ADMIN.map((chemin): Cas => [chemin, 'refuser']))('should refuse %j', (chemin, attendu) => {
    expect(decisionHote(chemin, true)).toBe(attendu)
  })

  it.each(LAISSES_SUR_HOTE_ADMIN.map((chemin): Cas => [chemin, 'laisser']))('should let %j through', (chemin, attendu) => {
    expect(decisionHote(chemin, true)).toBe(attendu)
  })

  it('should let every link of the sidebar through', () => {
    for (const entree of ADMIN_NAV) {
      expect(decisionHote(entree.to, true), entree.to).toBe('laisser')
    }
  })

  it('should let exactly the four authentication endpoints of the whitelist through', () => {
    expect([...CHEMINS_AUTH_ADMIN].sort()).toEqual([
      '/api/auth/email-otp/send-verification-otp',
      '/api/auth/get-session',
      '/api/auth/sign-in/email-otp',
      '/api/auth/sign-out',
    ])
    for (const chemin of CHEMINS_AUTH_ADMIN) {
      expect(decisionHote(chemin, true), chemin).toBe('laisser')
    }
  })
})

describe('decisionHote : hôte public (D-A1-01, CA02)', () => {
  it.each([
    '/admin',
    '/admin/',
    '/admin/connexion',
    '/admin/utilisateurs',
    '/admin?x=1',
    '/api/admin',
    '/api/admin/session',
    '/api/admin/vue-ensemble',
    '/api/admin/reauth/code',
    '/api/admin/deconnexion',
    '/ADMIN',
    '/Admin/Journal',
    '/%61dmin',
    '/%41dmin/x',
    '//admin',
    '///api//admin//session',
    '/x/../admin',
    '/studio/../admin',
    '/admin%2fx',
    '/api/%61dmin/session',
    '/api/auth/../admin/session',
    '/api/studio/../admin/session',
    '/API/ADMIN/session',
    '/admin\\x',
    '/%5cadmin',
    '/%E0%A4%A',
    '/admin%00',
  ])('should refuse the administration path %j', (chemin) => {
    expect(decisionHote(chemin, false)).toBe('refuser')
  })

  it.each([
    '/',
    '/studio',
    '/studio/vitrine',
    '/@dr-cabrel',
    '/dr-cabrel',
    '/connexion',
    '/tarifs',
    '/api/studio/moi',
    '/api/public/dr-cabrel/vue',
    '/api/health',
    '/api/auth/get-session',
    '/api/auth/sign-in/social',
    '/api/auth/sign-in/email-otp',
    '/api/auth/phone-number/send-otp',
    '/api/auth/oauth2/authorize',
    '/sw.js',
    '/manifest.json',
    '/mcp',
    '/robots.txt',
    '/sitemap.xml',
    '/.well-known/oauth-authorization-server',
    '/_nuxt/entry.js',
    // Ne commencent pas par le préfixe d'administration : jamais refusés par erreur.
    '/administrateur',
    '/adminx',
    '/api/administrateur',
    '/api/adminx/session',
    '/apiadmin',
    '/studio/admin',
    '/dr-cabrel/admin',
  ])('should leave the public path %j alone', (chemin) => {
    expect(decisionHote(chemin, false)).toBe('laisser')
  })
})

describe('decisionHote : routes du plugin admin de Better Auth fermées sur les DEUX hôtes (D-A1-03, CA04)', () => {
  const CHEMINS_PLUGIN = [
    '/api/auth/admin/impersonate-user',
    '/api/auth/admin/set-role',
    '/api/auth/admin/stop-impersonating',
    '/api/auth/admin/ban-user',
    '/api/auth/admin/unban-user',
    '/api/auth/admin/remove-user',
    '/api/auth/admin/create-user',
    '/api/auth/admin/list-users',
    '/api/auth/admin/revoke-user-sessions',
    '/api/auth/admin/set-user-password',
    '/api/auth/admin',
    '/api/auth/admin/',
    '/api/auth/ADMIN/set-role',
    '/api/auth/%61dmin/set-role',
    '/api/auth//admin/set-role',
    '/api/auth/x/../admin/set-role',
    '/api/auth/admin%2fset-role',
    '/api/auth/admin/set-role?x=1',
    '/api/auth/admin/set-role#x',
  ]

  it.each(CHEMINS_PLUGIN)('should refuse %j on the administration host', (chemin) => {
    expect(decisionHote(chemin, true)).toBe('refuser')
  })

  it.each(CHEMINS_PLUGIN)('should refuse %j on the public host', (chemin) => {
    expect(decisionHote(chemin, false)).toBe('refuser')
  })

  it.each(CHEMINS_PLUGIN)('should refuse %j even in development mode, on both hosts', (chemin) => {
    expect(decisionHote(chemin, true, true)).toBe('refuser')
    expect(decisionHote(chemin, false, true)).toBe('refuser')
  })

  it('should not close the other Better Auth routes that merely contain the word admin', () => {
    expect(decisionHote('/api/auth/administrator', false)).toBe('laisser')
    expect(decisionHote('/api/auth/sign-in/admin', false)).toBe('laisser')
  })
})

describe('decisionHote : serveur de développement (dev = true)', () => {
  it.each([
    '/@vite/client',
    '/@vite/env',
    '/@fs/home/projet/node_modules/x.js',
    '/@id/virtual:nuxt',
    '/__nuxt_vite_node__/manifest',
    '/node_modules/.vite/deps/vue.js',
    '/__vite_ping',
  ])('should let %j through on the administration host in development only', (chemin) => {
    expect(decisionHote(chemin, true, true)).toBe('laisser')
    expect(decisionHote(chemin, true, false)).toBe('refuser')
    expect(decisionHote(chemin, true)).toBe('refuser')
  })

  it('should never open anything else with dev = true: every refused path stays refused', () => {
    for (const chemin of REFUSES_SUR_HOTE_ADMIN) {
      expect(decisionHote(chemin, true, true), chemin).toBe('refuser')
    }
  })

  it('should not let a traversal out of the dev prefixes through', () => {
    expect(decisionHote('/@vite/../studio', true, true)).toBe('refuser')
    expect(decisionHote('/node_modules/../studio', true, true)).toBe('refuser')
    expect(decisionHote('/@fs/../sw.js', true, true)).toBe('refuser')
    expect(decisionHote('/__vite_pingx', true, true)).toBe('refuser')
  })

  it('should not change anything for the public host', () => {
    for (const chemin of ['/studio', '/dr-cabrel', '/api/studio/moi', '/@vite/client']) {
      expect(decisionHote(chemin, false, true), chemin).toBe(decisionHote(chemin, false, false))
    }
    expect(decisionHote('/admin', false, true)).toBe('refuser')
    expect(decisionHote('/api/admin/session', false, true)).toBe('refuser')
  })
})

describe('séparation des deux hôtes : jamais de chemin servi par les deux (sauf liste blanche d\'authentification)', () => {
  it('should serve the administration prefixes on the administration host only', () => {
    for (const prefixe of [ADMIN_PREFIXE_PAGES, ADMIN_PREFIXE_API, `${ADMIN_PREFIXE_PAGES}/utilisateurs`, `${ADMIN_PREFIXE_API}/session`]) {
      expect(decisionHote(prefixe, true), `${prefixe} sur l'hôte admin`).toBe('laisser')
      expect(decisionHote(prefixe, false), `${prefixe} sur l'hôte public`).toBe('refuser')
    }
  })

  it('should serve the studio on the public host only', () => {
    for (const chemin of ['/studio', '/api/studio/moi', '/dr-cabrel', '/sw.js', '/mcp']) {
      expect(decisionHote(chemin, false), `${chemin} sur l'hôte public`).toBe('laisser')
      expect(decisionHote(chemin, true), `${chemin} sur l'hôte admin`).toBe('refuser')
    }
  })
})
