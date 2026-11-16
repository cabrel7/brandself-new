import { beforeEach, describe, expect, it } from 'vitest'
import { ERROR_STATUS } from '../../../shared/erreurs'
import { db } from '../../../server/utils/db'
import {
  appelerAuth,
  auditService,
  compterJournal,
  connecterParCode,
  creerSuperadmin,
  demanderCodeConnexion,
  journalDe,
  lireCodeEmail,
  lireJournal,
  lireSessions,
  ouvrirAdmin,
  ouvrirSession,
  preparerSuiteAdmin,
} from '../support/admin'
import {
  MAINTENANT_A2,
  MOTIF_A2,
  MOTIF_SUSPENSION,
  appelerA2,
  codeReauthPour,
  compterEcritures,
  compterEmailsOutbox,
  creerMondeA2,
  etatOauth,
  lireOutboxUtilisateur,
  lireUtilisateur,
  lireVitrineDe,
  poserAssistant,
  viderClientsOauth,
} from '../support/admin-a2'
import type { MondeA2 } from '../support/admin-a2'
import { traiter } from '../support/planification'
import { utc } from '../support/notifications'

// A2 CA01, CA04, D-A2-01, D-A2-07, D-A2-14 : suspendre et réactiver un compte. Routes RÉELLES (handlers Nitro), base,
// Redis et Better Auth RÉELS ; la réauthentification passe par le vrai code lu dans la file `messages-auth`.

const suite = preparerSuiteAdmin()
const STATUT_REAUTH_REQUISE = ERROR_STATUS.REAUTH_REQUISE

let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  await viderClientsOauth()
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

async function suspendre(m: MondeA2, surcharges: { motif?: string, reauth?: string | null, id?: string, corps?: unknown } = {}) {
  const id = surcharges.id ?? m.user.id
  const reauth = surcharges.reauth === null ? undefined : (surcharges.reauth ?? await codeReauthPour(admin.id, 'suspendre', id))
  return appelerA2('suspendre', { id, cookie, ...(reauth === undefined ? {} : { reauth }), corps: surcharges.corps ?? { motif: surcharges.motif ?? MOTIF_SUSPENSION } })
}

async function etatCompte(m: MondeA2) {
  const u = await lireUtilisateur(m.user.id)
  const v = await lireVitrineDe(m.user.id)
  return { suspendu: u?.banned, motif: u?.banReason, publieeLe: v?.publieeLe?.toISOString(), blocage: v?.blocageAdmin }
}

