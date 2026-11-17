import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  compterSessions,
  compterUtilisateurs,
  connecterParCode,
  creerAuth,
  creerSuperadmin,
  creerUtilisateurOrdinaire,
  demanderCodeConnexion,
  demanderCodeTelephone,
  jobsConnexionApresDelai,
  lireCodeEmail,
  lireCodeTelephone,
  ouvrirSession,
  verifierCodeTelephone,
  viderFileMessagesAuth,
} from '../support/admin'
import { expirerCachesProcessus, poserReglage, reinitialiserA4, retablirHorloge } from '../support/admin-a4'

// A4 CA08 (D-A4-09) : inscriptions fermées. Better Auth RÉEL (mêmes options que l'application), base, Redis et file
// `messages-auth` RÉELS (aucun worker : l'absence d'un job prouve qu'aucun code n'a été demandé à l'expéditeur). Un compte
// existant se connecte toujours ; une adresse inconnue ne reçoit rien et la réponse est IDENTIQUE (aucun oracle sur les
// comptes) ; un code obtenu avant la fermeture ne crée pas de compte. Le cache de 5 s de server/auth.config.ts est expiré
// par avance d'horloge (`expirerCachesProcessus`).

let adminId: string

beforeEach(async () => {
  await reinitialiserA4()
  await viderFileMessagesAuth()
  adminId = (await creerSuperadmin()).id
  expirerCachesProcessus()
})

afterAll(retablirHorloge)

async function fermer(): Promise<void> {
  await poserReglage('inscriptions.ouvertes', false, adminId)
  expirerCachesProcessus()
}

describe('inscriptions fermées (CA08)', () => {
  it('should send no code and create no account for an unknown address, answer it like for a known one, and still let an existing account sign in', async () => {
    const auth = await creerAuth()
    const connu = await creerUtilisateurOrdinaire()
    const inconnu = 'inconnu.ferme@exemple.test'
    await fermer()
    const comptes = await compterUtilisateurs()

    const reponseInconnu = await demanderCodeConnexion(auth, inconnu, 'public')
    const reponseConnu = await demanderCodeConnexion(auth, connu.email, 'public')

    expect(reponseInconnu.status).toBe(reponseConnu.status)
    expect(reponseInconnu.corps).toEqual(reponseConnu.corps)
    expect(await jobsConnexionApresDelai(inconnu)).toEqual([])
    expect(await compterUtilisateurs()).toBe(comptes)
    const session = await ouvrirSession(auth, connu.email, 'public')
    expect(session.status).toBe(200)
    expect(session.cookie).not.toBe('')
  })

  it('should create no account from an e-mail code obtained BEFORE the closing, nor from a phone code, and answer neutrally', async () => {
    const auth = await creerAuth()
    const email = 'avant.fermeture@exemple.test'
    const telephone = '+237699000111'
    await demanderCodeConnexion(auth, email, 'public')
    await demanderCodeTelephone(auth, telephone, 'public')
    const codeEmail = await lireCodeEmail(email)
    const codeTel = await lireCodeTelephone(telephone)
    await fermer()
    const comptes = await compterUtilisateurs()

    const parEmail = await connecterParCode(auth, email, codeEmail, 'public')
    const parTelephone = await verifierCodeTelephone(auth, telephone, codeTel, 'public')

    for (const reponse of [parEmail, parTelephone]) {
      expect(reponse.status, JSON.stringify(reponse.corps)).toBeGreaterThanOrEqual(400)
      expect(reponse.cookie).toBe('')
      expect(JSON.stringify(reponse.corps)).not.toMatch(/inconnu|n'existe pas|not found/i)
    }
    expect(await compterUtilisateurs()).toBe(comptes)
    expect(await compterSessions()).toBe(0)
  })

  it('should restore the sign-up without any restart once the inscriptions are reopened (the closed fallback of an unreadable table is proved in a4-reglages)', async () => {
    const auth = await creerAuth()
    const email = 'reouverture@exemple.test'
    await fermer()
    await demanderCodeConnexion(auth, email, 'public')
    expect(await jobsConnexionApresDelai(email)).toEqual([])

    await poserReglage('inscriptions.ouvertes', true, adminId)
    expirerCachesProcessus()
    await demanderCodeConnexion(auth, email, 'public')

    expect(await jobsConnexionApresDelai(email)).toHaveLength(1)
  })
})
