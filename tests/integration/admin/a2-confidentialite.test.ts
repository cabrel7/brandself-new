import { beforeEach, describe, expect, it } from 'vitest'
import {
  schemaActionAdminReponse,
  schemaChangerPlanReponse,
  schemaListeAssistantsDto,
  schemaListeUtilisateursDto,
  schemaListeVitrinesDto,
  schemaOffrirJoursReponse,
  schemaRechercheDto,
  schemaRevocationReponse,
  schemaUtilisateurFicheDto,
  schemaVitrineFicheDto,
} from '../../../shared/schemas/admin-a2'
import { ouvrirAdmin, ouvrirSession, preparerSuiteAdmin } from '../support/admin'
import {
  CANARIS_VISITEUR,
  CLE_A,
  CLE_B,
  MOTIF_A2,
  MOTIF_DEPUBLICATION,
  MOTIF_SUSPENSION,
  appelerA2,
  codeReauthPour,
  creerMondeA2,
  poserAssistant,
  viderClientsOauth,
} from '../support/admin-a2'
import type { MondeA2 } from '../support/admin-a2'
import { createSession } from '../support/fabriques'

// A2 CA11 : AUCUNE réponse de `/api/admin/**` ne contient une clé hors liste blanche ni une donnée de visiteur. Test
// d'énumération EXÉCUTÉ : un monde rempli de données de visiteurs « canaris » (réservation, demande, message), de
// sessions, d'IP et de jetons ; chaque route est appelée, chaque réponse relue par son schéma STRICT, puis cherchée
// pour toute chaîne interdite. Les erreurs sont examinées de la même façon.

const suite = preparerSuiteAdmin()
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string
let m: MondeA2

const INTERDITS_FIXES = [
  ...Object.values(CANARIS_VISITEUR).filter((v) => v !== 'autre'),
  'jeton-secret',
  '203.0.113.7',
  'Mozilla/5.0',
  'refresh-',
  'acces-',
  'client_secret',
  'code_empreinte',
  'password',
]

beforeEach(async () => {
  await viderClientsOauth()
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
  m = await creerMondeA2({ payantJours: 30 })
  const { createMessage } = await import('../../../server/services/messages')
  const { createDemande } = await import('../../../server/services/demandes')
  await createMessage(m.vitrine.username, { nom: CANARIS_VISITEUR.nom, email: CANARIS_VISITEUR.email, telephone: CANARIS_VISITEUR.telephone, sujet: 'autre', message: CANARIS_VISITEUR.message })
  await createDemande(m.vitrine.username, { serviceSlug: m.serviceDevis.slug, nom: CANARIS_VISITEUR.nom, email: CANARIS_VISITEUR.email, telephone: CANARIS_VISITEUR.telephone, message: CANARIS_VISITEUR.message })
  await createSession(m.user.id)
  await ouvrirSession(suite.auth(), m.user.email, 'public')
  await poserAssistant(m.user.id)
})

function sansFuite(nom: string, valeur: unknown): void {
  const brut = JSON.stringify(valeur)
  for (const interdit of [...INTERDITS_FIXES, m.confirmationToken]) expect(brut, `${nom} contient « ${interdit} »`).not.toContain(interdit)
}

describe('lectures : schémas stricts et aucune donnée de visiteur (CA11)', () => {
  it('should answer every read route with its strict schema and no forbidden string', async () => {
    const lectures = [
      ['recherche (nom du professionnel)', schemaRechercheDto, await appelerA2('recherche', { cookie, query: { q: m.user.name } })],
      ['recherche (e-mail)', schemaRechercheDto, await appelerA2('recherche', { cookie, query: { q: m.user.email } })],
      ['liste des utilisateurs', schemaListeUtilisateursDto, await appelerA2('utilisateursListe', { cookie })],
      ['fiche utilisateur', schemaUtilisateurFicheDto, await appelerA2('utilisateurFiche', { cookie, id: m.user.id })],
      ['liste des vitrines', schemaListeVitrinesDto, await appelerA2('vitrinesListe', { cookie })],
      ['fiche vitrine', schemaVitrineFicheDto, await appelerA2('vitrineFiche', { cookie, id: m.vitrine.id })],
      ['liste des assistants', schemaListeAssistantsDto, await appelerA2('assistantsListe', { cookie, query: { utilisateurId: m.user.id } })],
    ] as const

    for (const [nom, schema, reponse] of lectures) {
      expect(reponse.status, nom).toBe(200)
      expect(schema.safeParse(reponse.corps).success, `${nom} : schéma strict`).toBe(true)
      sansFuite(nom, reponse.corps)
    }
  })

  it('should not put the visitor\'s data into the lists even when the professional\'s own name looks like it', async () => {
    const reponse = await appelerA2('recherche', { cookie, query: { q: 'Canari' } })

    expect(reponse.corps).toEqual({ utilisateurs: [], vitrines: [] })
  })
})