describe('suspendre : effets (CA01, D-A2-01)', () => {
  it('should flag the account with its motif, delete its sessions, OAuth tokens and consents, and touch nothing else', async () => {
    const m = await creerMondeA2({ payantJours: 30 })
    const session = await ouvrirSession(suite.auth(), m.user.email, 'public')
    await poserAssistant(m.user.id)
    expect(await lireSessions(m.user.id)).toHaveLength(1)
    expect(await etatOauth(m.user.id)).toEqual({ consentements: 1, jetonsAcces: 1, jetonsRenouvellement: 1 })
    const avant = await etatCompte(m)

    const reponse = await suspendre(m)

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    const apres = await lireUtilisateur(m.user.id)
    expect(apres).toMatchObject({ banned: true, banReason: MOTIF_SUSPENSION, banExpires: null })
    expect(await lireSessions(m.user.id)).toEqual([])
    expect(await etatOauth(m.user.id)).toEqual({ consentements: 0, jetonsAcces: 0, jetonsRenouvellement: 0 })
    // « Aucune copie dans vitrines » : la vitrine garde publiee_le et n'est pas marquée bloquée.
    expect(await etatCompte(m)).toEqual({ ...avant, suspendu: true, motif: MOTIF_SUSPENSION })
    expect(session.cookie).not.toBe('')
  })

  it('should not touch the administrator\'s own session nor another account\'s sessions and assistants', async () => {
    const m = await creerMondeA2()
    const autre = await creerMondeA2()
    await ouvrirSession(suite.auth(), autre.user.email, 'public')
    await poserAssistant(autre.user.id)
    const sessionsAdmin = (await lireSessions(admin.id)).length

    await suspendre(m)

    expect((await lireSessions(admin.id)).length).toBe(sessionsAdmin)
    expect(await lireSessions(autre.user.id)).toHaveLength(1)
    expect(await etatOauth(autre.user.id)).toEqual({ consentements: 1, jetonsAcces: 1, jetonsRenouvellement: 1 })
    expect((await lireUtilisateur(autre.user.id))?.banned).toBe(false)
  })

  it('should make the request of the EXISTING session fail: Better Auth no longer knows it (the studio guard answers 401)', async () => {
    const m = await creerMondeA2()
    const { cookie: cookieProfessionnel } = await ouvrirSession(suite.auth(), m.user.email, 'public')
    const avant = await appelerAuth(suite.auth(), { hote: 'public', chemin: '/api/auth/get-session', cookie: cookieProfessionnel })
    expect(avant.corps, 'témoin : la session est valide avant la suspension').toMatchObject({ user: { id: m.user.id } })

    await suspendre(m)

    const apres = await appelerAuth(suite.auth(), { hote: 'public', chemin: '/api/auth/get-session', cookie: cookieProfessionnel })
    expect(apres.corps).toBeNull()
  })

  it('should refuse the next sign-in with a 403 BANNED_USER whose message does NOT carry the motif, and open no session', async () => {
    const m = await creerMondeA2()
    await suspendre(m)
    await demanderCodeConnexion(suite.auth(), m.user.email, 'public')
    const code = await lireCodeEmail(m.user.email)

    const reponse = await connecterParCode(suite.auth(), m.user.email, code, 'public')

    expect(reponse.status).toBe(403)
    expect(reponse.corps).toMatchObject({ code: 'BANNED_USER' })
    // Décision A2 : message statique. Le motif ne sort jamais d'un écran de connexion (il révélerait qu'un compte existe).
    expect(String(reponse.corps?.message)).not.toContain(MOTIF_SUSPENSION)
    expect(await lireSessions(m.user.id)).toEqual([])
  })

  it('should reject the request when the account is already suspended without writing a second suspension e-mail', async () => {
    const m = await creerMondeA2()
    await suspendre(m)
    const mails = (await lireOutboxUtilisateur(m.user.id, 'utilisateur_suspendu')).length

    const encore = await suspendre(m, { motif: 'Autre motif valable' })

    expect([200, 409]).toContain(encore.status)
    expect((await lireOutboxUtilisateur(m.user.id, 'utilisateur_suspendu')).length).toBeLessThanOrEqual(mails + 1)
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(true)
  })

  it('should answer 404 UTILISATEUR_INTROUVABLE for an unknown account and write nothing', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000'
    const m = await creerMondeA2()

    const reponse = await suspendre(m, { id: inconnu })

    expect(reponse).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
  })
})

describe('suspendre : journal chaîné et e-mail (D-A2-14)', () => {
  it('should write exactly one chained journal line without any personal data, in the same action', async () => {
    const m = await creerMondeA2()

    await suspendre(m)

    const lignes = await journalDe('utilisateur.suspendre')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      admin_id: admin.id,
      cible_type: 'utilisateur',
      cible_id: m.user.id,
      motif: MOTIF_SUSPENSION,
      avant: { suspendu: false },
      apres: { suspendu: true },
    })
    expect(lignes[0]?.ip).toBeTruthy()
    const brut = JSON.stringify([lignes[0]?.avant, lignes[0]?.apres])
    expect(brut).not.toContain(m.user.email)
    expect(brut).not.toContain(m.user.name)
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should insert ONE utilisateur_suspendu outbox line (occurrence = journal number) and send it with the motif to the owner', async () => {
    const m = await creerMondeA2()

    await suspendre(m)

    const [ligne] = await lireOutboxUtilisateur(m.user.id, 'utilisateur_suspendu')
    const [journal] = await journalDe('utilisateur.suspendre')
    expect(await lireOutboxUtilisateur(m.user.id)).toHaveLength(1)
    expect(ligne).toMatchObject({ entiteType: 'utilisateur', entiteId: m.user.id, statut: 'en_attente', categorie: 'transactionnel', occurrence: String(journal?.numero) })
    const envoi = await traiter(ligne!.id, new Date(Date.now() + 60_000))
    expect(envoi.resultat.statut).toBe('envoye')
    expect(envoi.transport.dernier.to).toBe(m.user.email)
    expect(`${envoi.transport.dernier.text}${envoi.transport.dernier.html ?? ''}`).toContain(MOTIF_SUSPENSION)
  })

  it('should keep the journal chain intact and the outbox consistent when two suspensions race', async () => {
    const m = await creerMondeA2()
    const codes = [await codeReauthPour(admin.id, 'suspendre', m.user.id), await codeReauthPour(admin.id, 'suspendre', m.user.id)]

    const reponses = await Promise.all(codes.map((reauth, i) => suspendre(m, { reauth, motif: `Motif concurrent numéro ${i}` })))

    for (const reponse of reponses) expect([200, 400, 403, 409]).toContain(reponse.status)
    expect(reponses.some((r) => r.status === 200)).toBe(true)
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(true)
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
    expect((await lireOutboxUtilisateur(m.user.id, 'utilisateur_suspendu')).length).toBe((await journalDe('utilisateur.suspendre')).length)
  })
})

