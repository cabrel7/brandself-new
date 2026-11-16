import { describe, expect, it } from 'vitest'
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_FORMAT,
  ADMIN_CIBLE_ID_MAX,
  ADMIN_CIBLE_TYPE_FORMAT,
  ADMIN_MOTIF_MAX,
  ADMIN_MOTIF_MIN,
  ADMIN_NAV,
  ADMIN_REAUTH_CODE_FORMAT,
  ADMIN_REAUTH_ENTETE,
  ADMIN_REAUTH_ESSAIS,
  ADMIN_REAUTH_LIMITE,
  ADMIN_REAUTH_TTL_S,
  ADMIN_SESSION_DUREE_S,
  AUDIT_CLE_FORMAT,
  AUDIT_VALEUR_TEXTE_MAX,
  CLES_AUDIT_INTERDITES,
  ROLES,
  ROLE_PAR_DEFAUT,
  SUPERADMIN,
} from '../../../shared/admin'
import { ERROR_CODES, ERROR_STATUS } from '../../../shared/erreurs'
import { ERROR_MESSAGES } from '../../../server/exceptions/http'
import { JOBS } from '../../../shared/jobs'
import {
  schemaAdminSessionDto,
  schemaDemandeReauth,
  schemaMotifAdmin,
  schemaReauthReponse,
} from '../../../shared/schemas/admin'
import { schemaVueEnsembleEnrichieDto } from '../../../shared/schemas/admin-paiements'

// A1 : valeurs décidées (spec §1, §8) figées ici, pour qu'une modification soit volontaire, et contrats Zod stricts.

describe('constantes décidées de l\'administration', () => {
  it('should pin the session duration to 8 hours, absolute', () => {
    expect(ADMIN_SESSION_DUREE_S).toBe(8 * 60 * 60)
  })

  it('should pin the re-authentication parameters: 10 min, 3 attempts, 5 requests per 15 min', () => {
    expect(ADMIN_REAUTH_TTL_S).toBe(600)
    expect(ADMIN_REAUTH_ESSAIS).toBe(3)
    expect(ADMIN_REAUTH_LIMITE).toEqual({ limit: 5, windowS: 900 })
  })

  it('should read the re-authentication proof from the X-Admin-Reauth header (lowercase, as Node exposes it)', () => {
    expect(ADMIN_REAUTH_ENTETE).toBe('x-admin-reauth')
  })

  it('should have exactly two roles, the default one being the ordinary account', () => {
    expect([...ROLES]).toEqual(['user', 'superadmin'])
    expect(ROLE_PAR_DEFAUT).toBe('user')
    expect(SUPERADMIN).toBe('superadmin')
  })

  it('should bound the motive like the journal CHECK constraint (5 to 500 characters)', () => {
    expect(ADMIN_MOTIF_MIN).toBe(5)
    expect(ADMIN_MOTIF_MAX).toBe(500)
  })

  it('should bound the audit values to 64 characters and the target identifier to 64', () => {
    expect(AUDIT_VALEUR_TEXTE_MAX).toBe(64)
    expect(ADMIN_CIBLE_ID_MAX).toBe(64)
  })

  it.each(['email', 'telephone', 'nom', 'name', 'message', 'contenu', 'motif_visiteur', 'sujet'])(
    'should blacklist the audit key "%s" (D-A1-09)',
    (cle) => {
      expect(CLES_AUDIT_INTERDITES).toContain(cle)
    },
  )

  it('should only blacklist keys that the key format would otherwise accept (a dead entry hides a typo)', () => {
    for (const cle of CLES_AUDIT_INTERDITES) {
      expect(cle, cle).toMatch(AUDIT_CLE_FORMAT)
    }
    expect(new Set(CLES_AUDIT_INTERDITES).size).toBe(CLES_AUDIT_INTERDITES.length)
  })

  it('should name every journalled action domain.verb, in lowercase', () => {
    for (const action of Object.values(ADMIN_ACTIONS)) {
      expect(action, action).toMatch(ADMIN_ACTION_FORMAT)
    }
    expect(ADMIN_ACTIONS.superadminCreer).toBe('superadmin.creer')
    expect(ADMIN_ACTIONS.superadminReinitialiser).toBe('superadmin.reinitialiser')
  })

  it('should use the Phosphor icon family only, and the user-facing vocabulary', () => {
    expect(ADMIN_NAV.map((e) => e.id)).toEqual(['vue-ensemble', 'utilisateurs', 'vitrines', 'abonnements', 'systemes', 'reglages', 'catalogues', 'versions', 'journal'])
    for (const entree of ADMIN_NAV) {
      expect(entree.icone, entree.id).toMatch(/^i-ph-[a-z-]+$/)
      expect(entree.to, entree.id).toMatch(/^\/admin(\/[a-z-]+)?$/)
    }
    expect(new Set(ADMIN_NAV.map((e) => e.to)).size).toBe(ADMIN_NAV.length)
  })
})

