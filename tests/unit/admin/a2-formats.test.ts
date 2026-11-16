import { describe, expect, it } from 'vitest'
import { ADMIN_FICHE_LIGNES_MAX, ABONNEMENT_ORIGINES } from '../../../shared/admin-a2'
import {
  schemaActionAdminReponse,
  schemaAssistantDto,
  schemaChangerPlan,
  schemaChangerPlanReponse,
  schemaCleIdempotence,
  schemaIdAdmin,
  schemaListeAssistantsQuery,
  schemaListeUtilisateursDto,
  schemaListeUtilisateursQuery,
  schemaListeVitrinesQuery,
  schemaOffrirJoursReponse,
  schemaPaginationAdmin,
  schemaRechercheQuery,
  schemaRevocationReponse,
  schemaSupprimerUtilisateur,
  schemaUtilisateurFicheDto,
  schemaVitrineLigneDto,
} from '../../../shared/schemas/admin-a2'

// A2 : formats et bornes des contrats (entrées ET sorties), en complément de schemas-a2.test.ts : limites exactes,
// requêtes de listes, sorties qui ne doivent jamais accepter une clé de plus. Aucune base, aucune horloge.

const MOTIF = 'Demande du titulaire'
const INSTANT = '2026-11-14T10:00:00.000Z'

describe('identifiant de cible et pagination', () => {
  it.each([['a', true], ['x'.repeat(64), true], ['x'.repeat(65), false], ['', false]])('should judge the id %j -> %s', (id, valide) => {
    expect(schemaIdAdmin.safeParse(id).success).toBe(valide)
  })

  it.each([
    [{ page: '1', limite: '1' }, true],
    [{ page: '10000', limite: '100' }, true],
    [{ page: '10001' }, false],
    [{ page: '0' }, false],
    [{ limite: '101' }, false],
    [{ limite: '0' }, false],
    [{ limite: '1e2' }, true],
    [{ limite: '' }, false],
    [{ limite: 'NaN' }, false],
    [{ page: '1.5' }, false],
    [{ page: '-1' }, false],
    [{ inconnu: '1' }, false],
  ])('should judge the pagination %j -> %s', (requete, valide) => {
    expect(schemaPaginationAdmin.safeParse(requete).success).toBe(valide)
  })

  it('should default to page 1 and 25 per page', () => {
    expect(schemaPaginationAdmin.parse({})).toEqual({ page: 1, limite: 25 })
  })
})

describe('clé d\'idempotence', () => {
  it.each(['abc12345', 'A.b_c:d-e12', '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', '01ARZ3NDEKTSV4RRFFQ69G5FAV'])('should accept %j', (cle) => {
    expect(schemaCleIdempotence.safeParse(cle).success).toBe(true)
  })

  it.each(['abc 12345', 'abc12345\n', 'abc/12345', 'abc;12345', 'clé12345', 'abc\u0000123', '<script>', '%00%00%00%00'])('should refuse %j', (cle) => {
    expect(schemaCleIdempotence.safeParse(cle).success).toBe(false)
  })
})

describe('recherche : normalisation et bornes (D-A2-11)', () => {
  it('should keep the wildcard characters as plain text (escaping is the service\'s job, never the schema\'s)', () => {
    expect(schemaRechercheQuery.parse({ q: '%_\\' })).toEqual({ q: '%_\\' })
  })

  it('should trim the ends, keep inner spaces, and count characters after trimming', () => {
    expect(schemaRechercheQuery.parse({ q: '  Jean  Paul ' })).toEqual({ q: 'Jean  Paul' })
    expect(schemaRechercheQuery.safeParse({ q: ' é ' }).success).toBe(false)
    expect(schemaRechercheQuery.safeParse({ q: 'été' }).success).toBe(true)
  })

  it.each([[2, false], [3, true], [100, true], [101, false]])('should judge a query of %i characters -> %s', (longueur, valide) => {
    expect(schemaRechercheQuery.safeParse({ q: 'a'.repeat(longueur) }).success).toBe(valide)
  })

  it('should refuse a repeated parameter (array) and a non-string', () => {
    expect(schemaRechercheQuery.safeParse({ q: ['abc', 'def'] }).success).toBe(false)
    expect(schemaRechercheQuery.safeParse({ q: 123 }).success).toBe(false)
  })
})

