import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { sessions, users } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import {
  auditService,
  compterJournal,
  creerSessionAdmin,
  creerSuperadmin,
  creerUtilisateurOrdinaire,
  creerUtilisateurSuspendu,
  etatDeclencheurs,
  lireJournal,
  lireSessions,
  lignesReauth,
  sansDeclencheur,
  superadminService,
} from '../support/admin'
import { rejet } from '../support/erreurs'

// A1 CA24 : `pnpm admin:creer <adresse>` et `pnpm admin:reinitialiser <adresse>`. Les scripts sont LANCÉS pour de
// vrai (processus `tsx`, base de test réelle, comme `pnpm admin:creer` : même interpréteur et mêmes fichiers) ;
// seule différence avec `pnpm` : les variables viennent de l'environnement du test et non de `.env`.

const execFileAsync = promisify(execFile)
const RACINE = path.resolve(import.meta.dirname, '../../..')
const TSX = path.join(RACINE, 'node_modules/tsx/dist/cli.mjs')
const DELAI_PROCESSUS_MS = 90_000
/** Un test peut lancer deux processus à la suite. */
const DELAI_TEST_MS = 2 * DELAI_PROCESSUS_MS

interface SortieScript {
  code: number
  stdout: string
  stderr: string
}

async function lancer(script: 'admin-creer' | 'admin-reinitialiser', ...args: string[]): Promise<SortieScript> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [TSX, path.join(RACINE, `scripts/${script}.ts`), ...args], {
      cwd: RACINE,
      env: { ...process.env },
      timeout: DELAI_PROCESSUS_MS,
    })
    return { code: 0, stdout, stderr }
  } catch (erreur) {
    const e = erreur as { code?: number | string, stdout?: string, stderr?: string }
    return { code: typeof e.code === 'number' ? e.code : -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

async function utilisateurPar(email: string) {
  const [ligne] = await db.select().from(users).where(eq(users.email, email))
  return ligne
}

describe('package.json : les commandes existent et lancent les scripts', () => {
  const pkg = JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }

  it('should declare admin:creer and admin:reinitialiser like db:seed (tsx, .env)', () => {
    expect(pkg.scripts['admin:creer']).toMatch(/tsx.*scripts\/admin-creer\.ts/)
    expect(pkg.scripts['admin:reinitialiser']).toMatch(/tsx.*scripts\/admin-reinitialiser\.ts/)
    expect(pkg.scripts['admin:creer']).toContain('--env-file=.env')
    expect(pkg.scripts['admin:reinitialiser']).toContain('--env-file=.env')
  })

  it('should have the two script files', () => {
    expect(existsSync(path.join(RACINE, 'scripts/admin-creer.ts'))).toBe(true)
    expect(existsSync(path.join(RACINE, 'scripts/admin-reinitialiser.ts'))).toBe(true)
  })
})

describe('pnpm admin:creer (CA24)', { timeout: DELAI_TEST_MS }, () => {
  it('should create a superadmin account (verified address, role superadmin) and journal superadmin.creer', async () => {
    const sortie = await lancer('admin-creer', 'nouvel-admin@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    const compte = await utilisateurPar('nouvel-admin@exemple.test')
    expect(compte).toMatchObject({ role: 'superadmin', emailVerified: true, banned: false })
    const journal = await lireJournal()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      admin_id: compte?.id,
      action: ADMIN_ACTIONS.superadminCreer,
      cible_type: 'utilisateur',
      cible_id: compte?.id,
      motif: 'commande serveur',
      ip: 'cli',
      avant: { role: null },
      apres: { role: 'superadmin' },
    })
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should promote an existing ordinary account without creating a second one, and keep its identity', async () => {
    const existant = await creerUtilisateurOrdinaire({ email: 'deja-la@exemple.test', name: 'Nom conservé', emailVerified: false })

    const sortie = await lancer('admin-creer', 'deja-la@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await db.select().from(users).where(eq(users.email, 'deja-la@exemple.test'))).toHaveLength(1)
    const compte = await utilisateurPar('deja-la@exemple.test')
    expect(compte).toMatchObject({ id: existant.id, role: 'superadmin', name: 'Nom conservé', emailVerified: true })
    expect((await lireJournal())[0]).toMatchObject({ avant: { role: 'user' }, apres: { role: 'superadmin' } })
  })

  it('should store the address in lowercase (as Better Auth does), so that the sign-in finds the account', async () => {
    const sortie = await lancer('admin-creer', 'Admin.Majuscules@Exemple.TEST')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await utilisateurPar('admin.majuscules@exemple.test')).toMatchObject({ role: 'superadmin' })
  })

  it('should be replayable: a second run changes nothing but adds its own journal line, and the chain stays intact', async () => {
    await lancer('admin-creer', 'rejoue@exemple.test')
    const sortie = await lancer('admin-creer', 'rejoue@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await db.select().from(users).where(eq(users.email, 'rejoue@exemple.test'))).toHaveLength(1)
    expect((await lireJournal()).map((l) => Number(l.numero))).toEqual([1, 2])
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should accept a second superadmin of rescue, with no limit on their number', async () => {
    await lancer('admin-creer', 'premier-admin@exemple.test')
    const sortie = await lancer('admin-creer', 'second-admin@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await db.select().from(users).where(eq(users.role, 'superadmin'))).toHaveLength(2)
  })

  it('should not lift a suspension (that is the job of admin:reinitialiser)', async () => {
    const suspendu = await creerUtilisateurSuspendu({ email: 'suspendu-promu@exemple.test' })

    await lancer('admin-creer', 'suspendu-promu@exemple.test')

    expect(await utilisateurPar('suspendu-promu@exemple.test')).toMatchObject({ id: suspendu.id, role: 'superadmin', banned: true })
  })

  it.each([
    ['sans argument', []],
    ['avec une adresse invalide', ['pas-une-adresse']],
    ['avec une adresse sans domaine', ['quelquun@']],
    ['avec deux arguments', ['a@exemple.test', 'b@exemple.test']],
    ['avec une adresse vide', ['']],
  ])('should exit with an error and the usage when run %s, creating nothing', async (_cas, args) => {
    const sortie = await lancer('admin-creer', ...args)

    expect(sortie.code).toBe(1)
    expect(sortie.stderr).toMatch(/Usage : pnpm admin:creer/)
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await compterJournal()).toBe(0)
  })
})

describe('pnpm admin:reinitialiser (CA24)', { timeout: DELAI_TEST_MS }, () => {
  it('should lift the suspension, delete the sessions and the open codes, and journal superadmin.reinitialiser', async () => {
    const admin = await creerSuperadmin({ email: 'recuperation@exemple.test', banned: true, banReason: 'suspension de test', banExpires: new Date(Date.now() + 3_600_000) })
    await creerSessionAdmin(admin.id)
    await creerSessionAdmin(admin.id, { admin: false })
    const autre = await creerSuperadmin()
    await creerSessionAdmin(autre.id)
    await db.execute(sql`INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le)
      VALUES ('reauth-ouverte', ${admin.id}, 'compte.supprimer', 'utilisateur', ${'a'.repeat(64)}, now() + interval '5 minutes')`)

    const sortie = await lancer('admin-reinitialiser', 'recuperation@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await utilisateurPar('recuperation@exemple.test')).toMatchObject({ role: 'superadmin', banned: false, banReason: null, banExpires: null })
    expect(await lireSessions(admin.id)).toHaveLength(0)
    expect(await lignesReauth(admin.id)).toHaveLength(0)
    // Les sessions d'un AUTRE compte ne sont pas touchées.
    expect(await lireSessions(autre.id)).toHaveLength(1)
    const journal = await lireJournal()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      admin_id: admin.id,
      action: ADMIN_ACTIONS.superadminReinitialiser,
      cible_type: 'utilisateur',
      cible_id: admin.id,
      motif: 'commande serveur',
      ip: 'cli',
      avant: { role: 'superadmin', suspendu: true },
      apres: { role: 'superadmin', suspendu: false },
    })
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should keep a code that was already consumed (the history of what was confirmed is not erased)', async () => {
    const admin = await creerSuperadmin({ email: 'recup-historique@exemple.test' })
    await db.execute(sql`INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le, consomme_le)
      VALUES ('reauth-consommee', ${admin.id}, 'compte.supprimer', 'utilisateur', ${'b'.repeat(64)}, now() + interval '5 minutes', now())`)

    await lancer('admin-reinitialiser', 'recup-historique@exemple.test')

    expect((await lignesReauth(admin.id)).map((l) => l.id)).toEqual(['reauth-consommee'])
  })

  it('should leave an account that is not suspended and has no session in a clean state, and journal it too', async () => {
    const admin = await creerSuperadmin({ email: 'sans-souci@exemple.test' })

    const sortie = await lancer('admin-reinitialiser', 'sans-souci@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect((await lireJournal())[0]).toMatchObject({ admin_id: admin.id, avant: { role: 'superadmin', suspendu: false } })
  })

  it('should fail for an unknown address, create nothing, journal nothing and not echo the address', async () => {
    const sortie = await lancer('admin-reinitialiser', 'personne-ici@exemple.test')

    expect(sortie.code).toBe(1)
    expect(sortie.stderr).toMatch(/Aucun superadmin avec cette adresse/)
    expect(sortie.stderr).not.toContain('personne-ici@exemple.test')
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await compterJournal()).toBe(0)
  })

  it('should NOT promote an ordinary account: non-zero exit, dedicated message, account, sessions and journal untouched', async () => {
    const ordinaire = await creerUtilisateurOrdinaire({ email: 'ordinaire-reset@exemple.test' })
    await creerSessionAdmin(ordinaire.id, { admin: false })

    const sortie = await lancer('admin-reinitialiser', 'ordinaire-reset@exemple.test')

    expect(sortie.code).toBe(1)
    expect(sortie.stderr).toMatch(/Aucun superadmin avec cette adresse/)
    expect(sortie.stderr).not.toContain('ordinaire-reset@exemple.test')
    expect(await utilisateurPar('ordinaire-reset@exemple.test')).toMatchObject({ role: 'user', banned: false })
    expect(await lireSessions(ordinaire.id)).toHaveLength(1)
    expect(await compterJournal()).toBe(0)
  })

  it('should lift the suspension of a suspended superadmin, drop sessions and open codes, and add exactly one journal line', async () => {
    const admin = await creerSuperadmin({ email: 'suspendu-reset@exemple.test', banned: true, banReason: 'suspension de test' })
    await creerSessionAdmin(admin.id)
    await db.execute(sql`INSERT INTO admin_reauth (id, admin_id, action, cible_type, code_empreinte, expire_le)
      VALUES ('reauth-suspendu', ${admin.id}, 'compte.supprimer', 'utilisateur', ${'c'.repeat(64)}, now() + interval '5 minutes')`)

    const sortie = await lancer('admin-reinitialiser', 'suspendu-reset@exemple.test')

    expect(sortie.code, sortie.stderr).toBe(0)
    expect(await utilisateurPar('suspendu-reset@exemple.test')).toMatchObject({ role: 'superadmin', banned: false, banReason: null })
    expect(await lireSessions(admin.id)).toHaveLength(0)
    expect(await lignesReauth(admin.id)).toHaveLength(0)
    expect(await lireJournal()).toHaveLength(1)
  })

  it.each([
    ['sans argument', []],
    ['avec une adresse invalide', ['pas-une-adresse']],
    ['avec deux arguments', ['a@exemple.test', 'b@exemple.test']],
  ])('should exit with an error and the usage when run %s', async (_cas, args) => {
    const sortie = await lancer('admin-reinitialiser', ...args)

    expect(sortie.code).toBe(1)
    expect(sortie.stderr).toMatch(/Usage : pnpm admin:reinitialiser/)
  })
})

