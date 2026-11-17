import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNT_DELETION_PHRASE } from '../../../shared/compte'
import { ERROR_STATUS } from '../../../shared/erreurs'
import { db } from '../../../server/utils/db'
import {
  auditService,
  avecJournalEnPanne,
  compterJournal,
  creerSuperadmin,
  journalDe,
  lireJournal,
  ouvrirAdmin,
  ouvrirSession,
  preparerSuiteAdmin,
} from '../support/admin'
import {
  MOTIF_A2,
  appelerA2,
  codeReauthPour,
  creerMondeA2,
  lireUtilisateur,
  lireVitrineDe,
  poserAssistant,
  viderClientsOauth,
} from '../support/admin-a2'
import type { MondeA2 } from '../support/admin-a2'
import { insererPaiement, lirePaiement } from '../support/abonnements'
import { fichiersDeLUtilisateur } from '../support/disque'
import { creerPro, insererOutbox, lireOutbox } from '../support/notifications'
import { createSession } from '../support/fabriques'
import { rejet } from '../support/erreurs'
import { utilisateursService } from '../support/modules'

// A2 CA08, D-A2-08 : suppression d'un compte par l'administration (confirmation par l'e-mail exact + réauthentification
// + motif), et non-régression de la suppression du studio (phrase + session fraîche), refactorée en
// `supprimerCompteEtFichiers`. Base, disque et Redis réels : on prouve la disparition des lignes ET des fichiers.

const suite = preparerSuiteAdmin()
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  await viderClientsOauth()
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

async function supprimer(m: { user: { id: string, email: string } }, surcharges: { email?: string, motif?: string, reauth?: string | null, corps?: unknown } = {}) {
  const reauth = surcharges.reauth === null ? undefined : (surcharges.reauth ?? await codeReauthPour(admin.id, 'supprimer', m.user.id))
  return appelerA2('supprimer', {
    id: m.user.id,
    cookie,
    ...(reauth === undefined ? {} : { reauth }),
    corps: surcharges.corps ?? { motif: surcharges.motif ?? MOTIF_A2, emailConfirmation: surcharges.email ?? m.user.email },
  })
}

async function compter(table: string, colonne: string, valeur: string): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.raw(table)} WHERE ${sql.raw(colonne)} = ${valeur}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

async function monde(): Promise<MondeA2> {
  const m = await creerMondeA2({ payantJours: 30 })
  await ouvrirSession(suite.auth(), m.user.email, 'public')
  await poserAssistant(m.user.id)
  return m
}

describe('supprimer (CA08)', () => {
  it('should delete the account, its vitrine, services, media rows AND media files, sessions and OAuth state', async () => {
    const m = await monde()
    const medias = await compter('medias', 'user_id', m.user.id)
    expect(medias, 'témoin : un média existe').toBeGreaterThan(0)
    expect((await fichiersDeLUtilisateur(m.user.id)).length, 'témoin : des fichiers existent').toBeGreaterThan(0)

    const reponse = await supprimer(m)

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    expect(await lireUtilisateur(m.user.id)).toBeUndefined()
    expect(await lireVitrineDe(m.user.id)).toBeUndefined()
    expect(await compter('services', 'vitrine_id', m.vitrine.id)).toBe(0)
    expect(await compter('reservations', 'vitrine_id', m.vitrine.id)).toBe(0)
    expect(await compter('medias', 'user_id', m.user.id)).toBe(0)
    expect(await compter('sessions', 'user_id', m.user.id)).toBe(0)
    expect(await compter('oauth_consents', 'user_id', m.user.id)).toBe(0)
    expect(await fichiersDeLUtilisateur(m.user.id)).toEqual([])
  })

  it('should keep the payments of the deleted account with user_id NULL (accounting records survive)', async () => {
    const m = await monde()
    const paiement = await insererPaiement(m.user.id)

    await supprimer(m)

    expect((await lirePaiement(paiement.id)).userId).toBeNull()
  })

  it('should not touch another account, its payments, nor its files', async () => {
    const m = await monde()
    const autre = await monde()
    const paiementAutre = await insererPaiement(autre.user.id)
    const fichiersAutre = await fichiersDeLUtilisateur(autre.user.id)

    await supprimer(m)

    expect(await lireUtilisateur(autre.user.id)).toBeDefined()
    expect((await lirePaiement(paiementAutre.id)).userId).toBe(autre.user.id)
    expect(await fichiersDeLUtilisateur(autre.user.id)).toEqual(fichiersAutre)
  })

  it('should journal ONE chained line with no personal data in it (the deleted account\'s name, e-mail, username and phone appear nowhere)', async () => {
    const m = await monde()

    await supprimer(m)

    const lignes = await journalDe('utilisateur.supprimer')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: admin.id, cible_type: 'utilisateur', cible_id: m.user.id, motif: MOTIF_A2, apres: { supprime: true } })
    expect(lignes[0]?.avant).toMatchObject({ suspendu: false })
    const tout = JSON.stringify(await lireJournal())
    for (const donnee of [m.user.email, m.user.name, m.vitrine.username]) expect(tout).not.toContain(donnee)
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should cancel the pending e-mails addressed to the account BEFORE deleting it, and queue none for it (no e-mail to a deleted account)', async () => {
    const m = await monde()
    await insererOutbox({ type: 'utilisateur_resume_hebdo', entiteType: 'utilisateur', entiteId: m.user.id, occurrence: '2026-W45' })
    await insererOutbox({ type: 'utilisateur_rappel_journee', entiteType: 'utilisateur', entiteId: m.user.id, occurrence: '2026-11-10' })

    await supprimer(m)

    const restantes = await lireOutbox({ entiteId: m.user.id })
    expect(restantes.filter((ligne) => ligne.statut === 'en_attente')).toEqual([])
    expect(restantes.filter((ligne) => ligne.type.startsWith('utilisateur_') && ligne.createdAt.getTime() > Date.now() - 60_000 && ligne.statut === 'en_attente')).toEqual([])
  })
})

