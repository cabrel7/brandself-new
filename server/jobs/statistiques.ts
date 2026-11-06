// S11 §5 : agrégation et purge des statistiques de visite.
// File `maintenance` (purges quotidiennes, lentes, jamais urgentes). Deux jobs répétés, sans donnée
// (rien de personnel dans Redis). Aucune relance BullMQ (`attempts: 1`) : un tick raté est rattrapé par le
// suivant. `upsertJobScheduler` est idempotent : un redémarrage du worker ne duplique rien.
import type { JobsOptions, Queue } from 'bullmq'
import { JOBS } from '../../shared/jobs'
export const statistiquesJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

/** Agrégation quotidienne (11:00 UTC) : écrit les agrégats `statistiques_jour_*` pour la fenêtre des 4
 * derniers jours UTC (couvre UTC±14 h et 2 jours de panne du worker). Idempotent. */
export async function planifierAgregationStatistiques(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    'statistiques-agreger',
    { pattern: '0 11 * * *', tz: 'UTC' },
    { name: JOBS.agregerStatistiques, data: {}, opts: statistiquesJobOptions },
  )
}

/** Purge quotidienne (05:00 UTC) : supprime `vues` > 90 jours et agrégats > 180 jours. Idempotente. */
export async function planifierPurgeStatistiques(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    'statistiques-purger',
    { pattern: '0 5 * * *', tz: 'UTC' },
    { name: JOBS.purgerStatistiques, data: {}, opts: statistiquesJobOptions },
  )
}
