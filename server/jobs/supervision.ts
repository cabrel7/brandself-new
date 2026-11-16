// A4 (D-A4-03) : contrôle des échecs définitifs par file, toutes les 5 minutes (file `maintenance`). Job répété sans
// donnée (rien dans Redis). `attempts: 1` : un passage raté est rattrapé 5 minutes plus tard.
import type { JobsOptions, Queue } from 'bullmq'
import { JOBS, SUPERVISION_CONTROLE_INTERVALLE_MS, SUPERVISION_CONTROLE_SCHEDULER_ID } from '../../shared/jobs'
import { alerterSiSeuil } from '../services/admin/supervision-alertes'

export const supervisionJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export async function planifierControleEchecs(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    SUPERVISION_CONTROLE_SCHEDULER_ID,
    { every: SUPERVISION_CONTROLE_INTERVALLE_MS },
    { name: JOBS.controlerEchecsFiles, data: {}, opts: supervisionJobOptions },
  )
}

/** Traitement du job : une alerte enfilée ou non (booléen seulement dans le journal du worker). */
export async function traiterControleEchecs(maintenant: Date = new Date()): Promise<boolean> {
  return alerterSiSeuil(maintenant)
}