describe('format du code de réauthentification', () => {
  it.each(['000000', '123456', '999999'])('should accept %s', (code) => {
    expect(ADMIN_REAUTH_CODE_FORMAT.test(code)).toBe(true)
  })

  it.each(['', '12345', '1234567', '12 456', 'abcdef', '12345a', ' 123456', '123456\n', '１２３４５６'])('should refuse %j', (code) => {
    expect(ADMIN_REAUTH_CODE_FORMAT.test(code)).toBe(false)
  })
})

describe('format des champs du journal', () => {
  it.each(['compte.supprimer', 'superadmin.creer', 'plan_abonnement.changer'])('should accept the action %s', (action) => {
    expect(ADMIN_ACTION_FORMAT.test(action)).toBe(true)
  })

  it.each(['compte', 'Compte.supprimer', 'compte.Supprimer', 'compte.supprimer.tout', 'compte-supprimer', 'compte.supprimer1', '.supprimer', 'compte.', 'compte supprimer', ''])(
    'should refuse the action %j',
    (action) => {
      expect(ADMIN_ACTION_FORMAT.test(action)).toBe(false)
    },
  )

  it.each(['user', 'vitrine', 'plan_abonnement'])('should accept the target type %s', (type) => {
    expect(ADMIN_CIBLE_TYPE_FORMAT.test(type)).toBe(true)
  })

  it.each(['', 'User', 'user1', 'plan-abonnement', 'user.vitrine'])('should refuse the target type %j', (type) => {
    expect(ADMIN_CIBLE_TYPE_FORMAT.test(type)).toBe(false)
  })
})

describe('schemaDemandeReauth (corps de POST /api/admin/reauth/code)', () => {
  const valide = { action: 'compte.supprimer', cibleType: 'user', cibleId: 'a1b2c3d4-0000-4000-8000-000000000001' }

  it('should accept a complete request', () => {
    expect(schemaDemandeReauth.parse(valide)).toEqual(valide)
  })

  it('should accept a request without target identifier', () => {
    expect(schemaDemandeReauth.parse({ action: 'reglage.modifier', cibleType: 'reglage' })).toEqual({ action: 'reglage.modifier', cibleType: 'reglage' })
  })

  it('should refuse an unknown key (strict)', () => {
    expect(schemaDemandeReauth.safeParse({ ...valide, email: 'x@exemple.test' }).success).toBe(false)
    expect(schemaDemandeReauth.safeParse({ ...valide, adminId: 'autre-admin' }).success).toBe(false)
  })

  it.each([
    ['action absente', { cibleType: 'user' }],
    ['action mal formée', { ...valide, action: 'Compte-Supprimer' }],
    ['type de cible absent', { action: 'compte.supprimer' }],
    ['type de cible mal formé', { ...valide, cibleType: 'User1' }],
    ['identifiant vide', { ...valide, cibleId: '' }],
    ['identifiant trop long', { ...valide, cibleId: 'x'.repeat(ADMIN_CIBLE_ID_MAX + 1) }],
    ['identifiant non texte', { ...valide, cibleId: 12 }],
    ['corps nul', null],
    ['corps vide', {}],
  ])('should refuse %s', (_cas, corps) => {
    expect(schemaDemandeReauth.safeParse(corps).success).toBe(false)
  })

  it('should accept an identifier of exactly 64 characters', () => {
    expect(schemaDemandeReauth.safeParse({ ...valide, cibleId: 'x'.repeat(ADMIN_CIBLE_ID_MAX) }).success).toBe(true)
  })
})

describe('schemaMotifAdmin', () => {
  it('should accept a motive of 5 to 500 characters and trim it', () => {
    expect(schemaMotifAdmin.parse('  Demande du titulaire  ')).toBe('Demande du titulaire')
    expect(schemaMotifAdmin.safeParse('a'.repeat(ADMIN_MOTIF_MIN)).success).toBe(true)
    expect(schemaMotifAdmin.safeParse('a'.repeat(ADMIN_MOTIF_MAX)).success).toBe(true)
  })

  it.each([
    ['vide', ''],
    ['espaces seuls', '          '],
    ['4 caractères', 'abcd'],
    ['4 caractères entourés d\'espaces', '   abcd   '],
    ['501 caractères', 'a'.repeat(ADMIN_MOTIF_MAX + 1)],
  ])('should refuse a motive that is %s', (_cas, motif) => {
    expect(schemaMotifAdmin.safeParse(motif).success).toBe(false)
  })

  it.each([[undefined], [null], [12345]])('should refuse a non-text motive (%s)', (motif) => {
    expect(schemaMotifAdmin.safeParse(motif).success).toBe(false)
  })
})

