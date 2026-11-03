import type { JobsOptions, Queue } from 'bullmq'
import { JOBS } from '../../shared/jobs'
import {
  NOTIFICATIONS_PURGE_CRON,
  NOTIFICATIONS_PURGE_SCHEDULER_ID,
  NOTIFICATIONS_PURGE_TZ,
  NOTIFICATIONS_SCHEDULER_ID,
  NOTIFICATIONS_TICK_CRON,
  NOTIFICATIONS_TICK_TZ,
} from '../../shared/notifications'

// S9 §4.1 : tick sur la file `system`, purge sur la file `maintenance` (les purges lentes n'attendent jamais le tick). Deux jobs répétés, sans donnée (rien de personnel dans Redis). Aucune relance
// BullMQ (`attempts: 1`) : un tick raté est rattrapé par le suivant, les fenêtres de rattrapage durent des
// heures. `upsertJobScheduler` est idempotent : un redémarrage du worker ne duplique rien.

export const notificationsJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

/** Tick de planification (résumé hebdomadaire, rendez-vous du jour), toutes les 5 minutes. */
export async function planifierNotificationsRepetees(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    NOTIFICATIONS_SCHEDULER_ID,
    { pattern: NOTIFICATIONS_TICK_CRON, tz: NOTIFICATIONS_TICK_TZ },
    { name: JOBS.planifierNotifications, data: {}, opts: notificationsJobOptions },
  )
}

/** Purge quotidienne de l'outbox (lignes terminales de plus de OUTBOX_RETENTION_JOURS). */
export async function planifierPurgeNotifications(queue: Pick<Queue, 'upsertJobScheduler'>): Promise<void> {
  await queue.upsertJobScheduler(
    NOTIFICATIONS_PURGE_SCHEDULER_ID,
    { pattern: NOTIFICATIONS_PURGE_CRON, tz: NOTIFICATIONS_PURGE_TZ },
    { name: JOBS.purgerNotifications, data: {}, opts: notificationsJobOptions },
  )
}
