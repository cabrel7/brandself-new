import { beforeEach, describe, expect, it } from 'vitest'
import { schemaListeAssistantsDto } from '../../../shared/schemas/admin-a2'
import { compterJournal, journalDe, lireSessions, ouvrirAdmin, ouvrirSession, preparerSuiteAdmin } from '../support/admin'
import {
  MOTIF_A2,
  appelerA2,
  compterEmailsOutbox,
  creerCompteSimple,
  etatOauth,
  journalAssistantPourTest,
  lireUtilisateur,
  poserAssistant,
  viderClientsOauth,
} from '../support/admin-a2'
import { createSession } from '../support/fabriques'

// A2 D-A2-15 (assistants) et D-A2-07 (révoquer les sessions) : retirer un assistant, retirer tous les assistants d'un
// compte, révoquer les sessions. Motif seul, sans réauthentification. Base réelle ; le consentement est une ligne
// `oauth_consents` posée directement, ses jetons aussi.

const suite = preparerSuiteAdmin()
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  await viderClientsOauth()
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

const retirer = (consentementId: string, corps: unknown = { motif: MOTIF_A2 }) => appelerA2('assistantRetirer', { id: consentementId, cookie, corps })

describe('liste des assistants d\'un compte', () => {
  it('should list the consents of the account only (identifier, client name, scopes, last use), never a token', async () => {
    const { user } = await creerCompteSimple()
    const autre = await creerCompteSimple()
    const a = await poserAssistant(user.id, { nom: 'Assistant A', scopes: ['vitrine:lecture'] })
    await poserAssistant(autre.user.id, { nom: 'Assistant B' })
    await journalAssistantPourTest(user.id, a.clientId)

    const reponse = await appelerA2('assistantsListe', { cookie, query: { utilisateurId: user.id } })

    expect(reponse.status).toBe(200)
    const dto = schemaListeAssistantsDto.parse(reponse.corps)
    expect(dto.elements).toHaveLength(1)
    expect(dto.elements[0]).toMatchObject({ id: a.consentementId, client: 'Assistant A', portees: ['vitrine:lecture'] })
    expect(dto.elements[0]?.dernierUsage).not.toBeNull()
    const brut = JSON.stringify(reponse.corps)
    for (const secret of ['refresh-', 'acces-', 'client_secret']) expect(brut).not.toContain(secret)
    expect(brut).not.toContain(a.clientId)
  })

  it('should answer 422 without utilisateurId and for an unknown parameter, and an empty list or a 404 for an unknown account', async () => {
    expect((await appelerA2('assistantsListe', { cookie })).status).toBe(422)
    expect((await appelerA2('assistantsListe', { cookie, query: { utilisateurId: 'x', page: '1' } })).status).toBe(422)
    const inconnu = await appelerA2('assistantsListe', { cookie, query: { utilisateurId: 'inconnu-0001' } })
    // La spec ne tranche pas : liste vide (200) ou 404 UTILISATEUR_INTROUVABLE sont acceptables, jamais une erreur serveur.
    if (inconnu.status === 200) expect(inconnu.corps).toEqual({ elements: [] })
    else expect(inconnu).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
  })
})