describe('écritures : schémas stricts et aucune donnée de visiteur (CA11)', () => {
  it('should answer every write route with its strict schema and no forbidden string', async () => {
    const autre = await creerMondeA2()
    const reponses = [
      ['offrir des jours', schemaOffrirJoursReponse, await appelerA2('offrirJours', { cookie, id: m.user.id, cleIdempotence: CLE_A, corps: { motif: MOTIF_A2, jours: 5 } })],
      ['changer le plan', schemaChangerPlanReponse, await appelerA2('changerPlan', { cookie, id: autre.user.id, cleIdempotence: CLE_B, reauth: await codeReauthPour(admin.id, 'changerPlan', autre.user.id), corps: { motif: MOTIF_A2, plan: 'payant', jours: 5 } })],
      ['retirer les assistants', schemaRevocationReponse, await appelerA2('retirerAssistants', { cookie, id: m.user.id, corps: { motif: MOTIF_A2 } })],
      ['révoquer les sessions', schemaRevocationReponse, await appelerA2('revoquerSessions', { cookie, id: m.user.id, corps: { motif: MOTIF_A2 } })],
      ['dépublier', schemaActionAdminReponse, await appelerA2('depublier', { cookie, id: m.vitrine.id, reauth: await codeReauthPour(admin.id, 'depublier', m.vitrine.id), corps: { motif: MOTIF_DEPUBLICATION } })],
      ['republier', schemaActionAdminReponse, await appelerA2('republier', { cookie, id: m.vitrine.id, corps: { motif: MOTIF_A2 } })],
      ['suspendre', schemaActionAdminReponse, await appelerA2('suspendre', { cookie, id: m.user.id, reauth: await codeReauthPour(admin.id, 'suspendre', m.user.id), corps: { motif: MOTIF_SUSPENSION } })],
      ['réactiver', schemaActionAdminReponse, await appelerA2('reactiver', { cookie, id: m.user.id, corps: { motif: MOTIF_A2 } })],
      ['supprimer', schemaActionAdminReponse, await appelerA2('supprimer', { cookie, id: m.user.id, reauth: await codeReauthPour(admin.id, 'supprimer', m.user.id), corps: { motif: MOTIF_A2, emailConfirmation: m.user.email } })],
    ] as const

    for (const [nom, schema, reponse] of reponses) {
      expect(reponse.status, `${nom} : ${JSON.stringify(reponse)}`).toBe(200)
      expect(schema.safeParse(reponse.corps).success, `${nom} : schéma strict`).toBe(true)
      sansFuite(nom, reponse.corps)
    }
  })

  it('should not echo the motif, the e-mail typed for a deletion or the reauthentication code back in a response', async () => {
    const code = await codeReauthPour(admin.id, 'supprimer', m.user.id)

    const refusee = await appelerA2('supprimer', { cookie, id: m.user.id, reauth: code, corps: { motif: 'Un motif secret à ne pas renvoyer', emailConfirmation: 'saisi-par-erreur@exemple.test' } })
    const brut = JSON.stringify(refusee)

    expect(refusee.status).toBe(422)
    for (const secret of ['Un motif secret', 'saisi-par-erreur@exemple.test', code]) expect(brut).not.toContain(secret)
  })
})

describe('erreurs : ni donnée de visiteur, ni détail interne (CA11)', () => {
  it.each([
    ['fiche inconnue', () => appelerA2('utilisateurFiche', { cookie, id: '00000000-0000-4000-8000-000000000000' })],
    ['fiche vitrine inconnue', () => appelerA2('vitrineFiche', { cookie, id: '00000000-0000-4000-8000-000000000000' })],
    ['recherche invalide', () => appelerA2('recherche', { cookie, query: { q: 'a' } })],
    ['liste invalide', () => appelerA2('utilisateursListe', { cookie, query: { tri: 'password' } })],
    ['motif invalide', () => appelerA2('reactiver', { cookie, id: m.user.id, corps: { motif: 'x' } })],
    ['réauthentification absente', () => appelerA2('suspendre', { cookie, id: m.user.id, corps: { motif: MOTIF_SUSPENSION } })],
    ['identifiant piégé', () => appelerA2('utilisateurFiche', { cookie, id: '\' UNION SELECT email FROM users --' })],
  ])('should keep the error of « %s » free of forbidden strings, stack traces and SQL', async (_nom, appel) => {
    const reponse = await appel()

    expect(reponse.status).toBeGreaterThanOrEqual(400)
    expect(reponse.status).toBeLessThan(500)
    sansFuite('erreur', reponse)
    expect(JSON.stringify(reponse)).not.toMatch(/\bat \S+\.(ts|js):\d+|select |insert into|syntax error|pg_catalog|node_modules/i)
  })
})