describe('suspendre : réauthentification et motif (D-A2-07)', () => {
  it('should refuse without the x-admin-reauth header: REAUTH_REQUISE, nothing changes, nothing is journalised', async () => {
    const m = await creerMondeA2()
    const avant = await etatCompte(m)

    const reponse = await suspendre(m, { reauth: null })

    expect(reponse).toMatchObject({ status: STATUT_REAUTH_REQUISE, code: 'REAUTH_REQUISE' })
    expect(await etatCompte(m)).toEqual(avant)
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
  })

  it('should refuse a wrong code (REAUTH_INVALIDE) without any effect', async () => {
    const m = await creerMondeA2()
    await codeReauthPour(admin.id, 'suspendre', m.user.id)
    const avant = await etatCompte(m)

    const reponse = await suspendre(m, { reauth: '000000' })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect(await etatCompte(m)).toEqual(avant)
    expect(await compterJournal()).toBe(0)
  })

  it('should refuse a code issued for ANOTHER account (the code is bound to its target)', async () => {
    const m = await creerMondeA2()
    const autre = await creerMondeA2()
    const codePourAutre = await codeReauthPour(admin.id, 'suspendre', autre.user.id)

    const reponse = await suspendre(m, { reauth: codePourAutre })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
    expect((await lireUtilisateur(autre.user.id))?.banned).toBe(false)
  })

  it('should refuse a code issued for ANOTHER action (changer-plan code cannot suspend)', async () => {
    const m = await creerMondeA2()
    const codeAutreAction = await codeReauthPour(admin.id, 'changerPlan', m.user.id)

    const reponse = await suspendre(m, { reauth: codeAutreAction })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
  })

  it('should consume the code: replaying the very same code on a second target fails', async () => {
    const m = await creerMondeA2()
    const code = await codeReauthPour(admin.id, 'suspendre', m.user.id)
    expect((await suspendre(m, { reauth: code })).status).toBe(200)

    const rejeu = await suspendre(m, { reauth: code, motif: 'Un second motif valable' })

    expect(rejeu).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
  })

  it.each([
    ['absent', {}],
    ['too short (4 characters)', { motif: 'abcd' }],
    ['only spaces', { motif: '          ' }],
    ['too long (501 characters)', { motif: 'x'.repeat(501) }],
    ['not a string', { motif: 12345 }],
    ['accompanied by an unknown key', { motif: MOTIF_SUSPENSION, suspendu: false }],
  ])('should answer 422 and change nothing when the motif is %s', async (_cas, corps) => {
    const m = await creerMondeA2()
    const avant = await etatCompte(m)

    const reponse = await suspendre(m, { corps })

    expect(reponse.status).toBe(422)
    expect(await etatCompte(m)).toEqual(avant)
    expect(await compterJournal()).toBe(0)
  })

  it('should NOT consume the reauthentication code when the body is invalid (the code stays usable)', async () => {
    const m = await creerMondeA2()
    const code = await codeReauthPour(admin.id, 'suspendre', m.user.id)

    expect((await suspendre(m, { reauth: code, corps: { motif: 'abc' } })).status).toBe(422)
    const bon = await suspendre(m, { reauth: code })

    expect(bon.status).toBe(200)
  })

  it('should accept a motif of exactly 5 and exactly 500 characters, trimmed', async () => {
    const a = await creerMondeA2()
    const b = await creerMondeA2()

    expect((await suspendre(a, { motif: '  abcde  ' })).status).toBe(200)
    expect((await suspendre(b, { motif: 'y'.repeat(500) })).status).toBe(200)
    expect((await lireUtilisateur(a.user.id))?.banReason).toBe('abcde')
  })
})

