import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_DELETION_PHRASE } from '../../../shared/compte'
import { users } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import { compterJournal, creerSuperadmin, creerUtilisateurOrdinaire, journaliser } from '../support/admin'
import { rejet } from '../support/erreurs'
import { utilisateursService } from '../support/modules'

// A1 : la suppression de compte du studio (`deleteAccount`) refuse un compte d'administration ou référencé par le
// journal (FK RESTRICT) avec COMPTE_ADMIN (422), au lieu d'une erreur SQL brute.

const entree = () => ({ confirmation: ACCOUNT_DELETION_PHRASE, sessionCreatedAt: new Date() })
const present = async (id: string) => (await db.select().from(users).where(eq(users.id, id))).length === 1

describe('deleteAccount et comptes d\'administration', () => {
  it('should refuse a superadmin that has a journal line: 422 COMPTE_ADMIN, account and journal intact', async () => {
    const { deleteAccount } = await utilisateursService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    const erreur = await rejet(deleteAccount(admin.id, entree()))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'COMPTE_ADMIN', status: 422 })
    expect(await present(admin.id)).toBe(true)
    expect(await compterJournal()).toBe(1)
  })

  it('should refuse a superadmin without any journal line too', async () => {
    const { deleteAccount } = await utilisateursService()
    const admin = await creerSuperadmin()

    const erreur = await rejet(deleteAccount(admin.id, entree()))

    expect(erreur).toMatchObject({ code: 'COMPTE_ADMIN', status: 422 })
    expect(await present(admin.id)).toBe(true)
  })

  it('should refuse an account that is no longer a superadmin but is still referenced by the journal', async () => {
    const { deleteAccount } = await utilisateursService()
    const ancien = await creerSuperadmin()
    await journaliser(ancien.id)
    await db.update(users).set({ role: 'user' }).where(eq(users.id, ancien.id))

    expect(await rejet(deleteAccount(ancien.id, entree()))).toMatchObject({ code: 'COMPTE_ADMIN', status: 422 })
    expect(await present(ancien.id)).toBe(true)
  })

  it('should delete an ordinary account normally', async () => {
    const { deleteAccount } = await utilisateursService()
    const ordinaire = await creerUtilisateurOrdinaire()

    await deleteAccount(ordinaire.id, entree())

    expect(await present(ordinaire.id)).toBe(false)
  })

  it('should check the confirmation phrase before anything else', async () => {
    const { deleteAccount } = await utilisateursService()
    const admin = await creerSuperadmin()

    expect(await rejet(deleteAccount(admin.id, { ...entree(), confirmation: 'oui' }))).toMatchObject({ code: 'CONFIRMATION_INVALIDE', status: 400 })
  })
})