describe('listes : requêtes de la liste des utilisateurs et des vitrines', () => {
  it.each([
    [{ du: '2028-02-29' }, true],
    [{ du: '2027-02-29' }, false],
    [{ au: '2026-12-31' }, true],
    [{ au: '2026-12-31T00:00:00Z' }, false],
    [{ suspendu: 'false' }, true],
    [{ suspendu: 'oui' }, false],
    [{ suspendu: 'peut-etre' }, false],
    [{ vitrine: 'aucune' }, true],
    [{ vitrine: 'non_publiee' }, false],
    [{ etat: 'grace' }, true],
    [{ etat: 'termine' }, false],
    [{ tri: 'derniere_connexion', ordre: 'asc' }, true],
    [{ tri: 'username' }, false],
    [{ q: 'ab' }, false],
  ])('should judge the user list query %j -> %s', (requete, valide) => {
    expect(schemaListeUtilisateursQuery.safeParse(requete).success).toBe(valide)
  })

  it.each([
    [{ statut: 'publiee' }, true],
    [{ statut: 'bloquee' }, true],
    [{ statut: 'non_publiee' }, true],
    [{ statut: 'aucune' }, false],
    [{ tri: 'username' }, true],
    [{ tri: 'nom' }, true],
    [{ tri: 'email' }, false],
    [{ tri: 'cree_le; DROP TABLE vitrines' }, false],
    [{ suspendu: 'true' }, false],
  ])('should judge the vitrine list query %j -> %s', (requete, valide) => {
    expect(schemaListeVitrinesQuery.safeParse(requete).success).toBe(valide)
  })

  it('should default the vitrine list to creation date, newest first', () => {
    expect(schemaListeVitrinesQuery.parse({})).toMatchObject({ tri: 'cree_le', ordre: 'desc', page: 1, limite: 25 })
  })

  it('should demand utilisateurId, bounded, for the assistants list', () => {
    expect(schemaListeAssistantsQuery.safeParse({}).success).toBe(false)
    expect(schemaListeAssistantsQuery.safeParse({ utilisateurId: 'x'.repeat(65) }).success).toBe(false)
    expect(schemaListeAssistantsQuery.safeParse({ utilisateurId: 'u1', page: '1' }).success).toBe(false)
    expect(schemaListeAssistantsQuery.safeParse({ utilisateurId: 'u1' }).success).toBe(true)
  })
})

describe('entrées d\'écriture : bornes exactes', () => {
  it.each([[1, true], [365, true], [366, false], [0, false], [Number.MAX_SAFE_INTEGER, false], [Number.NaN, false], [Number.POSITIVE_INFINITY, false]])('should judge payant for %s day(s) -> %s', (jours, valide) => {
    expect(schemaChangerPlan.safeParse({ motif: MOTIF, plan: 'payant', jours }).success).toBe(valide)
  })

  it('should trim and bound the e-mail typed for a deletion (3 to 254 characters)', () => {
    expect(schemaSupprimerUtilisateur.parse({ motif: MOTIF, emailConfirmation: '  a@b.cm  ' }).emailConfirmation).toBe('a@b.cm')
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF, emailConfirmation: 'ab' }).success).toBe(false)
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF, emailConfirmation: `${'a'.repeat(250)}@b.cm` }).success).toBe(false)
    expect(schemaSupprimerUtilisateur.safeParse({ motif: MOTIF, emailConfirmation: `${'a'.repeat(248)}@b.cm` }).success).toBe(true)
  })

  it.each([['5 characters', 'abcde', true], ['4 characters', 'abcd', false], ['500 characters', 'x'.repeat(500), true], ['501 characters', 'x'.repeat(501), false], ['padded 4+spaces', '  abcd  ', false]])('should judge a motif of %s -> %s', (_nom, motif, valide) => {
    expect(schemaSupprimerUtilisateur.safeParse({ motif, emailConfirmation: 'a@b.cm' }).success).toBe(valide)
  })
})

