import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import {
  FILE_EMAILS_NOTIFICATIONS,
  FILE_IA_FOND,
  FILE_MESSAGES_AUTH,
  FILES_SUPERVISEES,
  SUPERVISION_ALERTE_CLE,
  SUPERVISION_ALERTE_INTERVALLE_S,
  SUPERVISION_TRANCHE_S,
} from '../../../shared/jobs'
import { schemaEtatFilesDto } from '../../../shared/schemas/admin-a4'
import { redis } from '../../../server/utils/redis'
import { compterJournal, demanderEtLireCode, journalDe, ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import {
  CANARI_JOB,
  MOTIF_A4,
  appelerA4,
  brut,
  cleIdempotenceA4,
  compterJobsEnFile,
  compterOutboxTotal,
  creerJobEchoue,
  etatJob,
  fermerFilesReelles,
  fileReelle,
  reinitialiserA4,
  supervisionAlertesModule,
  supervisionEchecsModule,
} from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'

// A4 CA09, CA10, CA11 (D-A4-02, D-A4-03) : supervision des files BullMQ RÉELLES (Redis réel ; un job « échoué » l'est parce
// qu'un Worker de test a levé une erreur, aucun faux compteur). Rien de ce qui est dans `job.data` ni dans le message d'erreur
// n'atteint l'administration. SPEC : CA09 parle d'un job `send-otp-email` relancé, mais ces jobs vivent dans `messages-auth`, que
// CA10 déclare non relançable : le cas relançable est donc prouvé avec `send-transactional-email` (file `emails-notifications`).

const suite = preparerSuiteAdmin()
let connecte: AdminA4

beforeEach(async () => {
  await reinitialiserA4({ files: true })
  connecte = await ouvrirAdmin(suite.auth())
})

afterAll(fermerFilesReelles)

const relancer = (file: string, id: string, surcharges: Record<string, unknown> = {}) =>
  appelerA4('jobRelancer', { cookie: connecte.cookie, corps: { file, id, motif: MOTIF_A4, cleIdempotence: cleIdempotenceA4(), ...surcharges } })

describe('état des files et relance (CA09, CA10)', () => {
  it('should list every supervised queue with its counters, never job.data nor the raw error message, and flag messages-auth as not retryable', async () => {
    const id = await creerJobEchoue(FILE_EMAILS_NOTIFICATIONS)
    const { enregistrerEchecFile } = await supervisionEchecsModule()
    await enregistrerEchecFile(FILE_EMAILS_NOTIFICATIONS, new Date())
    await enregistrerEchecFile(FILE_EMAILS_NOTIFICATIONS, new Date())

    const reponse = await appelerA4('jobsEtat', { cookie: connecte.cookie })

    expect(reponse.status).toBe(200)
    const etat = schemaEtatFilesDto.parse(reponse.corps)
    expect(etat.files.map((f) => f.file).sort()).toEqual([...FILES_SUPERVISEES].sort())
    const emails = etat.files.find((f) => f.file === FILE_EMAILS_NOTIFICATIONS)
    expect(emails).toMatchObject({ compteurs: { echoues: 1 }, echecs15Min: 2, relancable: true })
    expect(emails?.echecs.map((e) => e.id)).toEqual([id])
    expect(etat.files.find((f) => f.file === FILE_MESSAGES_AUTH)?.relancable).toBe(false)
    for (const interdit of [CANARI_JOB.email, CANARI_JOB.code, 'sk_canari_secret_9f3', 'zorglub']) expect(brut(reponse), interdit).not.toContain(interdit)
  })

  it('should put a failed job back in the queue, journal ONE job.relancer line without data, and replay a retry without a second effect (CA09)', async () => {
    const id = await creerJobEchoue(FILE_EMAILS_NOTIFICATIONS)
    expect(await etatJob(FILE_EMAILS_NOTIFICATIONS, id)).toBe('failed')
    const cle = cleIdempotenceA4()

    const reponse = await relancer(FILE_EMAILS_NOTIFICATIONS, id, { cleIdempotence: cle })
    const rejeu = await relancer(FILE_EMAILS_NOTIFICATIONS, id, { cleIdempotence: cle })

    expect(reponse.status).toBe(200)
    expect(rejeu.status).toBe(200)
    expect(await etatJob(FILE_EMAILS_NOTIFICATIONS, id)).toBe('waiting')
    const lignes = await journalDe(ADMIN_ACTIONS.jobRelancer)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'job', motif: MOTIF_A4, cle_idempotence: cle })
    expect(lignes[0]?.cible_id).toContain(id)
    for (const interdit of [CANARI_JOB.email, CANARI_JOB.code, 'sk_canari_secret_9f3']) {
      expect(JSON.stringify(lignes[0]), interdit).not.toContain(interdit)
      expect(brut(reponse), interdit).not.toContain(interdit)
    }
  })

  it('should answer 422 JOB_NON_RELANCABLE for a failed messages-auth job (it carries a login code), leave it failed, and journal nothing (CA10)', async () => {
    const id = await creerJobEchoue(FILE_MESSAGES_AUTH, 'send-otp-email')

    const reponse = await relancer(FILE_MESSAGES_AUTH, id)

    expect(reponse).toMatchObject({ status: 422, code: 'JOB_NON_RELANCABLE' })
    expect(await etatJob(FILE_MESSAGES_AUTH, id)).toBe('failed')
    expect(await compterJournal()).toBe(0)
  })

  it('should refuse to retry a job that is not failed, and an unknown job, without any write (D-A4-02)', async () => {
    const attente = await fileReelle(FILE_IA_FOND).add('seo-ia-regenerer', { vitrineId: 'v1' }, { delay: 600_000 })

    const enAttente = await relancer(FILE_IA_FOND, attente.id ?? '')
    const inconnu = await relancer(FILE_IA_FOND, 'job-qui-nexiste-pas')

    for (const reponse of [enAttente, inconnu]) {
      expect(reponse.status).toBeGreaterThanOrEqual(400)
      expect(reponse.status).toBeLessThan(500)
    }
    expect(await etatJob(FILE_IA_FOND, attente.id ?? '')).toBe('delayed')
    expect(await compterJournal()).toBe(0)
  })
})

