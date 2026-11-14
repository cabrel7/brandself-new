import { createHash, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { AUDIT_VALEUR_TEXTE_MAX, CLES_AUDIT_INTERDITES } from '../../../shared/admin'
import { users } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import {
  IP_TEST,
  MOTIF_TEST,
  auditService,
  compterJournal,
  creerSuperadmin,
  entreeAudit,
  etatDeclencheurs,
  journaliser,
  lireJournal,
  sansDeclencheur,
} from '../support/admin'
import { erreurPostgres, rejet } from '../support/erreurs'

// A1, journal d'administration sur base RÉELLE : aucun mock du journal, des droits ni des déclencheurs.
// CA13 (ajout seul), CA14 (atomicité), CA15 (chaîne), CA16 (concurrence), CA17 (liste noire), CA21 (idempotence).

const INSUFFICIENT_PRIVILEGE = '42501'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
/** ON DELETE RESTRICT : PostgreSQL lève restrict_violation (23001), pas foreign_key_violation. */
const RESTRICT_VIOLATION = '23001'
const CHECK_VIOLATION = '23514'
const INVALID_TRANSACTION_STATE = '25000'
const HEX_64 = /^[0-9a-f]{64}$/
const ZEROS_64 = '0'.repeat(64)

/** Les trois déclencheurs doivent TOUJOURS être actifs en sortie de test, quoi qu'il se soit passé. */
afterEach(async () => {
  expect(await etatDeclencheurs()).toEqual({
    journal_admin_chainer: 'O',
    journal_admin_sans_modif: 'O',
    journal_admin_sans_vidage: 'O',
  })
})

describe('journal ajout seul : UPDATE, DELETE, TRUNCATE refusés par la base (CA13)', () => {
  it('should refuse an UPDATE with SQLSTATE 42501 and leave the line untouched', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    const erreur = await rejet(db.execute(sql`UPDATE journal_admin SET motif = 'Motif réécrit après coup'`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect((await lireJournal())[0]?.motif).toBe(MOTIF_TEST)
  })

  it.each([
    ['cible_id', sql`UPDATE journal_admin SET cible_id = 'autre'`],
    ['apres', sql`UPDATE journal_admin SET apres = '{"statut":"actif"}'::jsonb`],
    ['empreinte', sql`UPDATE journal_admin SET empreinte = repeat('a', 64)`],
    ['numero', sql`UPDATE journal_admin SET numero = 99`],
    ['admin_id', sql`UPDATE journal_admin SET admin_id = admin_id`],
  ])('should refuse an UPDATE of %s', async (_colonne, requete) => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    const avant = await lireJournal()

    const erreur = await rejet(db.execute(requete))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await lireJournal()).toEqual(avant)
  })

  it('should refuse a DELETE with SQLSTATE 42501 and keep every line', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)

    const erreur = await rejet(db.execute(sql`DELETE FROM journal_admin`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await compterJournal()).toBe(2)
  })

  it('should refuse a DELETE aimed at a single line', async () => {
    const admin = await creerSuperadmin()
    const ligne = await journaliser(admin.id)

    const erreur = await rejet(db.execute(sql`DELETE FROM journal_admin WHERE id = ${ligne.id}`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await compterJournal()).toBe(1)
  })

  it('should refuse a TRUNCATE with SQLSTATE 42501, even on an empty journal', async () => {
    const erreur = await rejet(db.execute(sql`TRUNCATE TABLE journal_admin`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
  })

  it('should refuse a TRUNCATE that reaches the journal through a CASCADE from users', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    const erreur = await rejet(db.execute(sql`TRUNCATE TABLE users CASCADE`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await compterJournal()).toBe(1)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('should refuse the same writes issued from the application layer (Drizzle query builder)', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    const { journalAdmin } = await import('../../../shared/db/schema')

    const erreurMaj = await rejet(Promise.resolve(db.update(journalAdmin).set({ motif: 'Motif réécrit par le code' })))
    const erreurSuppression = await rejet(Promise.resolve(db.delete(journalAdmin)))

    expect(erreurPostgres(erreurMaj.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(erreurPostgres(erreurSuppression.brute).sqlstate).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await compterJournal()).toBe(1)
  })

  it('should refuse to delete an account that has journal lines (ON DELETE RESTRICT keeps the trail)', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    const erreur = await rejet(db.execute(sql`DELETE FROM users WHERE id = ${admin.id}`))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(RESTRICT_VIOLATION)
    expect(await compterJournal()).toBe(1)
  })

  it('should let an INSERT through (control: the refusals above come from the triggers, not from a broken table)', async () => {
    const admin = await creerSuperadmin()

    const ligne = await journaliser(admin.id)

    expect(ligne.numero).toBe(1)
    expect(await compterJournal()).toBe(1)
  })
})

describe('atomicité : l\'action et son journal réussissent ou échouent ensemble (CA14)', () => {
  it('should leave neither the action nor the journal line when the action throws after the journal write', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    const erreur = await rejet(
      db.transaction(async (tx) => {
        await enregistrer(tx, entreeAudit(admin.id))
        await tx.update(users).set({ name: 'Nom modifié par l\'action' }).where(eq(users.id, admin.id))
        throw new Error('ECHEC_DE_L_ACTION')
      }),
    )

    expect(erreur.message).toBe('ECHEC_DE_L_ACTION')
    expect(await compterJournal()).toBe(0)
    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom avant')
  })

  it('should leave neither the action nor the journal line when the action throws before the journal write', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    await rejet(
      db.transaction(async (tx) => {
        await tx.update(users).set({ name: 'Nom modifié par l\'action' }).where(eq(users.id, admin.id))
        await enregistrer(tx, entreeAudit(admin.id))
        await tx.execute(sql`SELECT 1/0`)
      }),
    )

    expect(await compterJournal()).toBe(0)
    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom avant')
  })

  it('should leave the action undone when the journal write itself fails (invalid entry)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    await rejet(
      db.transaction(async (tx) => {
        await tx.update(users).set({ name: 'Nom modifié par l\'action' }).where(eq(users.id, admin.id))
        await enregistrer(tx, entreeAudit(admin.id, { apres: { email: 'quelqu-un@exemple.test' } }))
      }),
    )

    expect(await compterJournal()).toBe(0)
    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom avant')
  })

  it('should leave the action undone when the database refuses the journal line (unknown admin)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    const erreur = await rejet(
      db.transaction(async (tx) => {
        await tx.update(users).set({ name: 'Nom modifié par l\'action' }).where(eq(users.id, admin.id))
        await enregistrer(tx, entreeAudit('administrateur-qui-n-existe-pas'))
      }),
    )

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(FK_VIOLATION)
    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom avant')
  })

  it('should keep both the action and the journal line when the transaction commits (control)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    await db.transaction(async (tx) => {
      await enregistrer(tx, entreeAudit(admin.id))
      await tx.update(users).set({ name: 'Nom après' }).where(eq(users.id, admin.id))
    })

    expect(await compterJournal()).toBe(1)
    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom après')
  })

  it('should not consume a journal number on a rolled-back transaction (no hole in the numbering)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await rejet(db.transaction(async (tx) => {
      await enregistrer(tx, entreeAudit(admin.id))
      throw new Error('ANNULATION')
    }))

    const suivante = await journaliser(admin.id)

    expect(suivante.numero).toBe(2)
  })

  it('should refuse to chain the journal under an isolation level that would read a stale snapshot', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    const erreur = await rejet(
      db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id)), { isolationLevel: 'repeatable read' }),
    )

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(INVALID_TRANSACTION_STATE)
    expect(await compterJournal()).toBe(0)
  })
})