describe('retirer un assistant (D-A2-15)', () => {
  it('should delete the consent and the tokens of THIS client for THIS account, and nothing else', async () => {
    const { user } = await creerCompteSimple()
    const autreCompte = await creerCompteSimple()
    const cible = await poserAssistant(user.id, { nom: 'Cible' })
    const memeCompteAutreClient = await poserAssistant(user.id, { nom: 'Autre client' })
    const memeClientAutreCompte = await poserAssistant(autreCompte.user.id, { clientId: cible.clientId, clientExistant: true })
    expect(memeClientAutreCompte.clientId).toBe(cible.clientId)

    const reponse = await retirer(cible.consentementId)

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    expect(await etatOauth(user.id)).toEqual({ consentements: 1, jetonsAcces: 1, jetonsRenouvellement: 1 })
    expect(await etatOauth(autreCompte.user.id)).toEqual({ consentements: 1, jetonsAcces: 1, jetonsRenouvellement: 1 })
    const reste = schemaListeAssistantsDto.parse((await appelerA2('assistantsListe', { cookie, query: { utilisateurId: user.id } })).corps)
    expect(reste.elements.map((e) => e.id)).toEqual([memeCompteAutreClient.consentementId])
  })

  it('should journal one line on the assistant target without any client identifier, token or personal data', async () => {
    const { user } = await creerCompteSimple()
    const a = await poserAssistant(user.id)

    await retirer(a.consentementId)

    const [ligne] = await journalDe('assistant.retirer')
    expect(ligne).toMatchObject({ admin_id: admin.id, cible_type: 'assistant', cible_id: a.consentementId, motif: MOTIF_A2, apres: { client_id_present: true } })
    const brut = JSON.stringify([ligne?.avant, ligne?.apres])
    expect(brut).not.toContain(a.clientId)
    expect(brut).not.toContain(user.email)
  })

  it('should need no reauthentication, but a valid motif (422), and answer 404 for an unknown consent', async () => {
    const { user } = await creerCompteSimple()
    const a = await poserAssistant(user.id)

    expect((await retirer(a.consentementId, { motif: 'non' })).status).toBe(422)
    expect((await retirer(a.consentementId, { motif: MOTIF_A2, extra: 1 })).status).toBe(422)
    expect((await retirer('00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await etatOauth(user.id)).consentements).toBe(1)
    expect(await compterJournal()).toBe(0)
  })

  it('should answer 404 the second time (already removed) rather than a server error', async () => {
    const { user } = await creerCompteSimple()
    const a = await poserAssistant(user.id)
    await retirer(a.consentementId)

    const encore = await retirer(a.consentementId)

    expect(encore.status).toBe(404)
    expect(await journalDe('assistant.retirer')).toHaveLength(1)
  })
})

describe('retirer tous les assistants d\'un compte', () => {
  it('should delete every consent and token of the account, answer the count and journal {assistants: n}', async () => {
    const { user } = await creerCompteSimple()
    const autre = await creerCompteSimple()
    await poserAssistant(user.id)
    await poserAssistant(user.id)
    await poserAssistant(autre.user.id)

    const reponse = await appelerA2('retirerAssistants', { id: user.id, cookie, corps: { motif: MOTIF_A2 } })

    expect(reponse).toMatchObject({ status: 200, corps: { revoques: 2 } })
    expect(await etatOauth(user.id)).toEqual({ consentements: 0, jetonsAcces: 0, jetonsRenouvellement: 0 })
    expect((await etatOauth(autre.user.id)).consentements).toBe(1)
    const [ligne] = await journalDe('utilisateur.retirer_assistants')
    expect(ligne).toMatchObject({ cible_type: 'utilisateur', cible_id: user.id, apres: { assistants: 2 } })
  })

  it('should answer 200 { revoques: 0 } for an account without assistant, 404 for an unknown account, and 422 for a short motif', async () => {
    const { user } = await creerCompteSimple()

    expect(await appelerA2('retirerAssistants', { id: user.id, cookie, corps: { motif: MOTIF_A2 } })).toMatchObject({ status: 200, corps: { revoques: 0 } })
    expect((await appelerA2('retirerAssistants', { id: '00000000-0000-4000-8000-000000000000', cookie, corps: { motif: MOTIF_A2 } })).status).toBe(404)
    expect((await appelerA2('retirerAssistants', { id: user.id, cookie, corps: { motif: 'x' } })).status).toBe(422)
  })
})

describe('révoquer les sessions d\'un compte (D-A2-07)', () => {
  it('should delete every session of the account only, answer the count, journal {sessions: n}, and neither suspend the account nor touch its assistants', async () => {
    const { user } = await creerCompteSimple()
    const autre = await creerCompteSimple()
    await createSession(user.id)
    await createSession(user.id)
    await createSession(autre.user.id)
    await poserAssistant(user.id)
    const sessionsAdmin = (await lireSessions(admin.id)).length

    const reponse = await appelerA2('revoquerSessions', { id: user.id, cookie, corps: { motif: MOTIF_A2 } })

    expect(reponse).toMatchObject({ status: 200, corps: { revoques: 2 } })
    expect(await lireSessions(user.id)).toEqual([])
    expect(await lireSessions(autre.user.id)).toHaveLength(1)
    expect((await lireSessions(admin.id)).length).toBe(sessionsAdmin)
    expect((await lireUtilisateur(user.id))?.banned).toBe(false)
    expect((await etatOauth(user.id)).consentements).toBe(1)
    const [ligne] = await journalDe('utilisateur.revoquer_sessions')
    expect(ligne).toMatchObject({ cible_type: 'utilisateur', cible_id: user.id, apres: { sessions: 2 } })
    expect(await compterEmailsOutbox()).toBe(0)
  })

  it('should make the next request of a revoked session unknown to Better Auth, so the owner signs in again', async () => {
    const { user } = await creerCompteSimple()
    const { cookie: cookiePro } = await ouvrirSession(suite.auth(), user.email, 'public')
    const { appelerAuth } = await import('../support/admin')
    expect((await appelerAuth(suite.auth(), { hote: 'public', chemin: '/api/auth/get-session', cookie: cookiePro })).corps).toMatchObject({ user: { id: user.id } })

    await appelerA2('revoquerSessions', { id: user.id, cookie, corps: { motif: MOTIF_A2 } })

    expect((await appelerAuth(suite.auth(), { hote: 'public', chemin: '/api/auth/get-session', cookie: cookiePro })).corps).toBeNull()
  })

  it('should answer 404 for an unknown account and 422 for an invalid motif, and write nothing', async () => {
    const { user } = await creerCompteSimple()
    await createSession(user.id)

    expect((await appelerA2('revoquerSessions', { id: '00000000-0000-4000-8000-000000000000', cookie, corps: { motif: MOTIF_A2 } })).status).toBe(404)
    expect((await appelerA2('revoquerSessions', { id: user.id, cookie, corps: {} })).status).toBe(422)
    expect(await lireSessions(user.id)).toHaveLength(1)
    expect(await compterJournal()).toBe(0)
  })
})
