import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_REAUTH_ESSAIS, ADMIN_REAUTH_LIMITE, ADMIN_REAUTH_TTL_S } from '../../../shared/admin'
import { JOBS } from '../../../shared/jobs'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import {
  autreCode,
  creerSuperadmin,
  demanderEtLireCode,
  fileMessagesAuth,
  gardeReauth,
  lignesReauth,
  reauthService,
  tousLesJobs,
  viderFileMessagesAuth,
} from '../support/admin'
import { erreurPostgres, rejet } from '../support/erreurs'
import { fakeEvent } from '../../support/h3'
import { ADMIN_REAUTH_TENTATIVES_LIMITE } from '../../../server/utils/reauth'

// A1, réauthentification d'une action destructrice (CA18, CA19, CA20), sur base RÉELLE et file BullMQ RÉELLE :
// le code n'est stocké qu'en empreinte, le test le lit dans le job `send-admin-reauth-email` mis en file.
// D-A1-11 : A1 n'a pas d'action destructrice ; la preuve est faite sur le service et l'utilitaire `exigerReauth`
// appelés DANS la transaction d'une action fictive. La première preuve HTTP viendra avec A2.

const PREUVE = { action: 'compte.supprimer', cibleType: 'utilisateur', cibleId: 'cible-A' } as const

beforeEach(async () => {
  await viderFileMessagesAuth()
  // Les compteurs de limitation sont nettoyés par setup.ts (`limite:*`) ; ceux de l'administration le sont aussi.
  const cles = await redis.keys('*admin-reauth:*')
  if (cles.length > 0) await redis.del(...cles)
})

/** Une « action destructrice » : consomme la preuve dans SA transaction puis écrit quelque chose (ici, un drapeau). */
async function actionDestructrice(adminId: string, code: string | null, preuve: { action: string, cibleType: string, cibleId?: string | null } = PREUVE) {
  const { exigerReauth } = await gardeReauth()
  const event = fakeEvent({ method: 'DELETE', url: '/api/admin/x', headers: code === null ? {} : { 'x-admin-reauth': code } })
  return db.transaction(async (tx) => {
    await exigerReauth(event, tx, adminId, preuve)
    await tx.execute(sql`UPDATE users SET name = 'Action appliquée' WHERE id = ${adminId}`)
  })
}

async function nomDe(userId: string): Promise<string> {
  const resultat = await db.execute<{ name: string }>(sql`SELECT name FROM users WHERE id = ${userId}`)
  return resultat.rows[0]?.name ?? ''
}

