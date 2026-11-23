// E1 (D4) : purge quotidienne des empreintes de l'essai de plus de 24 mois, file `maintenance`. Job répété sans donnée
// (rien dans Redis). `attempts: 1` : un passage raté est rattrapé le lendemain. `upsertJobScheduler` est idempotent.
import type { JobsOptions, Queue } from 'bullmq'
import { ESSAI_EMPREINTES_PURGE_CRON, ESSAI_EMPREINTES_PURGE_SCHEDULER_ID, JOBS } from '../../shared/jobs'

export const essaiEmpreintesJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierPurgeEssaiEmpreintes(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    ESSAI_EMPREINTES_PURGE_SCHEDULER_ID,
    { pattern: ESSAI_EMPREINTES_PURGE_CRON, tz: 'UTC' },
    { name: JOBS.purgerEssaiEmpreintes, data: {}, opts: essaiEmpreintesJobOptions },
  )
}