describe('chaîne de hachage (CA15)', () => {
  it('should number the lines 1, 2, 3 and link each one to the fingerprint of the previous one', async () => {
    const admin = await creerSuperadmin()
    await journaliser(admin.id, { cibleId: 'a' })
    await journaliser(admin.id, { cibleId: 'b' })
    await journaliser(admin.id, { cibleId: 'c' })

    const lignes = await lireJournal()

    expect(lignes.map((l) => Number(l.numero))).toEqual([1, 2, 3])
    expect(lignes[0]?.empreinte_precedente).toBe(ZEROS_64)
    expect(lignes[1]?.empreinte_precedente).toBe(lignes[0]?.empreinte)
    expect(lignes[2]?.empreinte_precedente).toBe(lignes[1]?.empreinte)
    for (const ligne of lignes) expect(ligne.empreinte).toMatch(HEX_64)
    expect(new Set(lignes.map((l) => l.empreinte)).size).toBe(3)
  })

  it('should report an empty journal as intact', async () => {
    const { verifierChaine } = await auditService()

    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should report an untouched journal of three lines as intact', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should detect the second line altered after the fact: { intacte: false, premiereRupture: 2 } (trigger disabled for the test only)', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id, { cibleId: 'a' })
    await journaliser(admin.id, { cibleId: 'b' })
    await journaliser(admin.id, { cibleId: 'c' })

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`UPDATE journal_admin SET motif = 'Motif réécrit par un administrateur de base' WHERE numero = 2`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 2 })
  })

  it.each([
    [1, 'la première ligne'],
    [3, 'la dernière ligne'],
  ])('should point at line %i when %s is altered', async (numero) => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`UPDATE journal_admin SET ip = '198.51.100.99' WHERE numero = ${numero}`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: numero })
  })

  it.each([
    ['apres', sql`UPDATE journal_admin SET apres = '{"statut":"autre"}'::jsonb WHERE numero = 2`],
    ['avant', sql`UPDATE journal_admin SET avant = NULL WHERE numero = 2`],
    ['action', sql`UPDATE journal_admin SET action = 'compte.supprimer' WHERE numero = 2`],
    ['admin_id', sql`UPDATE journal_admin SET admin_id = (SELECT id FROM users WHERE id <> (SELECT admin_id FROM journal_admin WHERE numero = 2) LIMIT 1) WHERE numero = 2`],
    ['cree_le', sql`UPDATE journal_admin SET cree_le = cree_le - interval '1 day' WHERE numero = 2`],
    ['cle_idempotence', sql`UPDATE journal_admin SET cle_idempotence = 'cle-ajoutee-apres' WHERE numero = 2`],
  ])('should detect an alteration of the field %s of the second line', async (_champ, alteration) => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(alteration)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 2 })
  })

  it('should detect a line whose fingerprint was overwritten with another valid-looking fingerprint', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`UPDATE journal_admin SET empreinte = ${'b'.repeat(64)} WHERE numero = 1`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 1 })
  })

  it('should detect a forger who rewrites a line AND recomputes its fingerprint: the NEXT line no longer matches', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`
        UPDATE journal_admin SET
          motif = 'Motif réécrit et empreinte recalculée',
          empreinte = journal_admin_empreinte(empreinte_precedente, numero, id, admin_id, action, cible_type, cible_id,
            avant, apres, 'Motif réécrit et empreinte recalculée', ip, cle_idempotence, cree_le)
        WHERE numero = 2`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 3 })
  })

  it('should detect a line deleted from the middle of the journal (trigger disabled for the test only)', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`DELETE FROM journal_admin WHERE numero = 2`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 3 })
  })

  it('should detect the first line deleted', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)
    await journaliser(admin.id)

    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`DELETE FROM journal_admin WHERE numero = 1`)
    })

    expect(await verifierChaine(db)).toEqual({ intacte: false, premiereRupture: 2 })
  })

  it('should restore the triggers even when the altering block throws', async () => {
    await rejet(sansDeclencheur('journal_admin_sans_modif', async () => {
      expect((await etatDeclencheurs()).journal_admin_sans_modif).toBe('D')
      throw new Error('ECHEC_DANS_LE_BLOC')
    }))

    expect((await etatDeclencheurs()).journal_admin_sans_modif).toBe('O')
  })

  it('should be verifiable from inside a transaction (an executor, not only the pool)', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await journaliser(admin.id)

    const resultat = await db.transaction((tx) => verifierChaine(tx))

    expect(resultat).toEqual({ intacte: true, premiereRupture: null })
  })
})