describe('action destructrice : sans code, avec code valide, code rejoué (CA18)', () => {
  it('should refuse an action without any code: 403 REAUTH_REQUISE, nothing applied', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })

    const erreur = await rejet(actionDestructrice(admin.id, null))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'REAUTH_REQUISE', status: 403 })
    expect(await nomDe(admin.id)).toBe('Nom avant')
  })

  it.each([[''], ['   ']])('should treat an empty header (%j) as no code at all', async (valeur) => {
    const admin = await creerSuperadmin()

    expect(await rejet(actionDestructrice(admin.id, valeur))).toMatchObject({ code: 'REAUTH_REQUISE', status: 403 })
  })

  it('should let the action through with a valid code and mark the code as consumed', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    await actionDestructrice(admin.id, code)

    expect(await nomDe(admin.id)).toBe('Action appliquée')
    const ligne = (await lignesReauth(admin.id)).find((l) => l.id === reauthId)
    expect(ligne?.consomme_le).toBeInstanceOf(Date)
    expect(ligne?.consomme_le?.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('should refuse the SAME code replayed: 403 REAUTH_INVALIDE, the second action is not applied', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code } = await demanderEtLireCode(admin.id, PREUVE)
    await actionDestructrice(admin.id, code)
    await db.execute(sql`UPDATE users SET name = 'Nom réinitialisé' WHERE id = ${admin.id}`)

    const erreur = await rejet(actionDestructrice(admin.id, code))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'REAUTH_INVALIDE', status: 403 })
    expect(await nomDe(admin.id)).toBe('Nom réinitialisé')
  })

  it('should answer a wrong code with REAUTH_INVALIDE (never REAUTH_REQUISE) and apply nothing', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    const erreur = await rejet(actionDestructrice(admin.id, autreCode(code)))

    expect(erreur).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
    expect(await nomDe(admin.id)).toBe('Nom avant')
  })

  it.each([['abc'], ['12345'], ['1234567'], ['12 456'], ['１２３４５６'], ['12345a']])('should refuse the malformed code %j as invalid', async (code) => {
    const admin = await creerSuperadmin()
    await demanderEtLireCode(admin.id, PREUVE)

    expect(await rejet(actionDestructrice(admin.id, code))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
  })

  it('should refuse a code that was never requested for this administrator', async () => {
    const admin = await creerSuperadmin()

    expect(await rejet(actionDestructrice(admin.id, '123456'))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
  })

  it('should refuse the code of another administrator for the same action and target', async () => {
    const premier = await creerSuperadmin()
    const second = await creerSuperadmin()
    const { code } = await demanderEtLireCode(premier.id, PREUVE)
    await demanderEtLireCode(second.id, PREUVE)

    const erreur = await rejet(actionDestructrice(second.id, code))

    expect(erreur).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
    // Le code du premier reste utilisable par lui.
    await expect(actionDestructrice(premier.id, code)).resolves.toBeUndefined()
  })

  it('should keep the code usable when the action fails AFTER the code was checked (consumed inside the action transaction)', async () => {
    const { exigerReauth } = await gardeReauth()
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    const event = fakeEvent({ headers: { 'x-admin-reauth': code } })

    await rejet(db.transaction(async (tx) => {
      await exigerReauth(event, tx, admin.id, PREUVE)
      await tx.execute(sql`UPDATE users SET name = 'Appliqué' WHERE id = ${admin.id}`)
      throw new Error('ECHEC_DE_L_ACTION')
    }))

    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)?.consomme_le).toBeNull()
    expect(await nomDe(admin.id)).toBe('Nom avant')
    await expect(actionDestructrice(admin.id, code)).resolves.toBeUndefined()
    expect(await nomDe(admin.id)).toBe('Action appliquée')
  })

  it('should let exactly ONE of two simultaneous actions use the same code', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    const resultats = await Promise.allSettled([actionDestructrice(admin.id, code), actionDestructrice(admin.id, code)])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refuses = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(refuses).toHaveLength(1)
    expect((await rejet(Promise.reject(refuses[0]!.reason))).code).toBe('REAUTH_INVALIDE')
    expect((await lignesReauth(admin.id)).filter((l) => l.consomme_le !== null)).toHaveLength(1)
  })

  it('should refuse an expired code, even the right one', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    await db.execute(sql`UPDATE admin_reauth SET expire_le = now() - interval '1 second' WHERE id = ${reauthId}`)

    expect(await rejet(actionDestructrice(admin.id, code))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
  })

  it('should still accept a code one minute before its expiry', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    await db.execute(sql`UPDATE admin_reauth SET expire_le = now() + interval '1 minute' WHERE id = ${reauthId}`)

    await expect(actionDestructrice(admin.id, code)).resolves.toBeUndefined()
  })
})

