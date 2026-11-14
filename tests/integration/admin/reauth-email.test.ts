import { UnrecoverableError } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { creerSuperadmin, demanderEtLireCode, jobReauth, tousLesJobs, viderFileMessagesAuth } from '../support/admin'
import { rejet } from '../support/erreurs'
import { redis } from '../../../server/utils/redis'

// A1 : traitement du job `send-admin-reauth-email` par le worker (base et Redis réels, boîte OTP de développement).

describe('processAdminReauthEmailJob', () => {
  it.each([
    ['objet vide', {}],
    ['code trop court', { reauthId: 'x', code: '12' }],
    ['code non numérique', { reauthId: 'x', code: 'abcdef' }],
    ['champ en trop', { reauthId: 'x', code: '123456', adresse: 'a@exemple.test' }],
    ['null', null],
    ['chaîne', 'send'],
  ])('should refuse invalid data (%s) with an UnrecoverableError: no retry, and no data in the message', async (_cas, donnee) => {
    const { processAdminReauthEmailJob } = await jobReauth()

    const erreur = await rejet(processAdminReauthEmailJob(donnee))

    expect(erreur.brute).toBeInstanceOf(UnrecoverableError)
    expect(erreur.message).toBe('ADMIN_REAUTH_JOB_INVALIDE')
  })

  it('should deliver the code to the address read in the database (development mailbox), for an open line', async () => {
    await viderFileMessagesAuth()
    const { processAdminReauthEmailJob } = await jobReauth()
    const admin = await creerSuperadmin({ email: 'boite-reauth@exemple.test' })
    const { code, reauthId } = await demanderEtLireCode(admin.id, { action: 'compte.supprimer', cibleType: 'utilisateur', cibleId: 'c1' })
    const job = (await tousLesJobs()).find((j) => (j.data as { reauthId?: string }).reauthId === reauthId)

    await processAdminReauthEmailJob(job?.data)

    expect(await redis.get('otp:boite:boite-reauth@exemple.test')).toBe(code)
    await redis.del('otp:boite:boite-reauth@exemple.test')
  })

  it('should send nothing for a line that is no longer open or whose account is no longer a superadmin', async () => {
    const { processAdminReauthEmailJob } = await jobReauth()

    await expect(processAdminReauthEmailJob({ reauthId: 'ligne-inconnue', code: '123456' })).resolves.toBeUndefined()
  })
})
