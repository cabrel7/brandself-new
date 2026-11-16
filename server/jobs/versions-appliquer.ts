// A5 (D-A5-03) : applique les versions de configuration programmées dont la date est échue. File `maintenance`, job
// répété toutes les 60 secondes, sans donnée (rien dans Redis). Idempotent : une version déjà appliquée n'est plus
// `programmee`. `attempts: 1` : un passage raté est rattrapé 60 s plus tard. `upsertJobScheduler` est idempotent au
// redémarrage du worker. Délai maximal d'application : 60 s après la date d'effet.
import type { JobsOptions, Queue } from 'bullmq'
import {
  JOBS,
  VERSIONS_APPLIQUER_INTERVALLE_MS,
  VERSIONS_APPLIQUER_SCHEDULER_ID,
} from '../../shared/jobs'
import { appliquerVersionsProgrammees } from '../services/configuration/versions'

export const versionsAppliquerJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierVersionsAppliquer(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    VERSIONS_APPLIQUER_SCHEDULER_ID,
    { every: VERSIONS_APPLIQUER_INTERVALLE_MS },
    { name: JOBS.appliquerVersions, data: {}, opts: versionsAppliquerJobOptions },
  )
}

/** Gestionnaire du job : nombre de versions appliquées (le seul élément journalisé, jamais de valeur). */
export async function traiterVersionsAppliquer(now: Date = new Date()): Promise<number> {
  return appliquerVersionsProgrammees(now)
}
