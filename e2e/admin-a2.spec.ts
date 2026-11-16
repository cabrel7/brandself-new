import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { ADMIN_REAUTH_ENTETE, ADMIN_ACTIONS, ADMIN_CIBLES } from '../shared/admin'
import { FILE_MESSAGES_AUTH, JOBS } from '../shared/jobs'
import {
  appeler,
  cookiesDepuis,
  creerCompte,
  creerSuperadmin,
  fermerAdmin,
  libererLimitesOtp,
  nettoyerComptes,
  ouvrirSession,
} from './helpers/admin'
import type { CompteE2E, SessionE2E } from './helpers/admin'
import { BASE_URL, db, lireEnv } from './helpers/session'

// A2 (CA01, CA02, CA04, CA05, CA09), parcours de bout en bout sur le serveur réel (`pnpm dev`, base et Redis de `.env`).
// ÉCRIT, NON EXÉCUTÉ dans ce sprint (serveur de développement non lancé par le testeur). Deux parcours :
//   1. suspension -> la page publique d'un visiteur répond 404 -> réactivation -> la page revient ;
//   2. dépublication par l'administration -> le professionnel voit le bandeau de blocage dans le studio (pas de bouton
//      « Publier ») -> republication.
// La réauthentification lit le VRAI code dans la file `messages-auth` (comme le fait le courrier réel).

const MOTIF_SUSPENSION = 'Usurpation d’identité signalée'
const MOTIF_DEPUBLICATION = 'Contenu contraire aux conditions'
const ATTENTE_JOB_MS = 8_000

interface Pro extends CompteE2E {
  username: string
  vitrineId: string
}

let admin: CompteE2E
let sessionAdmin: SessionE2E
let redis: Redis | undefined
let file: Queue | undefined

const fileAuth = (): Queue => {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  file ??= new Queue(FILE_MESSAGES_AUTH, { connection: redis })
  return file
}

/** Professionnel avec une vitrine publiée (insertion directe : l'état de départ, pas le comportement prouvé). */
async function creerProPublie(): Promise<Pro> {
  const compte = await creerCompte({ nom: 'Professionnel E2E A2' })
  const username = `e2e-admin-a2-${randomUUID().slice(0, 8)}`
  const vitrineId = randomUUID()
  await db().query(
    `INSERT INTO vitrines (id, user_id, username, titre, prenom, nom, metier, ville, pays, publiee_le)
     VALUES ($1, $2, $3, 'dr', 'Cabrel', 'E2E', 'Cardiologue', 'Douala', 'CM', now())`,
    [vitrineId, compte.id, username],
  )
  return { ...compte, username, vitrineId }
}

