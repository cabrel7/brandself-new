import { expect, test } from '@playwright/test'
import { ADMIN_NAV } from '../shared/admin'
import * as schemasAdmin from '../shared/schemas/admin'
import { CONTRAT } from '../tests/support/admin-contrat'
import type { EntreeContrat } from '../tests/support/admin-contrat'
import {
  ADMIN_HOST,
  HOTE_ADMIN,
  HOTE_PUBLIC,
  ORIGINE_PUBLIC,
  appeler,
  attendreJobConnexion,
  compterUtilisateursParEmail,
  connecterAvecCode,
  creerCompte,
  creerSuperadmin,
  demanderCodeConnexion,
  fermerAdmin,
  jobsConnexionPour,
  libererLimitesOtp,
  lireRole,
  lireSessionsDe,
  nettoyerComptes,
  ouvrirSession,
  vieillirSession,
} from './helpers/admin'
import type { CompteE2E, ReponseAdmin, SessionE2E } from './helpers/admin'
import { db, lireDernierCode } from './helpers/session'

// A1, accès à l'administration par requêtes HTTP BRUTES avec en-tête `Host` (aucun navigateur) :
// CA01 (non connecté / ordinaire / superadmin sur chaque route), CA02 (hôte public), CA03 (surfaces absentes de l'hôte
// admin), CA04 (routes du plugin admin fermées partout), CA05 (aucun envoi pour un non-superadmin), CA06 à CA12
// (sessions), CA20 (429 de la demande de code), CA22 (en-têtes). Le serveur testé est `pnpm dev` ; la base et Redis
// sont ceux de `.env`. Les comptes créés portent le préfixe `e2e-admin-` et sont supprimés en fin de fichier.

const NOT_FOUND = 404
const HUIT_HEURES_MS = 8 * 3_600_000
const ATTENTE_ABSENCE_JOB_MS = 1_500

const routes = Object.entries(CONTRAT) as Array<[string, EntreeContrat]>

let admin: CompteE2E
let sessionAdmin: SessionE2E
let ordinaire: CompteE2E
let sessionOrdinaire: SessionE2E
let adminSurSitePublic: SessionE2E

/** Corps d'une réponse d'erreur, sans le chemin (il est propre à la requête, pas à la cause du refus). */
function corpsDeRefus(reponse: ReponseAdmin): string {
  return reponse.corps
}