describe('schémas de réponse (listes blanches strictes)', () => {
  const maintenant = new Date('2026-11-14T10:00:00.000Z').toISOString()

  it('should accept exactly { id, nom, email, expireLe } for the admin session', () => {
    const dto = { id: 'u1', nom: 'Administrateur de test', email: 'admin@exemple.test', expireLe: maintenant }

    expect(schemaAdminSessionDto.parse(dto)).toEqual(dto)
  })

  it('should refuse any extra key in the admin session (a spread of a database row would leak)', () => {
    const dto = { id: 'u1', nom: 'Admin', email: 'admin@exemple.test', expireLe: maintenant }

    for (const extra of [{ role: 'superadmin' }, { token: 'secret' }, { ipAddress: '203.0.113.7' }, { banned: false }, { createdAt: maintenant }]) {
      expect(schemaAdminSessionDto.safeParse({ ...dto, ...extra }).success, JSON.stringify(extra)).toBe(false)
    }
  })

  it('should refuse a session whose expiry is not an ISO date', () => {
    expect(schemaAdminSessionDto.safeParse({ id: 'u1', nom: 'A', email: 'a@exemple.test', expireLe: 'demain' }).success).toBe(false)
    expect(schemaAdminSessionDto.safeParse({ id: 'u1', nom: 'A', email: 'a@exemple.test', expireLe: new Date() }).success).toBe(false)
  })

  // A3 : MODIFIÉ. La vue d'ensemble d'A1 (« { admin: { nom }, genereLe } sans aucun compteur ») est remplacée par la vue
  // enrichie `schemaVueEnsembleEnrichieDto` (shared/schemas/admin-paiements.ts) : compteurs, revenus, indicateur, alertes.
  it('should accept exactly the enriched overview of A3 (counters, revenues, success indicator, alerts) and refuse any extra key', () => {
    const dto = {
      admin: { nom: 'Administrateur de test' },
      compteurs: { inscrits: 12, vitrinesPubliees: 8, abonnesPayants: 3 },
      revenus: [{ devise: 'XAF', encaisseMoisCourant: 47_000, nombre: 3 }],
      indicateurReussite: { vitrinesActives: 5, vitrinesPubliees: 8 },
      mention: 'Montant brut présumé, non confirmé par K-PAY',
      alertes: {
        paiementsEnAttente: { nombre: 0, ids: [] },
        webhooksRefuses1h: 0,
        incoherences: { paiementsSansProlongation: [], abonnementsSansPaiement: [] },
        encaissementsTardifs: 0,
        genereLe: maintenant,
      },
      genereLe: maintenant,
    }

    expect(schemaVueEnsembleEnrichieDto.parse(dto)).toEqual(dto)
    expect(schemaVueEnsembleEnrichieDto.safeParse({ ...dto, utilisateurs: 12 }).success).toBe(false)
    expect(schemaVueEnsembleEnrichieDto.safeParse({ ...dto, admin: { nom: 'A', email: 'a@exemple.test' } }).success).toBe(false)
    expect(schemaVueEnsembleEnrichieDto.safeParse({ ...dto, compteurs: { ...dto.compteurs, inscrits: -1 } }).success).toBe(false)
    expect(schemaVueEnsembleEnrichieDto.safeParse({ ...dto, mention: '' }).success).toBe(false)
  })

  it('should accept exactly { expireLe } for the re-authentication response (never the code)', () => {
    expect(schemaReauthReponse.parse({ expireLe: maintenant })).toEqual({ expireLe: maintenant })
    expect(schemaReauthReponse.safeParse({ expireLe: maintenant, code: '123456' }).success).toBe(false)
  })
})

describe('codes d\'erreur de la réauthentification et du motif', () => {
  it.each([
    ['REAUTH_REQUISE', 403],
    ['REAUTH_INVALIDE', 403],
    ['MOTIF_REQUIS', 422],
  ] as const)('should declare %s with status %i and a French message (server/exceptions/http.ts)', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code], `message de ${code}`).toEqual(expect.any(String))
    expect(ERROR_MESSAGES[code].trim().length).toBeGreaterThan(0)
  })

  it('should give the three codes three different messages', () => {
    const messages = [ERROR_MESSAGES.REAUTH_REQUISE, ERROR_MESSAGES.REAUTH_INVALIDE, ERROR_MESSAGES.MOTIF_REQUIS]

    expect(new Set(messages).size).toBe(3)
  })

  it('should not tell why a code was refused (wrong, expired, already used): one generic message', () => {
    expect(ERROR_MESSAGES.REAUTH_INVALIDE).not.toMatch(/expir|déjà utilisé|essais|tentative/i)
  })

  it('should keep the error codes, their statuses and their messages in step', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort())
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort())
  })
})

describe('JOBS', () => {
  it('should give every job its own name, the re-authentication e-mail included', () => {
    const noms = Object.values(JOBS)

    expect(new Set(noms).size).toBe(noms.length)
    expect(JOBS.sendAdminReauthEmail).toBe('send-admin-reauth-email')
  })
})