describe('supprimer : confirmation par l\'e-mail exact (D-A2-08)', () => {
  it.each([
    ['another address', (m: MondeA2) => `autre-${m.user.email}`],
    ['the address of ANOTHER existing account', (_m: MondeA2, autre: MondeA2) => autre.user.email],
    ['a prefix of the address', (m: MondeA2) => m.user.email.slice(0, -3)],
    ['the user name', (m: MondeA2) => m.user.name],
  ])('should refuse with 422 CONFIRMATION_EMAIL_INVALIDE and delete nothing when the typed address is %s', async (_cas, saisir) => {
    const m = await monde()
    const autre = await creerMondeA2()

    const reponse = await supprimer(m, { email: saisir(m, autre) })

    expect(reponse).toMatchObject({ status: 422, code: 'CONFIRMATION_EMAIL_INVALIDE' })
    expect(await lireUtilisateur(m.user.id)).toBeDefined()
    expect((await fichiersDeLUtilisateur(m.user.id)).length).toBeGreaterThan(0)
    expect(await compterJournal()).toBe(0)
  })

  it('should accept the exact address surrounded by spaces (the input is trimmed)', async () => {
    const m = await monde()

    const reponse = await supprimer(m, { email: `  ${m.user.email}  ` })

    expect(reponse.status).toBe(200)
  })

  it('should not reveal the expected address in the refusal', async () => {
    const m = await monde()

    const reponse = await supprimer(m, { email: 'quelquun@exemple.test' })

    expect(JSON.stringify(reponse)).not.toContain(m.user.email)
  })

  it('should not consume the reauthentication code when the typed address is wrong (retry with the same code works)', async () => {
    const m = await monde()
    const code = await codeReauthPour(admin.id, 'supprimer', m.user.id)

    expect((await supprimer(m, { reauth: code, email: 'faux@exemple.test' })).status).toBe(422)
    const bon = await supprimer(m, { reauth: code })

    expect(bon.status).toBe(200)
  })
})