describe('purge des échecs', () => {
  it('should demand a re-authentication code, then remove only failed jobs, at most `limite`, and journal job.purger', async () => {
    const [a, b] = [await creerJobEchoue(FILE_IA_FOND, 'seo-ia-regenerer'), await creerJobEchoue(FILE_IA_FOND, 'seo-ia-regenerer')]
    const attente = await fileReelle(FILE_IA_FOND).add('seo-ia-regenerer', { vitrineId: 'v2' }, { delay: 600_000 })
    const corps = { file: FILE_IA_FOND, motif: MOTIF_A4, limite: 1 }

    const sansCode = await appelerA4('jobsPurger', { cookie: connecte.cookie, corps })
    const code = (await demanderEtLireCode(connecte.admin.id, { action: ADMIN_ACTIONS.jobPurger, cibleType: 'job', cibleId: FILE_IA_FOND })).code
    const reponse = await appelerA4('jobsPurger', { cookie: connecte.cookie, reauth: code, corps })

    expect(sansCode).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(reponse).toMatchObject({ status: 200, corps: { purges: 1 } })
    const restants = [await etatJob(FILE_IA_FOND, a), await etatJob(FILE_IA_FOND, b)].filter((e) => e === 'failed')
    expect(restants).toHaveLength(1)
    expect(await etatJob(FILE_IA_FOND, attente.id ?? '')).toBe('delayed')
    expect(await journalDe(ADMIN_ACTIONS.jobPurger)).toHaveLength(1)
  })
})

describe('alerte sur les échecs définitifs (CA11, D-A4-03)', () => {
  const instantsEnTranches = (base: Date, tranches: number): Date[] =>
    Array.from({ length: tranches }, (_, i) => new Date(base.getTime() - i * SUPERVISION_TRANCHE_S * 1000))

  async function echecs(file: string, nombre: number, instants: Date[]): Promise<void> {
    const { enregistrerEchecFile } = await supervisionEchecsModule()
    for (let i = 0; i < nombre; i += 1) await enregistrerEchecFile(file as never, instants[i % instants.length] as Date)
  }

  it('should send NO alert for 19 failures of a queue in 15 minutes (spread over 3 slices), none for failures in another queue, and one alert at the 20th; an older slice does not count', async () => {
    const { alerterSiSeuil } = await supervisionAlertesModule()
    const base = new Date()
    const avantJobs = await compterJobsEnFile()
    const avantOutbox = await compterOutboxTotal()
    const alertes = async (): Promise<number> => (await compterJobsEnFile()) - avantJobs + ((await compterOutboxTotal()) - avantOutbox)

    await echecs(FILE_EMAILS_NOTIFICATIONS, 19, instantsEnTranches(base, 3))
    await echecs(FILE_IA_FOND, 10, [base])
    await echecs(FILE_EMAILS_NOTIFICATIONS, 5, [new Date(base.getTime() - 4 * SUPERVISION_TRANCHE_S * 1000)])
    await alerterSiSeuil(base)
    expect(await alertes()).toBe(0)
    expect(await redis.exists(SUPERVISION_ALERTE_CLE)).toBe(0)

    await echecs(FILE_EMAILS_NOTIFICATIONS, 1, [base])
    await alerterSiSeuil(base)

    expect(await alertes()).toBe(1)
    expect(await redis.exists(SUPERVISION_ALERTE_CLE)).toBe(1)
  })

  it('should send at most ONE alert per hour: a second check inside the hour sends nothing, even with more failures', async () => {
    const { alerterSiSeuil } = await supervisionAlertesModule()
    const base = new Date()
    await echecs(FILE_EMAILS_NOTIFICATIONS, 25, [base])
    await alerterSiSeuil(base)
    const apresPremiere = (await compterJobsEnFile()) + (await compterOutboxTotal())
    const ttl = await redis.ttl(SUPERVISION_ALERTE_CLE)

    await echecs(FILE_EMAILS_NOTIFICATIONS, 25, [base])
    await alerterSiSeuil(new Date(base.getTime() + 600_000))

    expect(apresPremiere).toBeGreaterThanOrEqual(1)
    expect((await compterJobsEnFile()) + (await compterOutboxTotal())).toBe(apresPremiere)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(SUPERVISION_ALERTE_INTERVALLE_S)
  })
})
