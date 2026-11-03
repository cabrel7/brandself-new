import type { JobsOptions, Queue } from 'bullmq'
import {
  IA_JOB_ID_PREFIXE,
  IA_PURGE_CRON,
  IA_PURGE_SCHEDULER_ID,
  IA_PURGE_TZ,
  JOBS,
} from '../../shared/jobs'
import type { IaJobData } from '../../shared/jobs'

// S8 §5 : file `ia`. Un job = un identifiant de génération (rien de personnel dans Redis).
// Aucune relance BullMQ (`attempts: 1`) : les nouvelles tentatives vivent dans l'exécuteur, bornées par le
// délai global de 25 s qui court depuis la création de la génération. Le jobId déterministe empêche de
// mettre deux fois la même génération en file.

export const iaJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export function iaJobId(generationId: string): string {
  return `${IA_JOB_ID_PREFIXE}${generationId}`
}

export async function enqueueGeneration(queue: Pick<Queue, 'add'>, generationId: string): Promise<void> {
  const data: IaJobData = { generationId }
  await queue.add(JOBS.genererIa, data, { ...iaJobOptions, jobId: iaJobId(generationId) })
}

/** Purge quotidienne (03:00 UTC), à poser sur la file `maintenance` (jamais sur `ia`). `upsertJobScheduler` est idempotent : un redémarrage ne duplique rien. */
export async function planifierPurge(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    IA_PURGE_SCHEDULER_ID,
    { pattern: IA_PURGE_CRON, tz: IA_PURGE_TZ },
    { name: JOBS.purgerIa, data: {}, opts: iaJobOptions },
  )
}