describe('supprimer : réauthentification, motif, cibles interdites', () => {
  it('should demand the code (REAUTH_REQUISE), a code bound to this account, and a valid motif', async () => {
    const m = await monde()
    const autre = await creerMondeA2()
    const codeAutre = await codeReauthPour(admin.id, 'supprimer', autre.user.id)

    const sans = await supprimer(m, { reauth: null })
    const mauvaiseCible = await supprimer(m, { reauth: codeAutre })
    const motifCourt = await supprimer(m, { motif: 'non' })

    expect(sans).toMatchObject({ status: ERROR_STATUS.REAUTH_REQUISE, code: 'REAUTH_REQUISE' })
    expect(mauvaiseCible).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect(motifCourt.status).toBe(422)
    expect(await lireUtilisateur(m.user.id)).toBeDefined()
    expect(await lireUtilisateur(autre.user.id)).toBeDefined()
    expect(await compterJournal()).toBe(0)
  })

  it('should refuse to delete a superadmin, itself included, with COMPTE_ADMIN (422), never a raw SQL error from the journal FK', async () => {
    const autreAdmin = await creerSuperadmin()

    for (const cible of [autreAdmin, admin]) {
      const reponse = await supprimer({ user: cible })
      expect(reponse, cible.id).toMatchObject({ status: 422, code: 'COMPTE_ADMIN' })
      expect(await lireUtilisateur(cible.id), cible.id).toBeDefined()
    }
  })

  it('should refuse a former superadmin still referenced by the journal (COMPTE_ADMIN) instead of failing on the foreign key', async () => {
    const { journaliser } = await import('../support/admin')
    const ancien = await creerSuperadmin()
    await journaliser(ancien.id)
    await db.execute(sql`UPDATE users SET role = 'user' WHERE id = ${ancien.id}`)

    const reponse = await supprimer({ user: ancien })

    expect(reponse).toMatchObject({ status: 422, code: 'COMPTE_ADMIN' })
    expect(await lireUtilisateur(ancien.id)).toBeDefined()
  })

  it('should answer 404 UTILISATEUR_INTROUVABLE for an unknown account', async () => {
    const reponse = await supprimer({ user: { id: '00000000-0000-4000-8000-000000000000', email: 'x@exemple.test' } })

    expect(reponse).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
  })

  it('should delete nothing, write no journal line and leave the files when the journal write fails (atomicity)', async () => {
    const m = await monde()
    const fichiers = await fichiersDeLUtilisateur(m.user.id)

    const reponse = await avecJournalEnPanne(() => supprimer(m))

    expect(reponse.status).toBe(500)
    expect(await lireUtilisateur(m.user.id)).toBeDefined()
    expect(await fichiersDeLUtilisateur(m.user.id)).toEqual(fichiers)
    expect(await compterJournal()).toBe(0)
  })

  it('should delete a SUSPENDED account too (the suspension is no obstacle)', async () => {
    const m = await monde()
    const { suspendreEnBase } = await import('../support/admin-a2')
    await suspendreEnBase(m.user.id)

    const reponse = await supprimer(m)

    expect(reponse.status).toBe(200)
    expect((await journalDe('utilisateur.supprimer'))[0]?.avant).toMatchObject({ suspendu: true })
  })
})

describe('suppression du studio : comportement inchangé par l\'extraction (spec §10, point 9)', () => {
  const entree = { confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: new Date() }

  it('should still delete the account and its files with the phrase and a fresh session', async () => {
    const { deleteAccount } = await utilisateursService()
    const m = await creerMondeA2()
    expect((await fichiersDeLUtilisateur(m.user.id)).length).toBeGreaterThan(0)

    await deleteAccount(m.user.id, entree)

    expect(await lireUtilisateur(m.user.id)).toBeUndefined()
    expect(await fichiersDeLUtilisateur(m.user.id)).toEqual([])
  })

  it('should still refuse a wrong phrase (400) and an old session (403) and delete nothing', async () => {
    const { deleteAccount } = await utilisateursService()
    const m = await creerMondeA2()

    const phrase = await rejet(deleteAccount(m.user.id, { ...entree, confirmation: 'oui' }))
    const ancienne = await rejet(deleteAccount(m.user.id, { ...entree, sessionCreatedAt: new Date(Date.now() - 30 * 86_400_000) }))

    expect(phrase).toMatchObject({ code: 'CONFIRMATION_INVALIDE', status: 400 })
    expect(ancienne).toMatchObject({ code: 'SESSION_TROP_ANCIENNE', status: 403 })
    expect(await lireUtilisateur(m.user.id)).toBeDefined()
  })

  it('should NOT accept the administration confirmation (an e-mail) as the studio phrase', async () => {
    const { deleteAccount } = await utilisateursService()
    const pro = await creerPro()
    await createSession(pro.user.id)

    const erreur = await rejet(deleteAccount(pro.user.id, { ...entree, confirmation: pro.user.email }))

    expect(erreur).toMatchObject({ code: 'CONFIRMATION_INVALIDE' })
    expect(await lireUtilisateur(pro.user.id)).toBeDefined()
  })
})