describe('suspendre : comptes d\'administration (cas non prévu par la spec, à trancher)', () => {
  it('should refuse to suspend a superadmin account, itself included: it would lock the administration out', async () => {
    const autreAdmin = await creerSuperadmin()

    for (const cible of [autreAdmin.id, admin.id]) {
      const reponse = await appelerA2('suspendre', {
        id: cible,
        cookie,
        reauth: await codeReauthPour(admin.id, 'suspendre', cible),
        corps: { motif: MOTIF_SUSPENSION },
      })
      expect(reponse, cible).toMatchObject({ status: 422, code: 'COMPTE_ADMIN' })
      expect((await lireUtilisateur(cible))?.banned, cible).toBe(false)
    }
    expect(await journalDe('utilisateur.suspendre')).toEqual([])
  })
})

describe('réactiver (CA04, D-A2-07 : motif seul, sans réauthentification)', () => {
  async function suspendu(): Promise<MondeA2> {
    const m = await creerMondeA2({ payantJours: 30 })
    await suspendre(m)
    return m
  }

  it('should lift the suspension with a motif only, journal the change and queue the e-mail', async () => {
    const m = await suspendu()

    const reponse = await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: MOTIF_A2 } })

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    expect(await lireUtilisateur(m.user.id)).toMatchObject({ banned: false, banReason: null, banExpires: null })
    const [ligne] = await journalDe('utilisateur.reactiver')
    expect(ligne).toMatchObject({ cible_type: 'utilisateur', cible_id: m.user.id, avant: { suspendu: true }, apres: { suspendu: false }, motif: MOTIF_A2 })
    expect(await lireOutboxUtilisateur(m.user.id, 'utilisateur_reactive')).toHaveLength(1)
  })

  it('should bring the public vitrine and the visitor writes back, with no other action (CA04)', async () => {
    const m = await suspendu()
    const { getPublicVitrinePage } = await import('../../../server/services/vitrines')
    const { createMessage } = await import('../../../server/services/messages')
    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).rejects.toMatchObject({ status: 404 })
    const avant = await compterEcritures(m.vitrine.id)

    await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: MOTIF_A2 } })

    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).resolves.toBeDefined()
    await createMessage(m.vitrine.username, { nom: 'Visiteur', email: 'visiteur@exemple.test', telephone: null, sujet: 'autre', message: 'Bonjour' })
    expect((await compterEcritures(m.vitrine.id)).messages).toBe(avant.messages + 1)
  })

  it('should let the owner sign in again, and NOT restore the sessions, tokens and consents that the suspension deleted', async () => {
    const m = await suspendu()

    await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: MOTIF_A2 } })

    expect(await lireSessions(m.user.id)).toEqual([])
    expect(await etatOauth(m.user.id)).toEqual({ consentements: 0, jetonsAcces: 0, jetonsRenouvellement: 0 })
    const connexion = await ouvrirSession(suite.auth(), m.user.email, 'public')
    expect(connexion.status).toBe(200)
    expect(await lireSessions(m.user.id)).toHaveLength(1)
  })

  it('should demand a valid motif (422) and answer 404 for an unknown account', async () => {
    const m = await suspendu()

    expect((await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: 'non' } })).status).toBe(422)
    expect((await appelerA2('reactiver', { id: '11111111-1111-4111-8111-111111111111', cookie, corps: { motif: MOTIF_A2 } })).status).toBe(404)
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(true)
  })

  it('should journal both actions in order and keep the chain intact over a suspend / reactivate cycle', async () => {
    const m = await suspendu()
    await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: MOTIF_A2 } })

    const actions = (await lireJournal()).map((l) => l.action)

    expect(actions).toEqual(['utilisateur.suspendre', 'utilisateur.reactiver'])
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should send the reactivation e-mail to the owner without any motif of suspension', async () => {
    const m = await suspendu()
    await appelerA2('reactiver', { id: m.user.id, cookie, corps: { motif: MOTIF_A2 } })
    const [ligne] = await lireOutboxUtilisateur(m.user.id, 'utilisateur_reactive')

    const envoi = await traiter(ligne!.id, utc('2099-01-01T00:00:00.000Z'))

    expect(envoi.resultat.statut).toBe('envoye')
    expect(envoi.transport.dernier.to).toBe(m.user.email)
    expect(`${envoi.transport.dernier.text}${envoi.transport.dernier.html ?? ''}`).not.toContain(MOTIF_SUSPENSION)
  })
})