describe('une seule transaction par commande (service appelé par les scripts)', () => {
  it('should create no account and no journal line when the journal write fails (account and trail are atomic)', async () => {
    const { creerSuperadmin: creer } = await superadminService()

    // Sans le déclencheur de chaînage, `numero` garde sa valeur de repli 0 : la contrainte CHECK refuse la ligne.
    const erreur = await sansDeclencheur('journal_admin_chainer', () => rejet(creer('atomique@exemple.test')))

    expect(erreur.brute).toBeDefined()
    expect(await utilisateurPar('atomique@exemple.test')).toBeUndefined()
    expect(await compterJournal()).toBe(0)
    expect((await etatDeclencheurs()).journal_admin_chainer).toBe('O')
  })

  it('should promote no account and drop no session when the journal write fails (reset is atomic)', async () => {
    const { reinitialiserSuperadmin } = await superadminService()
    const admin = await creerSuperadmin({ email: 'atomique-reset@exemple.test', banned: true })
    await creerSessionAdmin(admin.id)

    await sansDeclencheur('journal_admin_chainer', () => rejet(reinitialiserSuperadmin('atomique-reset@exemple.test')))

    expect(await utilisateurPar('atomique-reset@exemple.test')).toMatchObject({ banned: true })
    expect(await lireSessions(admin.id)).toHaveLength(1)
    expect(await compterJournal()).toBe(0)
  })

  it('should leave every session alone, and raise the dedicated error, when the address is unknown or not a superadmin', async () => {
    const { reinitialiserSuperadmin, CompteIntrouvableError } = await superadminService()
    const ordinaire = await creerUtilisateurOrdinaire()
    await db.insert(sessions).values({ id: 'session-ordinaire', userId: ordinaire.id, token: 'jeton-ordinaire', expiresAt: new Date(Date.now() + 3_600_000) })

    const erreur = await rejet(reinitialiserSuperadmin('inexistant@exemple.test'))

    expect(erreur.brute).toBeInstanceOf(CompteIntrouvableError)
    expect(await lireSessions(ordinaire.id)).toHaveLength(1)
  })
})
