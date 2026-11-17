// A4 (D-A4-15) : purge quotidienne du journal d'envoi des codes (90 jours), file `maintenance`. Job répété sans
// donnée. `attempts: 1` : un passage raté est rattrapé le lendemain.
import type { JobsOptions, Queue } from 'bullmq'
import { ENVOIS_CODES_PURGE_CRON, ENVOIS_CODES_PURGE_SCHEDULER_ID, JOBS } from '../../shared/jobs'

export const envoisCodesJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierPurgeEnvois(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    ENVOIS_CODES_PURGE_SCHEDULER_ID,
    { pattern: ENVOIS_CODES_PURGE_CRON, tz: 'UTC' },
    { name: JOBS.purgerEnvois, data: {}, opts: envoisCodesJobOptions },
  )
}