/** Demande un code de réauthentification (route A1) puis lit le code dans le job mis en file. */
async function codeReauth(action: string, cibleType: string, cibleId: string): Promise<string> {
  const demande = await appeler({ chemin: '/api/admin/reauth/code', cookie: sessionAdmin.cookie, corps: { action, cibleType, cibleId } })
  expect(demande.status, demande.corps).toBe(202)
  const fin = Date.now() + ATTENTE_JOB_MS
  for (;;) {
    const jobs = await fileAuth().getJobs(['wait', 'delayed', 'active', 'prioritized', 'completed', 'failed'], 0, -1)
    const job = jobs.reverse().find((j) => j.name === JOBS.sendAdminReauthEmail && typeof (j.data as { code?: unknown }).code === 'string')
    if (job) return (job.data as { code: string }).code
    if (Date.now() > fin) throw new Error('Aucun job de réauthentification mis en file.')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const post = (chemin: string, corps: unknown, reauth?: string) =>
  appeler({ chemin, cookie: sessionAdmin.cookie, corps, ...(reauth === undefined ? {} : { entetes: { [ADMIN_REAUTH_ENTETE]: reauth } }) })

const pagePublique = (username: string) => appeler({ hote: 'public', methode: 'GET', chemin: `/api/public/${username}` })

test.describe('administration A2 : utilisateurs et vitrines', () => {
  test.beforeAll(async () => {
    await libererLimitesOtp()
    admin = await creerSuperadmin()
    sessionAdmin = await ouvrirSession(admin, 'admin')
  })

  test.afterAll(async () => {
    await db().query("DELETE FROM vitrines WHERE username LIKE 'e2e-admin-a2-%'")
    await nettoyerComptes()
    await file?.close()
    await redis?.quit()
    await fermerAdmin()
  })

  test('CA01 CA02 CA04 : suspension, 404 visiteur, session existante coupée, réactivation', async ({ page }) => {
    const pro = await creerProPublie()
    const sessionPro = await ouvrirSession(pro, 'public')
    expect((await pagePublique(pro.username)).status, 'témoin : la vitrine est publique').toBe(200)

    const sansCode = await post(`/api/admin/utilisateurs/${pro.id}/suspendre`, { motif: MOTIF_SUSPENSION })
    expect(sansCode.status, 'sans code de réauthentification').toBe(403)
    expect((await pagePublique(pro.username)).status).toBe(200)

    const code = await codeReauth(ADMIN_ACTIONS.utilisateurSuspendre, ADMIN_CIBLES.utilisateur, pro.id)
    const suspension = await post(`/api/admin/utilisateurs/${pro.id}/suspendre`, { motif: MOTIF_SUSPENSION }, code)
    expect(suspension.status, suspension.corps).toBe(200)

    // Visiteur : page, créneaux, réservation, message, vue -> 404 ; la vitrine disparaît du sitemap (dans les 10 s du cache).
    expect((await pagePublique(pro.username)).status).toBe(404)
    const message = await appeler({ hote: 'public', chemin: `/api/public/${pro.username}/messages`, corps: { nom: 'Visiteur', email: 'visiteur@exemple.test', sujet: 'autre', message: 'Bonjour' } })
    expect(message.status).toBe(404)
    const vue = await appeler({ hote: 'public', chemin: `/api/public/${pro.username}/vue`, corps: { chemin: `/${pro.username}` } })
    expect(vue.status).toBe(404)
    await expect(async () => {
      const sitemap = await appeler({ hote: 'public', methode: 'GET', chemin: '/api/__sitemap__/vitrines' })
      expect(sitemap.corps).not.toContain(pro.username)
    }).toPass({ timeout: 15_000 })

    // Navigateur : la page publique est une 404 pour le visiteur.
    const reponse = await page.goto(`${BASE_URL}/${pro.username}`)
    expect(reponse?.status()).toBe(404)

    // Session existante du professionnel : refusée (la suspension l'a supprimée).
    const moi = await appeler({ hote: 'public', methode: 'GET', chemin: '/api/studio/moi', cookie: sessionPro.cookie })
    expect(moi.status).toBe(401)

    // Réactivation (motif seul) : tout revient sans autre action.
    const reactivation = await post(`/api/admin/utilisateurs/${pro.id}/reactiver`, { motif: 'Vérification terminée, compte rétabli' })
    expect(reactivation.status, reactivation.corps).toBe(200)
    await expect(async () => {
      expect((await pagePublique(pro.username)).status).toBe(200)
    }).toPass({ timeout: 15_000 })
  })

  test('CA05 : dépublication par l\'administration, bandeau de blocage dans le studio, republication', async ({ context, page }) => {
    const pro = await creerProPublie()
    const sessionPro = await ouvrirSession(pro, 'public')
    await context.addCookies(cookiesDepuis(sessionPro.cookie).map((c) => ({ ...c, url: BASE_URL })))

    const code = await codeReauth(ADMIN_ACTIONS.vitrineDepublier, ADMIN_CIBLES.vitrine, pro.vitrineId)
    const depublication = await post(`/api/admin/vitrines/${pro.vitrineId}/depublier`, { motif: MOTIF_DEPUBLICATION }, code)
    expect(depublication.status, depublication.corps).toBe(200)
    await expect(async () => expect((await pagePublique(pro.username)).status).toBe(404)).toPass({ timeout: 15_000 })

    // Le professionnel ne peut plus publier : la route du studio répond 409 VITRINE_BLOQUEE_ADMIN avec le motif.
    const publier = await appeler({ hote: 'public', chemin: '/api/studio/vitrine/publier', cookie: sessionPro.cookie, corps: {}, origine: undefined })
    expect(publier.status).toBe(409)
    expect(publier.corps).toContain('VITRINE_BLOQUEE_ADMIN')

    // Studio : UN bandeau unique (motif + moyen de contact) remplace le bouton « Publier », désactivé.
    await page.goto(`${BASE_URL}/studio`)
    const bandeau = page.getByRole('alert').filter({ hasText: MOTIF_DEPUBLICATION })
    await expect(bandeau).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Publier/ })).toBeDisabled()

    const republication = await post(`/api/admin/vitrines/${pro.vitrineId}/republier`, { motif: 'Contenu corrigé par le professionnel' })
    expect(republication.status, republication.corps).toBe(200)
    await expect(async () => expect((await pagePublique(pro.username)).status).toBe(200)).toPass({ timeout: 15_000 })
  })

  test('CA09 : la recherche exige 3 caractères et retrouve un compte par son e-mail', async () => {
    const pro = await creerProPublie()

    const courte = await appeler({ methode: 'GET', chemin: '/api/admin/recherche?q=ab', cookie: sessionAdmin.cookie })
    const trouve = await appeler({ methode: 'GET', chemin: `/api/admin/recherche?q=${encodeURIComponent(pro.email)}`, cookie: sessionAdmin.cookie })

    expect(courte.status).toBe(422)
    expect(trouve.status).toBe(200)
    expect(trouve.corps).toContain(pro.id)
  })

  test('hôte public : les routes d\'administration A2 répondent 404, même avec une session d\'administration', async () => {
    const pro = await creerProPublie()

    for (const chemin of ['/api/admin/utilisateurs', `/api/admin/utilisateurs/${pro.id}`, '/api/admin/vitrines', '/api/admin/recherche?q=abc']) {
      const reponse = await appeler({ hote: 'public', methode: 'GET', chemin, cookie: sessionAdmin.cookie })
      expect(reponse.status, chemin).toBe(404)
    }
  })
})

export type { SessionE2E }
