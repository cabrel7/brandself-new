// A3 : purge quotidienne du compteur des webhooks refusés (> 90 jours). File `maintenance`, job répété sans donnée (rien
// dans Redis). `attempts: 1` : un passage raté est rattrapé le lendemain. `upsertJobScheduler` est idempotent.
import type { JobsOptions, Queue } from 'bullmq'
import {
  JOBS,
  WEBHOOKS_REFUSES_PURGE_CRON,
  WEBHOOKS_REFUSES_PURGE_SCHEDULER_ID,
} from '../../shared/jobs'

export const webhooksRefusesJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierPurgeWebhooksRefuses(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    WEBHOOKS_REFUSES_PURGE_SCHEDULER_ID,
    { pattern: WEBHOOKS_REFUSES_PURGE_CRON, tz: 'UTC' },
    { name: JOBS.purgerWebhooksRefuses, data: {}, opts: webhooksRefusesJobOptions },
  )
}
