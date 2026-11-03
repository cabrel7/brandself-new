import type { JobsOptions, Queue } from 'bullmq'
import { JOBS, PAIEMENTS_SCHEDULER_ID, PAIEMENTS_TICK_MS } from '../../shared/jobs'

// S10 §1 #109 : file `paiements`. Un tick répété (10 s) sans donnée (rien de personnel dans Redis). Aucune relance
// BullMQ (`attempts: 1`) : un tick raté est rattrapé par le suivant. `upsertJobScheduler` est idempotent.

export const paiementsJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierVerificationsPaiements(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    PAIEMENTS_SCHEDULER_ID,
    { every: PAIEMENTS_TICK_MS },
    { name: JOBS.verifierPaiements, data: {}, opts: paiementsJobOptions },
  )
}