describe('sorties : liste blanche stricte', () => {
  const vitrine = { id: 'v1', utilisateurId: 'u1', username: 'dr-test', nom: 'Test', metier: null, plan: 'gratuit', publiee: true, bloquee: false, blocageMotif: null, proprietaireSuspendu: false, creeLe: INSTANT }

  it('should accept the vitrine line as specified and refuse any extra key, in particular visitor content', () => {
    expect(schemaVitrineLigneDto.safeParse(vitrine).success).toBe(true)
    for (const extra of [{ reservations: [] }, { messages: 1 }, { temoignages: [] }, { email: 'x@y.z' }, { telephone: '+237600' }]) {
      expect(schemaVitrineLigneDto.safeParse({ ...vitrine, ...extra }).success, JSON.stringify(extra)).toBe(false)
    }
  })

  it('should refuse a non-ISO instant and a non-boolean flag in a response', () => {
    expect(schemaVitrineLigneDto.safeParse({ ...vitrine, creeLe: '14/11/2026' }).success).toBe(false)
    expect(schemaVitrineLigneDto.safeParse({ ...vitrine, bloquee: 'non' }).success).toBe(false)
  })

  it('should refuse a session or an assistant carrying a token, an IP or a client identifier', () => {
    const fiche = {
      id: 'u1', nom: 'N', email: 'e@x.y', username: null, plan: 'gratuit', etat: 'gratuit', suspendu: false, inscritLe: INSTANT, derniereConnexion: null, vitrine: null,
      telephone: null, pays: null, devise: 'XAF', fuseau: 'Africa/Douala', motifSuspension: null, abonnement: null,
      compteurs: { services: 0, realisations: 0, temoignages: 0, liens: 0 }, activite30j: { vues: 0, reservations: 0, demandes: 0, messages: 0 }, iaMois: 0,
      sessionsActives: [{ id: 's', creeLe: INSTANT, expireLe: INSTANT }], assistants: [{ id: 'c', client: 'Claude', portees: ['vitrine:lecture'], dernierUsage: null }],
    }
    expect(schemaUtilisateurFicheDto.safeParse(fiche).success).toBe(true)
    expect(schemaUtilisateurFicheDto.safeParse({ ...fiche, sessionsActives: [{ id: 's', creeLe: INSTANT, expireLe: INSTANT, token: 'x' }] }).success).toBe(false)
    expect(schemaUtilisateurFicheDto.safeParse({ ...fiche, sessionsActives: [{ id: 's', creeLe: INSTANT, expireLe: INSTANT, ipAddress: '1.2.3.4' }] }).success).toBe(false)
    expect(schemaAssistantDto.safeParse({ id: 'c', client: 'Claude', portees: [], dernierUsage: null, clientId: 'abc' }).success).toBe(false)
    expect(schemaUtilisateurFicheDto.safeParse({ ...fiche, activite30j: { vues: 0, reservations: 0, demandes: 0, messages: 0, contenu: 'x' } }).success).toBe(false)
    expect(schemaUtilisateurFicheDto.safeParse({ ...fiche, activite30j: { vues: -1, reservations: 0, demandes: 0, messages: 0 } }).success).toBe(false)
    expect(schemaUtilisateurFicheDto.safeParse({ ...fiche, sessionsActives: Array.from({ length: ADMIN_FICHE_LIGNES_MAX + 1 }, () => ({ id: 's', creeLe: INSTANT, expireLe: INSTANT })) }).success).toBe(false)
  })

  it('should cap a list at 100 elements and require a positive page', () => {
    expect(schemaListeUtilisateursDto.safeParse({ elements: [], total: 0, page: 0, limite: 25 }).success).toBe(false)
    expect(schemaListeUtilisateursDto.safeParse({ elements: [], total: 0, page: 1, limite: 101 }).success).toBe(false)
    expect(schemaListeUtilisateursDto.safeParse({ elements: [], total: -1, page: 1, limite: 25 }).success).toBe(false)
  })

  it('should keep the action answers exact', () => {
    expect(schemaActionAdminReponse.safeParse({ effectue: true, rejoue: false }).success).toBe(true)
    expect(schemaActionAdminReponse.safeParse({ effectue: false, rejoue: false }).success).toBe(false)
    expect(schemaActionAdminReponse.safeParse({ effectue: true }).success).toBe(false)
    expect(schemaOffrirJoursReponse.safeParse({ expireLe: '2026-12-01', rejoue: false }).success).toBe(false)
    expect(schemaOffrirJoursReponse.safeParse({ expireLe: INSTANT, rejoue: true }).success).toBe(true)
    expect(schemaChangerPlanReponse.safeParse({ plan: 'gratuit', expireLe: null, rejoue: false }).success).toBe(true)
    expect(schemaChangerPlanReponse.safeParse({ plan: 'intermediaire', expireLe: null, rejoue: false }).success).toBe(false)
    expect(schemaRevocationReponse.safeParse({ revoques: 0 }).success).toBe(true)
    expect(schemaRevocationReponse.safeParse({ revoques: 1.5 }).success).toBe(false)
  })

  it('should list exactly the three subscription origins', () => {
    expect([...ABONNEMENT_ORIGINES]).toEqual(['paiement', 'offert', 'admin'])
  })
})
