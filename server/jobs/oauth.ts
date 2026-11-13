// S16 : purge quotidienne des clients OAuth orphelins, assertions et jetons expirés.
// File `maintenance`, job répété sans donnée (rien dans Redis). `attempts: 1` : un passage raté est rattrapé le
// lendemain. `upsertJobScheduler` est idempotent : un redémarrage du worker ne duplique rien.
import type { JobsOptions, Queue } from 'bullmq'
import { JOBS } from '../../shared/jobs'
import { OAUTH_PURGE_CRON, OAUTH_PURGE_SCHEDULER_ID } from '../../shared/mcp'

export const oauthJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierPurgeOauth(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    OAUTH_PURGE_SCHEDULER_ID,
    { pattern: OAUTH_PURGE_CRON, tz: 'UTC' },
    { name: JOBS.purgerOauth, data: {}, opts: oauthJobOptions },
  )
}