// Les tests sont INDÉPENDANTS (aucun ordre implicite) : un échec n'en saute aucun autre. Le `beforeAll` ouvre les
// sessions partagées en LECTURE SEULE ; toute session qu'un test détruit ou modifie est ouverte par ce test.
test.describe('administration : accès, hôtes et sessions', () => {
  test.beforeAll(async () => {
    await libererLimitesOtp()
    admin = await creerSuperadmin()
    sessionAdmin = await ouvrirSession(admin, 'admin')
    ordinaire = await creerCompte()
    // Le compte ordinaire ne peut pas se connecter sur l'hôte admin : sa session est ouverte sur le site public.
    sessionOrdinaire = await ouvrirSession(ordinaire, 'public')
    // Un superadmin qui se connecte sur le site public obtient une session ORDINAIRE (admin = false).
    adminSurSitePublic = await ouvrirSession(await creerSuperadmin(), 'public')
  })

  test.afterAll(async () => {
    await nettoyerComptes()
    await fermerAdmin()
  })

  test.describe('CA01 chaque route /api/admin/** : seul le superadmin passe', () => {
    for (const [fichier, entree] of routes) {
      const titre = `${entree.methode} ${entree.chemin}`
      const appel = (cookie?: string) => appeler({ methode: entree.methode, chemin: entree.chemin, cookie, corps: entree.corps })

      test(`CA01 ${titre} : sans session, 404`, async () => {
        const reponse = await appel()

        expect(reponse.status).toBe(NOT_FOUND)
      })

      test(`CA01 ${titre} : avec un cookie de session inventé, 404`, async () => {
        const reponse = await appel('better-auth.session_token=jeton-invente.signature-inventee')

        expect(reponse.status).toBe(NOT_FOUND)
      })

      test(`CA01 ${titre} : avec la session d'un compte ordinaire, 404`, async () => {
        const reponse = await appel(sessionOrdinaire.cookie)

        expect(reponse.status).toBe(NOT_FOUND)
      })

      test(`CA01 ${titre} : avec la session d'un superadmin ouverte sur le site public, 404`, async () => {
        const reponse = await appel(adminSurSitePublic.cookie)

        expect(reponse.status).toBe(NOT_FOUND)
      })

      test(`CA01 ${titre} : le corps du 404 est identique pour tous les refus`, async () => {
        const reponses = await Promise.all([appel(), appel('better-auth.session_token=x.y'), appel(sessionOrdinaire.cookie), appel(adminSurSitePublic.cookie)])

        expect(new Set(reponses.map(corpsDeRefus)).size).toBe(1)
        expect(reponses[0]?.json).toMatchObject({ statusCode: NOT_FOUND })
      })

      test(`CA01 ${titre} : superadmin sur l'hôte d'administration, ${entree.statutSucces}`, async () => {
        // Une route qui met fin à la session détruit celle qu'on lui présente : elle reçoit la sienne.
        const session = entree.terminaLaSession ? await ouvrirSession(await creerSuperadmin(), 'admin') : sessionAdmin

        const reponse = await appel(session.cookie)

        expect(reponse.status, reponse.corps).toBe(entree.statutSucces)
        if (entree.schema === null) {
          expect(reponse.corps).toBe('')
        } else {
          const schema = (schemasAdmin as Record<string, { parse: (valeur: unknown) => unknown }>)[entree.schema]
          // Schéma STRICT : une clé en trop dans la réponse la ferait échouer.
          expect(() => schema?.parse(reponse.json), `${fichier} : ${reponse.corps}`).not.toThrow()
        }
      })
    }

    test('CA01 la déconnexion supprime la session : le même cookie ne passe plus (404) et la ligne a disparu', async () => {
      const session = await ouvrirSession(await creerSuperadmin(), 'admin')
      expect((await appeler({ chemin: '/api/admin/session', cookie: session.cookie })).status).toBe(200)

      const deconnexion = await appeler({ methode: 'POST', chemin: '/api/admin/deconnexion', cookie: session.cookie, corps: undefined })

      expect(deconnexion.status).toBe(204)
      expect((await appeler({ chemin: '/api/admin/session', cookie: session.cookie })).status).toBe(NOT_FOUND)
      expect(await lireSessionsDe(session.userId)).toHaveLength(0)
    })

    test('CA01 la validation du corps passe APRÈS la garde : un corps invalide donne 404 à un non-admin, 400 au superadmin', async () => {
      const invalide = { action: 'Pas-Une-Action', cibleType: 'user' }

      const anonyme = await appeler({ chemin: '/api/admin/reauth/code', corps: invalide })
      const ordinaireRefuse = await appeler({ chemin: '/api/admin/reauth/code', corps: invalide, cookie: sessionOrdinaire.cookie })
      const superadmin = await appeler({ chemin: '/api/admin/reauth/code', corps: invalide, cookie: sessionAdmin.cookie })

      expect(anonyme.status).toBe(NOT_FOUND)
      expect(ordinaireRefuse.status).toBe(NOT_FOUND)
      expect(superadmin.status).toBe(400)
    })

    test('CA01 une écriture venue d\'une autre origine est refusée (404), même avec une session valide', async () => {
      const reponse = await appeler({ chemin: '/api/admin/reauth/code', corps: { action: 'compte.supprimer', cibleType: 'user' }, cookie: sessionAdmin.cookie, origine: ORIGINE_PUBLIC })

      expect(reponse.status).toBe(NOT_FOUND)
    })

    test('CA01 une route inconnue de /api/admin/ répond 404 aussi au superadmin (rien n\'est inventé)', async () => {
      const reponse = await appeler({ chemin: '/api/admin/inconnue', cookie: sessionAdmin.cookie })

      expect(reponse.status).toBe(NOT_FOUND)
    })
  })

  test.describe('CA02 l\'hôte public ne sert aucune route ni page d\'administration', () => {
    for (const [, entree] of routes) {
      test(`CA02 ${entree.methode} ${entree.chemin} avec une session superadmin valide et Host: ${HOTE_PUBLIC} : 404`, async () => {
        const reponse = await appeler({ methode: entree.methode, chemin: entree.chemin, hote: 'public', cookie: sessionAdmin.cookie, corps: entree.corps })

        expect(reponse.status).toBe(NOT_FOUND)
      })
    }

    for (const chemin of ['/admin', '/admin/', '/admin/connexion', ...ADMIN_NAV.map((e) => e.to), '/ADMIN', '/%61dmin', '//admin', '/x/../admin', '/admin%2fconnexion', '/api/admin', '/api/%61dmin/session', '/API/ADMIN/session']) {
      test(`CA02 GET ${chemin} sur l'hôte public : 404`, async () => {
        const reponse = await appeler({ chemin, hote: 'public', cookie: sessionAdmin.cookie })

        expect(reponse.status).toBe(NOT_FOUND)
      })
    }

    test('CA02 un en-tête X-Forwarded-Host ne fait jamais passer pour l\'hôte d\'administration', async () => {
      const reponse = await appeler({ chemin: '/api/admin/session', hote: 'public', cookie: sessionAdmin.cookie, entetes: { 'x-forwarded-host': HOTE_ADMIN } })

      expect(reponse.status).toBe(NOT_FOUND)
    })

    test('CA02 un hôte qui ressemble à l\'hôte d\'administration n\'en est pas un', async () => {
      for (const hote of [`${ADMIN_HOST}.evil.example`, `evil-${ADMIN_HOST}`, `x${ADMIN_HOST}`]) {
        const reponse = await appeler({ chemin: '/api/admin/session', hote, cookie: sessionAdmin.cookie })
        expect(reponse.status, hote).toBe(NOT_FOUND)
      }
    })

    test('CA02 sans en-tête Host exploitable, l\'administration reste fermée', async () => {
      const reponse = await appeler({ chemin: '/api/admin/session', hote: 'localhost', cookie: sessionAdmin.cookie })

      expect(reponse.status).toBe(NOT_FOUND)
    })

    test('CA02 le site public continue de répondre normalement (témoin : le 404 vient de la séparation, pas d\'un serveur arrêté)', async () => {
      const reponse = await appeler({ chemin: '/api/health', hote: 'public' })

      expect(reponse.status).toBe(200)
    })
  })

  test.describe('CA03 l\'hôte d\'administration ne sert ni le studio, ni les vitrines, ni la PWA, ni le MCP, ni Google', () => {
    const interdits: Array<[string, string]> = [
      ['GET', '/studio'],
      ['GET', '/studio/vitrine'],
      ['GET', '/@dr-cabrel'],
      ['GET', '/dr-cabrel'],
      ['GET', '/connexion'],
      ['GET', '/tarifs'],
      ['GET', '/'],
      ['GET', '/api/studio/moi'],
      ['GET', '/api/studio/vitrine'],
      ['POST', '/api/public/dr-cabrel/vue'],
      ['GET', '/api/public/dr-cabrel'],
      ['GET', '/sw.js'],
      ['GET', '/manifest.json'],
      ['GET', '/mcp'],
      ['POST', '/mcp'],
      ['GET', '/robots.txt'],
      ['GET', '/sitemap.xml'],
      ['GET', '/.well-known/oauth-authorization-server'],
      ['GET', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/phone-number/send-otp'],
      ['POST', '/api/auth/phone-number/verify'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/delete-user'],
      ['GET', '/api/auth/list-sessions'],
      ['GET', '/api/auth/oauth2/authorize'],
      ['GET', '/api/auth/callback/google'],
      ['POST', '/api/auth/email-otp/check-verification-otp'],
      ['POST', '/api/webhooks/kpay'],
      // Traversées et variantes d'écriture : jamais un contournement.
      ['GET', '/admin/../studio'],
      ['GET', '/_nuxt/../studio'],
      ['GET', '/%73tudio'],
      ['GET', '//studio'],
      ['GET', '/./studio'],
      ['GET', '/api/admin/..%2fstudio/moi'],
      ['GET', '/studio%00'],
    ]

    for (const [methode, chemin] of interdits) {
      test(`CA03 ${methode} ${chemin} : 404 sans session`, async () => {
        const reponse = await appeler({ methode, chemin, corps: methode === 'POST' ? {} : undefined })

        expect(reponse.status).toBe(NOT_FOUND)
      })

      test(`CA03 ${methode} ${chemin} : 404 même avec une session superadmin valide`, async () => {
        const reponse = await appeler({ methode, chemin, cookie: sessionAdmin.cookie, corps: methode === 'POST' ? {} : undefined })

        expect(reponse.status).toBe(NOT_FOUND)
      })
    }

    test('CA03 les mêmes chemins répondent bien sur le site public (témoin : le 404 vient de l\'hôte)', async () => {
      for (const chemin of ['/api/health', '/robots.txt', '/manifest.json']) {
        const reponse = await appeler({ chemin, hote: 'public' })
        expect(reponse.status, chemin).not.toBe(NOT_FOUND)
      }
    })

    test('CA03 la liste blanche d\'authentification reste servie : get-session répond 200', async () => {
      const reponse = await appeler({ chemin: '/api/auth/get-session', cookie: sessionAdmin.cookie })

      expect(reponse.status).toBe(200)
      expect((reponse.json as { user?: { id?: string } } | null)?.user?.id).toBe(admin.id)
    })

    test('CA03 la page de connexion de l\'administration est servie', async () => {
      const reponse = await appeler({ chemin: '/admin/connexion', entetes: { accept: 'text/html' } })

      expect(reponse.status).toBe(200)
    })
  })

  test.describe('CA04 les routes du plugin admin de Better Auth sont fermées sur les DEUX hôtes', () => {
    const chemins = [
      '/api/auth/admin/impersonate-user',
      '/api/auth/admin/set-role',
      '/api/auth/admin/stop-impersonating',
      '/api/auth/admin/ban-user',
      '/api/auth/admin/remove-user',
      '/api/auth/admin/create-user',
      '/api/auth/ADMIN/set-role',
      '/api/auth/%61dmin/set-role',
      '/api/auth//admin/set-role',
      '/api/auth/admin%2fset-role',
      '/api/auth/x/../admin/set-role',
    ]

    for (const hote of ['admin', 'public'] as const) {
      for (const chemin of chemins) {
        test(`CA04 POST ${chemin} sur l'hôte ${hote} : 404, même avec une session superadmin`, async () => {
          const sansSession = await appeler({ chemin, hote, corps: { userId: ordinaire.id, role: 'superadmin' } })
          const avecSession = await appeler({ chemin, hote, corps: { userId: ordinaire.id, role: 'superadmin' }, cookie: hote === 'admin' ? sessionAdmin.cookie : adminSurSitePublic.cookie })

          expect(sansSession.status).toBe(NOT_FOUND)
          expect(avecSession.status).toBe(NOT_FOUND)
        })
      }
    }

    test('CA04 aucun rôle n\'a bougé : le compte ordinaire reste ordinaire, le superadmin reste superadmin', async () => {
      expect(await lireRole(ordinaire.id)).toBe('user')
      expect(await lireRole(admin.id)).toBe('superadmin')
    })

    test('CA04 un compte ordinaire ne peut pas se promouvoir par /api/auth/update-user (site public)', async () => {
      await appeler({ chemin: '/api/auth/update-user', hote: 'public', cookie: sessionOrdinaire.cookie, corps: { role: 'superadmin' } })

      expect(await lireRole(ordinaire.id)).toBe('user')
    })
  })

  test.describe('CA05 une adresse qui n\'est pas celle d\'un superadmin ne reçoit AUCUN code sur l\'hôte d\'administration', () => {
    test('CA05 compte ordinaire : 200 { success: true } et aucun job, dans aucun état', async () => {
      await libererLimitesOtp()
      const cible = await creerCompte()

      const reponse = await demanderCodeConnexion(cible.email, 'admin')
      await new Promise((resolve) => setTimeout(resolve, ATTENTE_ABSENCE_JOB_MS))

      expect(reponse.status).toBe(200)
      expect(reponse.json).toEqual({ success: true })
      expect(await jobsConnexionPour(cible.email)).toHaveLength(0)
    })

    test('CA05 adresse inconnue : 200 { success: true } et aucun job, dans aucun état', async () => {
      await libererLimitesOtp()
      const inconnue = `e2e-admin-inconnue-${Date.now()}@exemple.test`

      const reponse = await demanderCodeConnexion(inconnue, 'admin')
      await new Promise((resolve) => setTimeout(resolve, ATTENTE_ABSENCE_JOB_MS))

      expect(reponse.status).toBe(200)
      expect(reponse.json).toEqual({ success: true })
      expect(await jobsConnexionPour(inconnue)).toHaveLength(0)
    })

    test('CA05 superadmin suspendu : 200 et aucun job', async () => {
      await libererLimitesOtp()
      const suspendu = await creerSuperadmin({ suspendu: true })

      const reponse = await demanderCodeConnexion(suspendu.email, 'admin')
      await new Promise((resolve) => setTimeout(resolve, ATTENTE_ABSENCE_JOB_MS))

      expect(reponse.status).toBe(200)
      expect(await jobsConnexionPour(suspendu.email)).toHaveLength(0)
    })

    test('CA05 témoin : le superadmin actif reçoit bien son code (un job est mis en file)', async () => {
      await libererLimitesOtp()
      const actif = await creerSuperadmin()

      const reponse = await demanderCodeConnexion(actif.email, 'admin')

      expect(reponse.status).toBe(200)
      expect(reponse.json).toEqual({ success: true })
      expect((await attendreJobConnexion(actif.email)).length).toBeGreaterThan(0)
    })

    test('CA05 témoin : le même compte ordinaire reçoit son code sur le site public', async () => {
      await libererLimitesOtp()
      const cible = await creerCompte()

      const reponse = await demanderCodeConnexion(cible.email, 'public')

      expect(reponse.status).toBe(200)
      expect((await attendreJobConnexion(cible.email)).length).toBeGreaterThan(0)
    })

    test('CA05 la réponse est la même pour un superadmin, un compte ordinaire et une adresse inconnue (aucun oracle)', async () => {
      await libererLimitesOtp()
      const reponses = await Promise.all([
        demanderCodeConnexion((await creerSuperadmin()).email, 'admin'),
        demanderCodeConnexion((await creerCompte()).email, 'admin'),
        demanderCodeConnexion(`e2e-admin-personne-${Date.now()}@exemple.test`, 'admin'),
      ])

      expect(new Set(reponses.map((r) => `${r.status} ${r.corps}`)).size).toBe(1)
    })
  })

  test.describe('CA06 à CA12 sessions de l\'administration', () => {
    test('CA06 le code valide d\'un compte ordinaire, obtenu sur le site public, est refusé (403) sur l\'hôte d\'administration', async () => {
      await libererLimitesOtp()
      const cible = await creerCompte()
      await demanderCodeConnexion(cible.email, 'public')
      const code = await lireDernierCode(cible.email)

      const reponse = await connecterAvecCode(cible.email, code, 'admin')

      expect(reponse.status).toBe(403)
      expect(reponse.setCookie.some((c) => /session_token=[^;]/.test(c))).toBe(false)
      expect(await lireSessionsDe(cible.id)).toHaveLength(0)
    })

    test('CA07 une adresse inconnue avec un code valide ne crée aucun compte sur l\'hôte d\'administration', async () => {
      await libererLimitesOtp()
      const inconnue = `e2e-admin-nouvelle-${Date.now()}@exemple.test`
      await demanderCodeConnexion(inconnue, 'public')
      const code = await lireDernierCode(inconnue)

      const reponse = await connecterAvecCode(inconnue, code, 'admin')

      expect(reponse.status).toBe(403)
      expect(await compterUtilisateursParEmail(inconnue)).toBe(0)
    })

    test('CA08 la session du superadmin est marquée admin, dure 8 heures au plus, et son cookie n\'a pas d\'attribut Domain', async () => {
      const [session] = await lireSessionsDe(sessionAdmin.userId)

      expect(session?.admin).toBe(true)
      expect(session!.expires_at.getTime()).toBeLessThanOrEqual(session!.created_at.getTime() + HUIT_HEURES_MS)
      expect(session!.expires_at.getTime()).toBeGreaterThan(session!.created_at.getTime() + HUIT_HEURES_MS - 5 * 60_000)
      const cookiesSession = sessionAdmin.connexion.setCookie.filter((c) => /session_token=/.test(c))
      expect(cookiesSession.length).toBeGreaterThan(0)
      for (const cookie of sessionAdmin.connexion.setCookie) expect(cookie).not.toMatch(/;\s*domain=/i)
      for (const cookie of cookiesSession) expect(cookie).toMatch(/httponly/i)
    })

    test('CA08 la session ouverte par ce même superadmin sur le site public n\'est PAS une session d\'administration', async () => {
      const [session] = await lireSessionsDe(adminSurSitePublic.userId)

      expect(session?.admin).toBe(false)
      for (const cookie of adminSurSitePublic.connexion.setCookie) expect(cookie).not.toMatch(/;\s*domain=/i)
    })

    test('CA10 get-session ne prolonge pas la session d\'administration au-delà de created_at + 8 h', async () => {
      const avant = (await lireSessionsDe(sessionAdmin.userId))[0]!
      await new Promise((resolve) => setTimeout(resolve, 50))

      const reponse = await appeler({ chemin: '/api/auth/get-session', cookie: sessionAdmin.cookie })

      expect(reponse.status).toBe(200)
      const apres = (await lireSessionsDe(sessionAdmin.userId))[0]!
      expect(apres.expires_at.getTime()).toBeLessThanOrEqual(apres.created_at.getTime() + HUIT_HEURES_MS)
      expect(apres.created_at.getTime()).toBe(avant.created_at.getTime())
    })

    test('CA09 une session créée il y a 8 h 01 ne donne plus accès (404) et sa ligne est supprimée', async () => {
      const vieux = await ouvrirSession(await creerSuperadmin(), 'admin')
      const controle = await appeler({ chemin: '/api/admin/session', cookie: vieux.cookie })
      expect(controle.status).toBe(200)
      await vieillirSession(vieux.sessionId, 8 + 1 / 60)

      const reponse = await appeler({ chemin: '/api/admin/session', cookie: vieux.cookie })

      expect(reponse.status).toBe(NOT_FOUND)
      expect(await lireSessionsDe(vieux.userId)).toHaveLength(0)
    })

    test('CA09 une session de 7 h 59 passe encore', async () => {
      const jeune = await ouvrirSession(await creerSuperadmin(), 'admin')
      await vieillirSession(jeune.sessionId, 8 - 1 / 60)

      const reponse = await appeler({ chemin: '/api/admin/session', cookie: jeune.cookie })

      expect(reponse.status).toBe(200)
    })

    test('CA11 un compte suspendu n\'obtient aucune session par code e-mail : 403 BANNED_USER', async () => {
      await libererLimitesOtp()
      const suspendu = await creerCompte({ suspendu: true })
      await demanderCodeConnexion(suspendu.email, 'public')
      const code = await lireDernierCode(suspendu.email)

      const reponse = await connecterAvecCode(suspendu.email, code, 'public')

      expect(reponse.status).toBe(403)
      expect((reponse.json as { code?: string } | null)?.code).toBe('BANNED_USER')
      expect(await lireSessionsDe(suspendu.id)).toHaveLength(0)
    })

    test('CA11 un superadmin suspendu depuis l\'ouverture de sa session perd l\'accès immédiatement (404)', async () => {
      const compte = await creerSuperadmin()
      const session = await ouvrirSession(compte, 'admin')
      expect((await appeler({ chemin: '/api/admin/session', cookie: session.cookie })).status).toBe(200)

      await db().query('UPDATE users SET suspendu = true WHERE id = $1', [compte.id])

      expect((await appeler({ chemin: '/api/admin/session', cookie: session.cookie })).status).toBe(NOT_FOUND)
    })

    test('CA12 le cookie d\'une session de superadmin ouverte sur le site public ne vaut rien sur l\'hôte d\'administration (404)', async () => {
      const reponse = await appeler({ chemin: '/api/admin/session', cookie: adminSurSitePublic.cookie })

      expect(reponse.status).toBe(NOT_FOUND)
    })

    test('CA12 un superadmin qui a perdu son rôle depuis l\'ouverture de sa session perd l\'accès (404)', async () => {
      const compte = await creerSuperadmin()
      const session = await ouvrirSession(compte, 'admin')
      await db().query("UPDATE users SET role = 'user' WHERE id = $1", [compte.id])

      expect((await appeler({ chemin: '/api/admin/session', cookie: session.cookie })).status).toBe(NOT_FOUND)
    })
  })

  test.describe('CA20 demande de code de réauthentification : 5 par 15 minutes, puis 429', () => {
    test('CA20 la sixième demande est refusée (429) ; les cinq premières répondent 202 { expireLe }', async () => {
      const limite = await ouvrirSession(await creerSuperadmin(), 'admin')
      const demander = (i: number) => appeler({ chemin: '/api/admin/reauth/code', cookie: limite.cookie, corps: { action: 'compte.supprimer', cibleType: 'user', cibleId: `cible-${i}` } })

      const acceptees: ReponseAdmin[] = []
      for (let i = 0; i < 5; i += 1) acceptees.push(await demander(i))
      const refusee = await demander(5)

      for (const reponse of acceptees) {
        expect(reponse.status, reponse.corps).toBe(202)
        expect(Object.keys(reponse.json as object)).toEqual(['expireLe'])
      }
      expect(refusee.status).toBe(429)
      expect(refusee.headers['retry-after']).toBeDefined()
    })

    test('CA20 le budget est propre à chaque administrateur', async () => {
      const autre = await ouvrirSession(await creerSuperadmin(), 'admin')

      const reponse = await appeler({ chemin: '/api/admin/reauth/code', cookie: autre.cookie, corps: { action: 'compte.supprimer', cibleType: 'user' } })

      expect(reponse.status).toBe(202)
    })

    test('CA20 la réponse ne contient jamais le code', async () => {
      const compte = await ouvrirSession(await creerSuperadmin(), 'admin')

      const reponse = await appeler({ chemin: '/api/admin/reauth/code', cookie: compte.cookie, corps: { action: 'compte.supprimer', cibleType: 'user' } })

      expect(reponse.corps).not.toMatch(/\d{6}/)
      expect(reponse.json).not.toHaveProperty('code')
    })
  })

  test.describe('CA22 en-têtes de l\'hôte d\'administration', () => {
    test('CA22 les pages /admin/* répondent noindex et no-store', async () => {
      for (const entree of ADMIN_NAV) {
        const reponse = await appeler({ chemin: entree.to, cookie: sessionAdmin.cookie, entetes: { accept: 'text/html' } })

        expect(reponse.status, entree.to).toBe(200)
        expect(String(reponse.headers['x-robots-tag']), entree.to).toMatch(/noindex/)
        expect(String(reponse.headers['cache-control']), entree.to).toMatch(/no-store/)
      }
    })

    test('CA22 la page de connexion répond noindex et no-store', async () => {
      const reponse = await appeler({ chemin: '/admin/connexion', entetes: { accept: 'text/html' } })

      expect(reponse.status).toBe(200)
      expect(String(reponse.headers['x-robots-tag'])).toMatch(/noindex/)
      expect(String(reponse.headers['cache-control'])).toMatch(/no-store/)
    })

    test('CA22 les réponses de l\'API d\'administration portent no-store, noindex, no-referrer et X-Frame-Options DENY', async () => {
      const reponse = await appeler({ chemin: '/api/admin/session', cookie: sessionAdmin.cookie })

      expect(String(reponse.headers['cache-control'])).toMatch(/no-store/)
      expect(String(reponse.headers['x-robots-tag'])).toMatch(/noindex/)
      expect(String(reponse.headers['referrer-policy'])).toBe('no-referrer')
      expect(String(reponse.headers['x-frame-options']).toUpperCase()).toBe('DENY')
    })

    test('CA22 les refus de l\'hôte d\'administration (404) ne sont ni indexables ni mis en cache', async () => {
      const reponse = await appeler({ chemin: '/studio' })

      expect(reponse.status).toBe(NOT_FOUND)
      expect(String(reponse.headers['x-robots-tag'])).toMatch(/noindex/)
      expect(String(reponse.headers['cache-control'])).toMatch(/no-store/)
    })

    test('CA22 la connexion sur l\'hôte d\'administration ne pose jamais de cookie partagé avec le domaine parent', async () => {
      for (const session of [sessionAdmin, sessionOrdinaire, adminSurSitePublic]) {
        for (const cookie of session.connexion.setCookie) expect(cookie).not.toMatch(/;\s*domain=/i)
      }
    })
  })
})
