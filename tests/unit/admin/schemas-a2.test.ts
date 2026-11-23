import { describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS, ADMIN_ACTION_FORMAT, ADMIN_CIBLE_TYPE_FORMAT, ADMIN_CIBLES, CLES_AUDIT_INTERDITES } from '../../../shared/admin'
import { ADMIN_A2_EMAIL_TYPES } from '../../../shared/admin-a2'
import { estVitrinePublique } from '../../../shared/admin-visibilite'
import { ERROR_CODES, ERROR_STATUS } from '../../../shared/erreurs'
import { TRANSACTIONAL_EMAIL_TYPES } from '../../../shared/jobs'
import {
  schemaActionMotif,
  schemaChangerPlan,
  schemaCleIdempotence,
  schemaListeUtilisateursQuery,
  schemaOffrirJours,
  schemaRechercheQuery,
  schemaSupprimerUtilisateur,
  schemaUtilisateurLigneDto,
} from '../../../shared/schemas/admin-a2'

const MOTIF = 'Demande du titulaire'
const INSTANT = '2026-11-14T10:00:00.000Z'

describe('actions et cibles du journal A2 et A3', () => {
  it('should name every action domain.verb and every target in the journal formats', () => {
    for (const action of Object.values(ADMIN_ACTIONS)) expect(action, action).toMatch(ADMIN_ACTION_FORMAT)
    for (const cible of Object.values(ADMIN_CIBLES)) expect(cible, cible).toMatch(ADMIN_CIBLE_TYPE_FORMAT)
    expect(new Set(Object.values(ADMIN_ACTIONS)).size).toBe(Object.values(ADMIN_ACTIONS).length)
  })

  it('should declare the actions of the specs verbatim', () => {
    expect(ADMIN_ACTIONS.utilisateurSuspendre).toBe('utilisateur.suspendre')
    expect(ADMIN_ACTIONS.utilisateurOffrirJours).toBe('utilisateur.offrir_jours')
    expect(ADMIN_ACTIONS.vitrineDepublier).toBe('vitrine.depublier')
    expect(ADMIN_ACTIONS.assistantRetirer).toBe('assistant.retirer')
    expect(ADMIN_ACTIONS.paiementReverifier).toBe('paiement.reverifier')
    expect(ADMIN_ACTIONS.paiementMarquerPaye).toBe('paiement.marquer_paye')
    expect(ADMIN_ACTIONS.abonnementRappeler).toBe('abonnement.rappeler')
    expect(ADMIN_ACTIONS.exportPaiements).toBe('export.paiements')
  })
})

describe('codes d\'erreur A2 et A3', () => {
  it.each([
    ['VITRINE_BLOQUEE_ADMIN', 409],
    ['IDEMPOTENCE_CONFLIT', 409],
    ['UTILISATEUR_INTROUVABLE', 404],
    ['PAIEMENT_OUVERT', 409],
    ['DEJA_PAYE', 409],
    ['REVERIFICATION_REQUISE', 409],
    ['RAPPEL_RECENT', 409],
    ['EXPORT_TROP_GRAND', 422],
    ['ABONNEMENT_ECHU', 409],
  ] as const)('should map %s to %i', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
  })
})

describe('e-mails transactionnels A2', () => {
  it('should add the four administration e-mail types, once each', () => {
    expect([...ADMIN_A2_EMAIL_TYPES]).toEqual(['utilisateur_suspendu', 'utilisateur_reactive', 'utilisateur_jours_offerts', 'utilisateur_depubliee'])
    for (const type of ADMIN_A2_EMAIL_TYPES) expect(TRANSACTIONAL_EMAIL_TYPES).toContain(type)
    expect(new Set(TRANSACTIONAL_EMAIL_TYPES).size).toBe(TRANSACTIONAL_EMAIL_TYPES.length)
    // 17 types avant E1 + les deux relances de l'essai gratuit (abonnement_essai_services, abonnement_essai_statistiques).
    expect(TRANSACTIONAL_EMAIL_TYPES).toHaveLength(19)
  })
})

describe('estVitrinePublique (table de vérité, D-A2-03)', () => {
  const publiee = new Date(INSTANT)

  it.each([
    [publiee, false, false, true],
    [null, false, false, false],
    [publiee, true, false, false],
    [publiee, false, true, false],
    [publiee, true, true, false],
    [null, true, true, false],
    [null, true, false, false],
    [null, false, true, false],
  ] as const)('publieeLe=%s blocage=%s suspendu=%s -> %s', (publieeLe, blocageAdmin, suspendu, attendu) => {
    expect(estVitrinePublique({ publieeLe, blocageAdmin }, { suspendu })).toBe(attendu)
  })
})

