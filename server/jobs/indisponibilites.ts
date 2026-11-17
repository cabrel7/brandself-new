// Purge quotidienne des indisponibilités échues (> 90 jours). File `maintenance`, job répété sans donnée (rien dans
// Redis). `attempts: 1` : un passage raté est rattrapé le lendemain. `upsertJobScheduler` est idempotent.
import type { JobsOptions, Queue } from 'bullmq'
import { INDISPONIBILITE_PURGE_CRON, INDISPONIBILITE_PURGE_SCHEDULER_ID } from '../../shared/agenda'
import { JOBS } from '../../shared/jobs'

export const indisponibilitesJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierPurgeIndisponibilites(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    INDISPONIBILITE_PURGE_SCHEDULER_ID,
    { pattern: INDISPONIBILITE_PURGE_CRON, tz: 'UTC' },
    { name: JOBS.purgerIndisponibilites, data: {}, opts: indisponibilitesJobOptions },
  )
}
