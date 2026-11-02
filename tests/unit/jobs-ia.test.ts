import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { IA_JOB_ID_PREFIXE, IA_PURGE_CRON, IA_PURGE_SCHEDULER_ID, IA_PURGE_TZ, JOBS, iaJobDataSchema } from '../../shared/jobs'

// S8 §5 : la file `ia`. Un job = un identifiant de génération (rien de personnel dans Redis), un jobId
// déterministe (le même identifiant ne peut pas être mis deux fois en file), AUCUNE relance BullMQ
// (les nouvelles tentatives sont dans le processeur, bornées par le délai global), purge quotidienne à 03:00 UTC.
// La file est simulée ici pour lire les arguments ; le comportement réel est prouvé dans
// tests/integration/worker-ia.test.ts (vraie file, vrai worker, Redis /15).

const jobsIa = () => import('../../server/jobs/ia')

function fausseFile() {
  return { add: vi.fn().mockResolvedValue({}), upsertJobScheduler: vi.fn().mockResolvedValue({}) }
}

describe('iaJobId', () => {
  it('should build a deterministic id from the generation id', async () => {
    const { iaJobId } = await jobsIa()
    const id = randomUUID()

    expect(iaJobId(id)).toBe(`${IA_JOB_ID_PREFIXE}${id}`)
    expect(iaJobId(id)).toBe(iaJobId(id))
  })

  it('should differ for two generations', async () => {
    const { iaJobId } = await jobsIa()

    expect(iaJobId(randomUUID())).not.toBe(iaJobId(randomUUID()))
  })
})

describe('iaJobOptions', () => {
  it('should disable BullMQ retries: attempts are handled by the processor within the global budget', async () => {
    const { iaJobOptions } = await jobsIa()

    expect(iaJobOptions.attempts).toBe(1)
    expect(iaJobOptions.removeOnComplete).toBe(true)
    expect(iaJobOptions.removeOnFail).toBe(true)
    expect(iaJobOptions).not.toHaveProperty('backoff')
  })
})

describe('enqueueGeneration', () => {
  it('should add one ia-generer job carrying only the generation id, with the deterministic job id', async () => {
    const { enqueueGeneration, iaJobId, iaJobOptions } = await jobsIa()
    const file = fausseFile()
    const id = randomUUID()

    await enqueueGeneration(file as never, id)

    expect(file.add).toHaveBeenCalledTimes(1)
    const [nom, donnees, options] = file.add.mock.calls[0] as [string, unknown, Record<string, unknown>]
    expect(nom).toBe(JOBS.genererIa)
    expect(donnees).toEqual({ generationId: id })
    expect(iaJobDataSchema.safeParse(donnees).success).toBe(true)
    expect(options).toMatchObject({ ...iaJobOptions, jobId: iaJobId(id) })
  })

  it('should let the queue error reach the caller (the caller then falls back, no silent loss)', async () => {
    const { enqueueGeneration } = await jobsIa()
    const file = fausseFile()
    file.add.mockRejectedValue(new Error('Connection is closed.'))

    await expect(enqueueGeneration(file as never, randomUUID())).rejects.toThrow('Connection is closed.')
  })
})

describe('planifierPurge', () => {
  it('should register the daily purge at 03:00 UTC under a stable scheduler id (idempotent upsert)', async () => {
    const { planifierPurge } = await jobsIa()
    const file = fausseFile()

    await planifierPurge(file as never)

    expect(file.upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [idScheduler, repetition, modele] = file.upsertJobScheduler.mock.calls[0] as [string, Record<string, unknown>, { name?: string }]
    expect(idScheduler).toBe(IA_PURGE_SCHEDULER_ID)
    expect(repetition).toMatchObject({ pattern: IA_PURGE_CRON, tz: IA_PURGE_TZ })
    expect(modele?.name).toBe(JOBS.purgerIa)
  })

  it('should keep the documented schedule', () => {
    expect(IA_PURGE_SCHEDULER_ID).toBe('ia-purger')
    expect(IA_PURGE_CRON).toBe('0 3 * * *')
    expect(IA_PURGE_TZ).toBe('UTC')
  })
})
