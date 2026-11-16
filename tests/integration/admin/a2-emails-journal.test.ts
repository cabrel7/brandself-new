import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { db } from '../../../server/utils/db'
import { preparerEmailAdminCompte } from '../../../server/services/admin/a2-emails'
import { createUser } from '../support/fabriques'
import { creerCompteSimple } from '../support/admin-a2'
import { desinstallerAdmin, insererLigneJournal, installerAdmin } from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A2 (revue de sécurité, MINOR) : `preparerEmailAdminCompte` retrouve l'entrée de journal par `numero` + `action` ET
// `cible_id` = compte de la ligne d'outbox (défense en profondeur : une occurrence qui désigne l'entrée d'un AUTRE compte
// est refusée, le motif d'un compte ne part jamais vers un autre). Base PostgreSQL réelle, journal réel.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

async function numeroDe(ligneId: string): Promise<string> {
  const resultat = await db.execute<{ numero: string }>(sql`SELECT numero::text AS numero FROM journal_admin WHERE id = ${ligneId}`)
  const ligne = resultat.rows[0]
  if (!ligne) throw new Error('Entrée de journal introuvable.')
  return ligne.numero
}

function ligneOutbox(entiteId: string, occurrence: string) {
  return { id: 'outbox-test', type: 'utilisateur_suspendu', entiteId, occurrence, createdAt: new Date() } as Parameters<typeof preparerEmailAdminCompte>[1]
}

describe('e-mail d\'administration : entrée de journal du bon compte', () => {
  it('should prepare the e-mail when the journal entry targets the account of the outbox row', async () => {
    const compte = await createUser()
    const ligneId = await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.utilisateurSuspendre, cibleType: 'utilisateur', cibleId: compte.id })

    const resultat = await preparerEmailAdminCompte(db, ligneOutbox(compte.id, await numeroDe(ligneId)))

    expect(resultat).toHaveProperty('contenu')
  })

  it('should cancel the e-mail when the journal entry targets ANOTHER account, even with the right number and action', async () => {
    const compte = await createUser()
    const autre = await createUser()
    const ligneId = await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.utilisateurSuspendre, cibleType: 'utilisateur', cibleId: autre.id })

    const resultat = await preparerEmailAdminCompte(db, ligneOutbox(compte.id, await numeroDe(ligneId)))

    expect(resultat).toEqual({ annule: 'ENTITE_INTROUVABLE' })
  })

  it('should match a depublication entry through the vitrine of the account, and refuse the vitrine of another account', async () => {
    const compte = await creerCompteSimple()
    const autre = await creerCompteSimple()
    const ligneId = await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.vitrineDepublier, cibleType: 'vitrine', cibleId: compte.vitrine?.id ?? '' })
    const numero = await numeroDe(ligneId)
    const ligne = (entiteId: string) => ({ ...ligneOutbox(entiteId, numero), type: 'utilisateur_depubliee' }) as Parameters<typeof preparerEmailAdminCompte>[1]

    expect(await preparerEmailAdminCompte(db, ligne(compte.user.id))).toHaveProperty('contenu')
    expect(await preparerEmailAdminCompte(db, ligne(autre.user.id))).toEqual({ annule: 'ENTITE_INTROUVABLE' })
  })
})