describe('demande d\'un code : ce qui est écrit, ce qui est envoyé', () => {
  it('should answer with an expiry 10 minutes ahead and write the same date in the database', async () => {
    const admin = await creerSuperadmin()
    const avant = Date.now()

    const { expireLe, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    expect(ADMIN_REAUTH_TTL_S).toBe(600)
    expect(expireLe.getTime()).toBeGreaterThanOrEqual(avant + ADMIN_REAUTH_TTL_S * 1000 - 5_000)
    expect(expireLe.getTime()).toBeLessThanOrEqual(Date.now() + ADMIN_REAUTH_TTL_S * 1000 + 5_000)
    const ligne = (await lignesReauth(admin.id)).find((l) => l.id === reauthId)
    expect(ligne?.expire_le.getTime()).toBe(expireLe.getTime())
  })

  it('should store only a 64-hex fingerprint of the code: the clear code appears in no column', async () => {
    const admin = await creerSuperadmin()

    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    const ligne = (await lignesReauth(admin.id)).find((l) => l.id === reauthId)!
    expect(ligne.code_empreinte).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.values(ligne).map(String)).not.toContain(code)
    expect(ligne.code_empreinte).not.toContain(code)
    expect(ligne).toMatchObject({ action: PREUVE.action, cible_type: PREUVE.cibleType, cible_id: PREUVE.cibleId, essais: 0, consomme_le: null })
  })

  it('should generate six-digit codes only, different from one request to the next', async () => {
    const admin = await creerSuperadmin()
    const codes = new Set<string>()

    for (let i = 0; i < 4; i += 1) {
      const { code } = await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: `cible-${i}` })
      expect(code).toMatch(/^\d{6}$/)
      codes.add(code)
    }

    expect(codes.size).toBeGreaterThan(1)
  })

  it('should enqueue ONE job on the authentication queue, carrying the line identifier and the code, and no address', async () => {
    const admin = await creerSuperadmin({ email: 'admin-reauth-file@exemple.test' })

    const { reauthId, code } = await demanderEtLireCode(admin.id, PREUVE)

    const jobs = (await tousLesJobs()).filter((j) => j.name === JOBS.sendAdminReauthEmail)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.queueName).toBe(fileMessagesAuth().name)
    expect(jobs[0]?.data).toEqual({ reauthId, code })
    // L'adresse est relue en base par le worker : jamais écrite dans la file.
    expect(JSON.stringify(jobs[0]?.data)).not.toContain('admin-reauth-file@exemple.test')
  })

  it('should not keep the code in Redis once the job is done (removeOnComplete and removeOnFail)', async () => {
    const admin = await creerSuperadmin()
    await demanderEtLireCode(admin.id, PREUVE)

    const job = (await tousLesJobs()).find((j) => j.name === JOBS.sendAdminReauthEmail)

    expect(job?.opts.removeOnComplete).toBe(true)
    expect(job?.opts.removeOnFail).toBe(true)
  })

  it('should enqueue nothing, and write nothing, when the database refuses the line (unknown administrator)', async () => {
    const { demanderCode } = await reauthService()

    const erreur = await rejet(demanderCode('administrateur-qui-n-existe-pas', PREUVE))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe('23503')
    expect((await tousLesJobs()).filter((j) => j.name === JOBS.sendAdminReauthEmail)).toHaveLength(0)
  })

  it('should accept an action without target (global setting): the code only works without target', async () => {
    const admin = await creerSuperadmin()
    const sansCible = { action: 'reglage.modifier', cibleType: 'reglage' }
    const { code } = await demanderEtLireCode(admin.id, sansCible)

    await expect(actionDestructrice(admin.id, code, sansCible)).resolves.toBeUndefined()
  })

  it('should not accept a code requested WITHOUT target for the same action aimed at a given target (NULL is not a wildcard)', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, { action: 'compte.supprimer', cibleType: 'utilisateur' })

    expect(await rejet(actionDestructrice(admin.id, code, PREUVE))).toMatchObject({ code: 'REAUTH_INVALIDE' })
  })

  it('should not accept a code requested for a target when the action is presented WITHOUT target', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    expect(await rejet(actionDestructrice(admin.id, code, { action: 'compte.supprimer', cibleType: 'utilisateur' }))).toMatchObject({ code: 'REAUTH_INVALIDE' })
  })
})

describe('un code est lié à son triplet (action, type de cible, cible) (CA19)', () => {
  it('should refuse the code asked for (compte.supprimer, utilisateur, A) when used for the target B', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code } = await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-A' })

    const erreur = await rejet(actionDestructrice(admin.id, code, { ...PREUVE, cibleId: 'cible-B' }))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'REAUTH_INVALIDE', status: 403 })
    expect(await nomDe(admin.id)).toBe('Nom avant')
  })

  it('should refuse the code for another action on the same target', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    expect(await rejet(actionDestructrice(admin.id, code, { ...PREUVE, action: 'plan.changer' }))).toMatchObject({ code: 'REAUTH_INVALIDE' })
  })

  it('should refuse the code for the same identifier under another target type', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    expect(await rejet(actionDestructrice(admin.id, code, { ...PREUVE, cibleType: 'vitrine' }))).toMatchObject({ code: 'REAUTH_INVALIDE' })
  })

  it('should still let the code work for A after it was tried (and refused) for B', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-A' })
    await rejet(actionDestructrice(admin.id, code, { ...PREUVE, cibleId: 'cible-B' }))

    await expect(actionDestructrice(admin.id, code, { ...PREUVE, cibleId: 'cible-A' })).resolves.toBeUndefined()
  })

  it('should not use up the attempts of A when the code is tried for B', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-A' })

    for (let i = 0; i < ADMIN_REAUTH_ESSAIS + 1; i += 1) {
      await rejet(actionDestructrice(admin.id, code, { ...PREUVE, cibleId: 'cible-B' }))
    }

    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)?.essais).toBe(0)
  })

  it('should keep two open codes for two targets independent: using one leaves the other untouched', async () => {
    const admin = await creerSuperadmin()
    const codeA = (await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-A' })).code
    const codeB = (await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-B' })).code

    await actionDestructrice(admin.id, codeA, { ...PREUVE, cibleId: 'cible-A' })

    await expect(actionDestructrice(admin.id, codeB, { ...PREUVE, cibleId: 'cible-B' })).resolves.toBeUndefined()
  })
})