describe('entrées A2 strictes', () => {
  it('should trim and bound the motive and refuse unknown keys', () => {
    expect(schemaActionMotif.parse({ motif: `  ${MOTIF} ` })).toEqual({ motif: MOTIF })
    expect(schemaActionMotif.safeParse({ motif: 'abcd' }).success).toBe(false)
    expect(schemaActionMotif.safeParse({ motif: MOTIF, extra: 1 }).success).toBe(false)
    expect(schemaActionMotif.safeParse({}).success).toBe(false)
  })

  it('should bound the offered days to 1..365 integers', () => {
    expect(schemaOffrirJours.safeParse({ motif: MOTIF, jours: 1 }).success).toBe(true)
    expect(schemaOffrirJours.safeParse({ motif: MOTIF, jours: 365 }).success).toBe(true)
    for (const jours of [0, 366, -1, 1.5, '30', null]) expect(schemaOffrirJours.safeParse({ motif: MOTIF, jours }).success, String(jours)).toBe(false)
  })

  it('should require days for the paid plan and refuse them for the free plan', () => {
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'payant', jours: 30 }).success).toBe(true)
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'gratuit' }).success).toBe(true)
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'payant' }).success).toBe(false)
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'gratuit', jours: 30 }).success).toBe(false)
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'premium', jours: 30 }).success).toBe(false)
  })

  it('should require the exact e-mail field for a deletion', () => {
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF, emailConfirmation: 'a@exemple.test' }).success).toBe(true)
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF }).success).toBe(false)
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF, emailConfirmation: 'a@exemple.test', force: true }).success).toBe(false)
  })

  it.each([['a'.repeat(7), false], ['a'.repeat(8), true], ['a'.repeat(128), true], ['a'.repeat(129), false], ['12345678 ', false], ['3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', true], ['clé-éèà-123', false]])(
    'should judge the idempotency key %j -> %s',
    (cle, valide) => {
      expect(schemaCleIdempotence.safeParse(cle).success).toBe(valide)
    },
  )

  it('should refuse a search of fewer than 3 characters and trim before counting (CA09)', () => {
    expect(schemaRechercheQuery.safeParse({ q: 'ab' }).success).toBe(false)
    expect(schemaRechercheQuery.safeParse({ q: '  ab  ' }).success).toBe(false)
    expect(schemaRechercheQuery.parse({ q: ' abc ' })).toEqual({ q: 'abc' })
    expect(schemaRechercheQuery.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
    expect(schemaRechercheQuery.safeParse({ q: 'abc', x: 1 }).success).toBe(false)
  })

  it('should default and bound the list query, converting query-string values', () => {
    expect(schemaListeUtilisateursQuery.parse({})).toMatchObject({ page: 1, limite: 25, tri: 'cree_le', ordre: 'desc' })
    expect(schemaListeUtilisateursQuery.parse({ page: '3', limite: '100', suspendu: 'true' })).toMatchObject({ page: 3, limite: 100, suspendu: true })
    for (const requete of [{ limite: '101' }, { limite: '0' }, { page: '0' }, { tri: 'password' }, { ordre: 'DROP' }, { plan: 'or' }, { inconnu: '1' }, { du: 'hier' }]) {
      expect(schemaListeUtilisateursQuery.safeParse(requete).success, JSON.stringify(requete)).toBe(false)
    }
  })
})

describe('sortie UtilisateurLigne (liste blanche)', () => {
  const ligne = {
    id: 'u1',
    nom: 'Professionnel de test',
    email: 'pro@exemple.test',
    username: 'pro-test',
    plan: 'gratuit',
    etat: 'gratuit',
    suspendu: false,
    inscritLe: INSTANT,
    derniereConnexion: null,
    vitrine: { publiee: true, bloquee: false },
  }

  it('should accept exactly the listed keys', () => {
    expect(schemaUtilisateurLigneDto.parse(ligne)).toEqual(ligne)
  })

  it.each([{ telephone: '+237600000000' }, { ipAddress: '203.0.113.7' }, { token: 'x' }, { role: 'superadmin' }])('should refuse the extra key %j', (extra) => {
    expect(schemaUtilisateurLigneDto.safeParse({ ...ligne, ...extra }).success).toBe(false)
  })

  it('should refuse an unknown state or plan', () => {
    expect(schemaUtilisateurLigneDto.safeParse({ ...ligne, etat: 'banni' }).success).toBe(false)
    expect(schemaUtilisateurLigneDto.safeParse({ ...ligne, plan: 'premium' }).success).toBe(false)
  })

  it('should keep the audit blacklist free of the new journal vocabulary', () => {
    for (const cle of ['suspendu', 'blocage_admin', 'expire_le', 'origine', 'plan', 'sessions', 'assistants', 'supprime', 'client_id_present', 'jours']) {
      expect(CLES_AUDIT_INTERDITES, cle).not.toContain(cle)
    }
  })
})