describe('chaîne posée par le déclencheur, jamais par l\'appelant', () => {
  it('should overwrite a forged numero, previous fingerprint, fingerprint and date sent by the client', async () => {
    const admin = await creerSuperadmin()
    const forge = new Date('2001-01-01T00:00:00.000Z')

    await db.execute(sql`
      INSERT INTO journal_admin (id, numero, admin_id, action, cible_type, motif, ip, cree_le, empreinte_precedente, empreinte)
      VALUES (${randomUUID()}, 999, ${admin.id}, 'compte.suspendre', 'utilisateur', ${MOTIF_TEST}, ${IP_TEST}, ${forge.toISOString()}::timestamptz,
              ${'c'.repeat(64)}, ${'d'.repeat(64)})`)

    const [ligne] = await lireJournal()
    expect(Number(ligne?.numero)).toBe(1)
    expect(ligne?.empreinte_precedente).toBe(ZEROS_64)
    expect(ligne?.empreinte).not.toBe('d'.repeat(64))
    expect(ligne?.cree_le.getTime()).toBeGreaterThan(Date.now() - 60_000)
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should compute the fingerprint as SHA-256 of the JSON array of the line (independent recomputation in Node)', async () => {
    const admin = await creerSuperadmin()
    const id = 'ligne-de-reference'
    await db.execute(sql`
      INSERT INTO journal_admin (id, admin_id, action, cible_type, cible_id, motif, ip)
      VALUES (${id}, ${admin.id}, 'compte.suspendre', 'utilisateur', 'cible-9', 'Motif de reference', '203.0.113.9')`)
    const resultat = await db.execute<{ empreinte: string, empreinte_precedente: string, numero: string, cree: string }>(sql`
      SELECT empreinte, empreinte_precedente, numero::text AS numero,
             to_char(cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cree
      FROM journal_admin WHERE id = ${id}`)
    const ligne = resultat.rows[0]!
    // jsonb_build_array(...)::text sépare les éléments par « , » ; un NULL SQL devient null.
    const tableau = [ligne.empreinte_precedente, Number(ligne.numero), id, admin.id, 'compte.suspendre', 'utilisateur', 'cible-9', null, null, 'Motif de reference', '203.0.113.9', null, ligne.cree]
    const attendu = createHash('sha256').update(`[${tableau.map((v) => JSON.stringify(v)).join(', ')}]`, 'utf8').digest('hex')

    expect(ligne.empreinte).toBe(attendu)
  })

  it('should make the fingerprint independent of the session time zone', async () => {
    const { verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`)
      const { enregistrer } = await auditService()
      await enregistrer(tx, entreeAudit(admin.id))
    })

    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should store the before/after state exactly as sent', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()
    const avant = { statut: 'actif', jours: 3, ok: true, rien: null }
    const apres = { statut: 'suspendu', jours: 0, ok: false, rien: null }

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { avant, apres })))

    const [ligne] = await lireJournal()
    expect(ligne?.avant).toEqual(avant)
    expect(ligne?.apres).toEqual(apres)
  })

  it('should accept a creation (no before state) and a state-less action', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { avant: null, apres: { role: 'superadmin' }, cibleId: null })))
    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { avant: undefined, apres: undefined })))

    const lignes = await lireJournal()
    expect(lignes[0]).toMatchObject({ avant: null, apres: { role: 'superadmin' }, cible_id: null })
    expect(lignes[1]).toMatchObject({ avant: null, apres: null })
  })

  it('should return the identifier and the number of the line it wrote', async () => {
    const admin = await creerSuperadmin()

    const premiere = await journaliser(admin.id)
    const seconde = await journaliser(admin.id)

    expect(premiere.numero).toBe(1)
    expect(seconde.numero).toBe(2)
    const lignes = await lireJournal()
    expect(lignes.map((l) => l.id)).toEqual([premiere.id, seconde.id])
  })
})

describe('20 insertions simultanées (CA16)', () => {
  it('should number 20 concurrent writes from 1 to 20 without any hole and keep the chain intact', async () => {
    const { enregistrer, verifierChaine } = await auditService()
    const admin = await creerSuperadmin()

    const retours = await Promise.all(
      Array.from({ length: 20 }, (_, i) => db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cibleId: `cible-${i}` })))),
    )

    const lignes = await lireJournal()
    expect(lignes.map((l) => Number(l.numero))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(retours.map((r) => r.numero).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(new Set(lignes.map((l) => l.empreinte)).size).toBe(20)
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should keep the dates in the order of the numbers (the date is taken under the lock)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cibleId: `cible-${i}` })))),
    )

    const lignes = await lireJournal()
    for (let i = 1; i < lignes.length; i += 1) {
      expect(lignes[i]!.cree_le.getTime(), `ligne ${i + 1}`).toBeGreaterThanOrEqual(lignes[i - 1]!.cree_le.getTime())
    }
  })

  it('should leave no hole when some concurrent transactions roll back: the survivors are numbered 1..n', async () => {
    const { enregistrer, verifierChaine } = await auditService()
    const admin = await creerSuperadmin()

    const resultats = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => db.transaction(async (tx) => {
        await enregistrer(tx, entreeAudit(admin.id, { cibleId: `cible-${i}` }))
        if (i % 2 === 1) throw new Error('ANNULATION_VOLONTAIRE')
      })),
    )

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(6)
    expect(resultats.filter((r) => r.status === 'rejected')).toHaveLength(6)
    const lignes = await lireJournal()
    expect(lignes.map((l) => Number(l.numero))).toEqual([1, 2, 3, 4, 5, 6])
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should serialize writers that come from two different administrators', async () => {
    const { enregistrer, verifierChaine } = await auditService()
    const premier = await creerSuperadmin()
    const second = await creerSuperadmin()

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => db.transaction((tx) => enregistrer(tx, entreeAudit(i % 2 === 0 ? premier.id : second.id)))),
    )

    expect((await lireJournal()).map((l) => Number(l.numero))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })
})

describe('liste noire et forme des états avant/après : rien n\'est écrit (CA17)', () => {
  async function refuse(surcharges: Record<string, unknown>): Promise<void> {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await expect(db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, surcharges)))).rejects.toBeDefined()

    expect(await compterJournal()).toBe(0)
  }

  it('should refuse apres.email and write nothing', async () => {
    await refuse({ apres: { email: 'quelqu-un@exemple.test' } })
  })

  it.each(CLES_AUDIT_INTERDITES.map((cle) => [cle]))('should refuse the blacklisted key "%s" in the after state', async (cle) => {
    await refuse({ apres: { [cle]: 'valeur' } })
  })

  it.each(CLES_AUDIT_INTERDITES.map((cle) => [cle]))('should refuse the blacklisted key "%s" in the before state', async (cle) => {
    await refuse({ avant: { [cle]: 'valeur' } })
  })

  it('should refuse a text value longer than 64 characters, and accept exactly 64', async () => {
    await refuse({ apres: { statut: 'x'.repeat(AUDIT_VALEUR_TEXTE_MAX + 1) } })
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { apres: { statut: 'x'.repeat(AUDIT_VALEUR_TEXTE_MAX) } })))

    expect(await compterJournal()).toBe(1)
  })

  it.each([
    ['un objet imbriqué', { apres: { detail: { a: 1 } } }],
    ['un tableau', { apres: { liste: ['a', 'b'] } }],
    ['une date', { apres: { quand: new Date() } }],
    ['undefined', { apres: { statut: undefined as unknown as string } }],
    ['une fonction', { apres: { statut: (() => 'x') as unknown as string } }],
    ['un état qui est un tableau', { apres: ['a'] }],
    ['un état qui est une chaîne', { apres: 'statut=suspendu' }],
  ])('should refuse %s as a value of the after state', async (_cas, surcharges) => {
    await refuse(surcharges)
  })

  it.each([
    ['majuscule', 'Statut'],
    ['tiret', 'a-b'],
    ['chiffre', 'a1'],
    ['point', 'a.b'],
    ['espace', 'a b'],
    ['accent', 'état'],
    ['clé vide', ''],
  ])('should refuse a key with a %s (keys are ^[a-z_]+$)', async (_cas, cle) => {
    await refuse({ apres: { [cle]: 'v' } })
  })

  it.each([
    ['sans motif', { motif: undefined }],
    ['motif de 4 caractères', { motif: 'abcd' }],
    ['motif de 4 caractères entouré d\'espaces', { motif: '  abcd  ' }],
    ['motif vide', { motif: '' }],
    ['motif de 501 caractères', { motif: 'a'.repeat(501) }],
    ['action mal formée', { action: 'Compte-Suspendre' }],
    ['type de cible mal formé', { cibleType: 'Utilisateur1' }],
    ['identifiant de cible de 65 caractères', { cibleId: 'x'.repeat(65) }],
    ['IP de 65 caractères', { ip: '1'.repeat(65) }],
    ['IP vide', { ip: '' }],
    ['clé d\'idempotence de 7 caractères', { cleIdempotence: 'abcdefg' }],
    ['champ inconnu (le schéma est strict)', { numero: 42 }],
    ['empreinte fournie par l\'appelant', { empreinte: 'a'.repeat(64) }],
    ['date fournie par l\'appelant', { creeLe: new Date() }],
  ])('should refuse an entry %s and write nothing', async (_cas, surcharges) => {
    await refuse(surcharges)
  })

  it.each([
    ['une adresse e-mail sous une clé neutre', 'marie.ndzi@exemple.test'],
    ['un « @ » isolé', 'a@b'],
    ['un numéro avec espaces', '+237 699 00 00 11'],
    ['un numéro avec tirets', '699-00-00-11-22'],
    ['un numéro avec plus et points', '+237.699.000.011'],
    ['un numéro avec parenthèses', '(237) 699 000 011'],
    ['un numéro collé', '237699000011'],
    ['8 chiffres', '12345678'],
  ])('should refuse %s as a text value and write nothing', async (_cas, valeur) => {
    await refuse({ apres: { reference: valeur } })
    await refuse({ avant: { reference: valeur } })
  })

  it('should accept a value of 7 digits, and identifiers that merely contain digits', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { apres: { reference: '1234567', version: 'v2026-11-14', ordre: 123456789 } })))

    expect(await compterJournal()).toBe(1)
  })

  it('should not repeat the refused value in the error message', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    const erreur = await rejet(db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { apres: { reference: 'secret.visiteur@exemple.test' } }))))

    expect(erreur.message).not.toContain('secret.visiteur')
    expect(erreur.message).not.toContain('exemple.test')
    expect(await compterJournal()).toBe(0)
  })

  it('should accept an entry made only of neutral identifiers and counters', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, {
      avant: { plan: 'gratuit', expire_jours: 0, publiee: false, vitrine_id: null },
      apres: { plan: 'payant', expire_jours: 30, publiee: true, vitrine_id: 'v-1' },
      motif: '  Offre de bienvenue  ',
    })))

    const [ligne] = await lireJournal()
    expect(ligne?.motif).toBe('Offre de bienvenue')
  })

  it('should keep the motive free of the audit blacklist (a motive is not a before/after state)', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { motif: 'Demande du titulaire du compte' })))

    expect(await compterJournal()).toBe(1)
  })

  it('should refuse at the database level a line that bypasses the service (CHECK constraints)', async () => {
    const admin = await creerSuperadmin()
    const inserer = (motif: string, action = 'compte.suspendre') =>
      db.execute(sql`INSERT INTO journal_admin (id, admin_id, action, cible_type, motif, ip) VALUES (${randomUUID()}, ${admin.id}, ${action}, 'utilisateur', ${motif}, ${IP_TEST})`)

    expect(erreurPostgres((await rejet(inserer('abcd'))).brute).sqlstate).toBe(CHECK_VIOLATION)
    expect(erreurPostgres((await rejet(inserer(MOTIF_TEST, 'Mauvaise-Action'))).brute).sqlstate).toBe(CHECK_VIOLATION)
    expect(await compterJournal()).toBe(0)
  })
})

describe('idempotence : même clé, même administrateur (CA21)', () => {
  it('should reject the second write with the same idempotency key for the same admin (unique violation) and keep one line', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()
    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-idempotence-1' })))

    const erreur = await rejet(db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-idempotence-1' }))))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(UNIQUE_VIOLATION)
    expect(erreurPostgres(erreur.brute).contrainte).toBe('journal_admin_idempotence_unique')
    expect(await compterJournal()).toBe(1)
  })

  it('should undo the action of the replayed request together with its refused journal line', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-idempotence-2' })))

    await rejet(db.transaction(async (tx) => {
      await tx.update(users).set({ name: 'Appliqué une seconde fois' }).where(eq(users.id, admin.id))
      await enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-idempotence-2' }))
    }))

    const [relu] = await db.select({ name: users.name }).from(users).where(eq(users.id, admin.id))
    expect(relu?.name).toBe('Nom avant')
    expect(await compterJournal()).toBe(1)
  })

  it('should let two different admins use the same key', async () => {
    const { enregistrer } = await auditService()
    const premier = await creerSuperadmin()
    const second = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(premier.id, { cleIdempotence: 'cle-commune-1' })))
    await db.transaction((tx) => enregistrer(tx, entreeAudit(second.id, { cleIdempotence: 'cle-commune-1' })))

    expect(await compterJournal()).toBe(2)
  })

  it('should let one admin use two different keys', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-numero-1' })))
    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-numero-2' })))

    expect(await compterJournal()).toBe(2)
  })

  it('should not limit the lines without idempotency key', async () => {
    const admin = await creerSuperadmin()

    await journaliser(admin.id)
    await journaliser(admin.id)
    await journaliser(admin.id)

    expect(await compterJournal()).toBe(3)
  })

  it('should not consume a number on a replayed key: the next line follows without a hole', async () => {
    const { enregistrer, verifierChaine } = await auditService()
    const admin = await creerSuperadmin()
    await db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-rejouee-1' })))
    await rejet(db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-rejouee-1' }))))

    const suivante = await journaliser(admin.id)

    expect(suivante.numero).toBe(2)
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should let exactly one of two simultaneous replays win', async () => {
    const { enregistrer } = await auditService()
    const admin = await creerSuperadmin()

    const resultats = await Promise.allSettled([
      db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-concurrente-1' }))),
      db.transaction((tx) => enregistrer(tx, entreeAudit(admin.id, { cleIdempotence: 'cle-concurrente-1' }))),
    ])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(resultats.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(await compterJournal()).toBe(1)
  })

  it('should enforce the uniqueness in the database itself, for a writer that bypasses the service', async () => {
    const admin = await creerSuperadmin()
    const inserer = () =>
      db.execute(sql`INSERT INTO journal_admin (id, admin_id, action, cible_type, motif, ip, cle_idempotence)
        VALUES (${randomUUID()}, ${admin.id}, 'compte.suspendre', 'utilisateur', ${MOTIF_TEST}, ${IP_TEST}, 'cle-sans-service-1')`)
    await inserer()

    const erreur = await rejet(inserer())

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(UNIQUE_VIOLATION)
  })
})