describe('3 codes faux, 6 demandes (CA20)', () => {
  it('should refuse the right code after 3 wrong ones', async () => {
    const admin = await creerSuperadmin({ name: 'Nom avant' })
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    const faux = autreCode(code)
    for (let i = 0; i < ADMIN_REAUTH_ESSAIS; i += 1) {
      expect(await rejet(actionDestructrice(admin.id, faux))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
    }

    const erreur = await rejet(actionDestructrice(admin.id, code))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'REAUTH_INVALIDE', status: 403 })
    expect(await nomDe(admin.id)).toBe('Nom avant')
    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)).toMatchObject({ essais: ADMIN_REAUTH_ESSAIS, consomme_le: null })
  })

  it('should still accept the right code after only 2 wrong ones', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)
    await rejet(actionDestructrice(admin.id, autreCode(code)))
    await rejet(actionDestructrice(admin.id, autreCode(code)))

    await expect(actionDestructrice(admin.id, code)).resolves.toBeUndefined()
  })

  it('should keep refusing with REAUTH_INVALIDE (a domain error, never a SQL error) beyond the third wrong code', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    for (let i = 0; i < ADMIN_REAUTH_ESSAIS + 3; i += 1) {
      const erreur = await rejet(actionDestructrice(admin.id, autreCode(code)))
      expect(erreur).toMatchObject({ estDomainError: true, code: 'REAUTH_INVALIDE', status: 403 })
    }

    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)?.essais).toBe(ADMIN_REAUTH_ESSAIS)
  })

  it('should keep the attempt counter even though the refused action rolled back (counted outside the transaction)', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    await rejet(actionDestructrice(admin.id, autreCode(code)))

    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)?.essais).toBe(1)
  })

  it('should not let a burnt code be revived by asking for the same code again: a NEW request gives a NEW code', async () => {
    const admin = await creerSuperadmin()
    const premier = await demanderEtLireCode(admin.id, PREUVE)
    for (let i = 0; i < ADMIN_REAUTH_ESSAIS; i += 1) await rejet(actionDestructrice(admin.id, autreCode(premier.code)))

    const second = await demanderEtLireCode(admin.id, PREUVE)

    await expect(actionDestructrice(admin.id, second.code)).resolves.toBeUndefined()
  })

  it('should answer the 6th request within 15 minutes with 429, and write and enqueue nothing for it', async () => {
    const { demanderCode } = await reauthService()
    const admin = await creerSuperadmin()
    for (let i = 0; i < ADMIN_REAUTH_LIMITE.limit; i += 1) {
      await demanderCode(admin.id, { ...PREUVE, cibleId: `cible-${i}` })
    }

    const erreur = await rejet(demanderCode(admin.id, { ...PREUVE, cibleId: 'cible-6' }))

    expect(ADMIN_REAUTH_LIMITE).toEqual({ limit: 5, windowS: 900 })
    expect(erreur).toMatchObject({ estDomainError: true, code: 'TROP_DE_REQUETES', status: 429 })
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(erreur.retryAfter).toBeLessThanOrEqual(ADMIN_REAUTH_LIMITE.windowS)
    expect(await lignesReauth(admin.id)).toHaveLength(ADMIN_REAUTH_LIMITE.limit)
    expect((await tousLesJobs()).filter((j) => j.name === JOBS.sendAdminReauthEmail)).toHaveLength(ADMIN_REAUTH_LIMITE.limit)
  })

  it('should count the requests per administrator, not per target', async () => {
    const { demanderCode } = await reauthService()
    const admin = await creerSuperadmin()
    // Cinq demandes pour LA MÊME cible : la sixième, pour une autre cible, est refusée.
    for (let i = 0; i < ADMIN_REAUTH_LIMITE.limit; i += 1) await demanderCode(admin.id, PREUVE)

    expect(await rejet(demanderCode(admin.id, { ...PREUVE, cibleId: 'une-autre-cible' }))).toMatchObject({ status: 429 })
  })

  it('should not let one administrator\'s requests use up another one\'s budget', async () => {
    const { demanderCode } = await reauthService()
    const premier = await creerSuperadmin()
    const second = await creerSuperadmin()
    for (let i = 0; i < ADMIN_REAUTH_LIMITE.limit; i += 1) await demanderCode(premier.id, { ...PREUVE, cibleId: `cible-${i}` })
    expect(await rejet(demanderCode(premier.id, PREUVE))).toMatchObject({ status: 429 })

    await expect(demanderCode(second.id, PREUVE)).resolves.toMatchObject({ expireLe: expect.any(Date) })
  })

  it('should let the fifth request through (the limit is 5, not 4)', async () => {
    const { demanderCode } = await reauthService()
    const admin = await creerSuperadmin()

    for (let i = 0; i < ADMIN_REAUTH_LIMITE.limit; i += 1) {
      await expect(demanderCode(admin.id, { ...PREUVE, cibleId: `cible-${i}` })).resolves.toBeDefined()
    }
  })

  it('should bound the counter to the 15-minute window (the key expires) and open the budget again once it is gone', async () => {
    const { demanderCode } = await reauthService()
    const admin = await creerSuperadmin()
    for (let i = 0; i < ADMIN_REAUTH_LIMITE.limit; i += 1) await demanderCode(admin.id, { ...PREUVE, cibleId: `cible-${i}` })
    await rejet(demanderCode(admin.id, PREUVE))
    const cles = await redis.keys(`*admin-reauth:${admin.id}`)
    expect(cles).toHaveLength(1)
    const ttl = await redis.ttl(cles[0]!)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(ADMIN_REAUTH_LIMITE.windowS)

    await redis.del(cles[0]!)

    await expect(demanderCode(admin.id, PREUVE)).resolves.toBeDefined()
  })
})

describe('une nouvelle demande pour la même action fait expirer l\'ancienne', () => {
  it('should refuse the first code once a second one was requested for the same triplet', async () => {
    const admin = await creerSuperadmin()
    const premier = await demanderEtLireCode(admin.id, PREUVE)
    const second = await demanderEtLireCode(admin.id, PREUVE)
    expect(second.code).not.toBe(premier.code)

    expect(await rejet(actionDestructrice(admin.id, premier.code))).toMatchObject({ code: 'REAUTH_INVALIDE' })
    await expect(actionDestructrice(admin.id, second.code)).resolves.toBeUndefined()
  })

  it('should expire the previous line in the database, not delete it', async () => {
    const admin = await creerSuperadmin()
    const premier = await demanderEtLireCode(admin.id, PREUVE)
    await demanderEtLireCode(admin.id, PREUVE)

    const lignes = await lignesReauth(admin.id)

    expect(lignes).toHaveLength(2)
    expect(lignes.find((l) => l.id === premier.reauthId)?.expire_le.getTime()).toBeLessThanOrEqual(Date.now())
    expect(lignes.find((l) => l.id !== premier.reauthId)?.expire_le.getTime()).toBeGreaterThan(Date.now())
  })

  it('should leave the open code of ANOTHER target alone', async () => {
    const admin = await creerSuperadmin()
    const codeA = (await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-A' })).code
    await demanderEtLireCode(admin.id, { ...PREUVE, cibleId: 'cible-B' })

    await expect(actionDestructrice(admin.id, codeA, { ...PREUVE, cibleId: 'cible-A' })).resolves.toBeUndefined()
  })

  it('should leave the open code of ANOTHER action alone', async () => {
    const admin = await creerSuperadmin()
    const codePlan = (await demanderEtLireCode(admin.id, { ...PREUVE, action: 'plan.changer' })).code
    await demanderEtLireCode(admin.id, PREUVE)

    await expect(actionDestructrice(admin.id, codePlan, { ...PREUVE, action: 'plan.changer' })).resolves.toBeUndefined()
  })

  it('should also expire the previous code of a request without target (NULL compared as a value)', async () => {
    const admin = await creerSuperadmin()
    const sansCible = { action: 'reglage.modifier', cibleType: 'reglage' }
    const premier = await demanderEtLireCode(admin.id, sansCible)
    await demanderEtLireCode(admin.id, sansCible)

    expect(await rejet(actionDestructrice(admin.id, premier.code, sansCible))).toMatchObject({ code: 'REAUTH_INVALIDE' })
  })
})

describe('compte supprimé', () => {
  it('should drop the open codes of an account when the account is deleted (ON DELETE CASCADE)', async () => {
    const admin = await creerSuperadmin()
    await demanderEtLireCode(admin.id, PREUVE)

    await db.execute(sql`DELETE FROM users WHERE id = ${admin.id}`)

    const restantes = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM admin_reauth WHERE admin_id = ${admin.id}`)
    expect(Number(restantes.rows[0]?.n)).toBe(0)
  })
})

describe('concurrence et frein sur les tentatives (M1)', () => {
  const faux = (code: string) => autreCode(code)

  it('should count at most 3 attempts for 50 parallel wrong codes on the same line, then refuse the right code', async () => {
    const { consommer } = await reauthService()
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    // 5 vagues de 8 transactions réellement simultanées (le pool compte 10 connexions : au-delà, on testerait le pool).
    const resultats: PromiseSettledResult<unknown>[] = []
    for (let vague = 0; vague < 5; vague++) {
      resultats.push(
        ...(await Promise.allSettled(
          Array.from({ length: 8 }, () => db.transaction((tx) => consommer(tx, admin.id, { ...PREUVE, code: faux(code) }))),
        )),
      )
    }

    expect(resultats.every((r) => r.status === 'rejected')).toBe(true)
    for (const r of resultats as PromiseRejectedResult[]) expect(r.reason).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
    const ligne = (await lignesReauth(admin.id)).find((l) => l.id === reauthId)
    expect(ligne?.essais).toBe(ADMIN_REAUTH_ESSAIS)
    expect(ligne?.consomme_le).toBeNull()
    expect(await rejet(actionDestructrice(admin.id, code))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
  })

  it('should never let essais exceed 3 whatever the mix of right and wrong parallel codes, and consume at most once', async () => {
    const { consommer } = await reauthService()
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)

    const resultats = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => db.transaction((tx) => consommer(tx, admin.id, { ...PREUVE, code: i % 3 === 0 ? code : faux(code) }))),
    )

    expect(resultats.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1)
    const ligne = (await lignesReauth(admin.id)).find((l) => l.id === reauthId)
    expect(ligne?.essais).toBeLessThanOrEqual(ADMIN_REAUTH_ESSAIS)
    expect((await lignesReauth(admin.id)).filter((l) => l.consomme_le !== null).length).toBeLessThanOrEqual(1)
  })

  it('should consume a right code exactly once among 8 simultaneous uses', async () => {
    const admin = await creerSuperadmin()
    const { code } = await demanderEtLireCode(admin.id, PREUVE)

    const resultats = await Promise.allSettled(Array.from({ length: 8 }, () => actionDestructrice(admin.id, code)))

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await lignesReauth(admin.id)).filter((l) => l.consomme_le !== null)).toHaveLength(1)
  })

  it('should rate-limit the attempts per administrator in exigerReauth: 429 beyond the limit, the right code is then not consumed', async () => {
    const admin = await creerSuperadmin()
    const { code, reauthId } = await demanderEtLireCode(admin.id, PREUVE)
    // Des demandes SANS en-tête ne comptent pas (REAUTH_REQUISE avant le limiteur).
    for (let i = 0; i < ADMIN_REAUTH_TENTATIVES_LIMITE.limit + 2; i += 1) {
      expect(await rejet(actionDestructrice(admin.id, null))).toMatchObject({ code: 'REAUTH_REQUISE' })
    }
    for (let i = 0; i < ADMIN_REAUTH_TENTATIVES_LIMITE.limit; i += 1) {
      expect(await rejet(actionDestructrice(admin.id, faux(code)))).toMatchObject({ code: 'REAUTH_INVALIDE', status: 403 })
    }

    const bloque = await rejet(actionDestructrice(admin.id, code))

    expect(bloque).toMatchObject({ estDomainError: true, code: 'TROP_DE_REQUETES', status: 429 })
    expect(bloque.retryAfter).toBeGreaterThan(0)
    expect((await lignesReauth(admin.id)).find((l) => l.id === reauthId)?.consomme_le).toBeNull()
  })

  it('should keep the attempt budget per administrator', async () => {
    const premier = await creerSuperadmin()
    const second = await creerSuperadmin()
    for (let i = 0; i <= ADMIN_REAUTH_TENTATIVES_LIMITE.limit; i += 1) await rejet(actionDestructrice(premier.id, '123456'))
    const { code } = await demanderEtLireCode(second.id, PREUVE)

    await expect(actionDestructrice(second.id, code)).resolves.toBeUndefined()
  })
})
