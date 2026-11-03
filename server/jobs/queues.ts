import { Queue } from 'bullmq'
import { FILE_EMAILS_NOTIFICATIONS, FILE_IA, FILE_MAINTENANCE, FILE_SYSTEM } from '../../shared/jobs'
import { redis } from '../utils/redis'

// Les files d'authentification (OTP) sont produites par server/auth.config.ts (fichier limité à node_modules
// et shared/, il ne peut pas importer ce module).
const g = globalThis as typeof globalThis & {
  __fileSystemBrandself?: Queue
  __fileMaintenanceBrandself?: Queue
  __fileEmailsNotificationsBrandself?: Queue
  __fileIaBrandself?: Queue
}

function createQueue(name: string): Queue {
  return new Queue(name, { connection: redis })
}

export function getSystemQueue(): Queue {
  const queue = g.__fileSystemBrandself ?? createQueue(FILE_SYSTEM)
  g.__fileSystemBrandself = queue
  return queue
}

export function getMaintenanceQueue(): Queue {
  const queue = g.__fileMaintenanceBrandself ?? createQueue(FILE_MAINTENANCE)
  g.__fileMaintenanceBrandself = queue
  return queue
}

/** E-mails de notification (outbox). Les OTP ont leur propre file, sans limiteur. */
export function getEmailsNotificationsQueue(): Queue {
  const queue = g.__fileEmailsNotificationsBrandself ?? createQueue(FILE_EMAILS_NOTIFICATIONS)
  g.__fileEmailsNotificationsBrandself = queue
  return queue
}

export function getIaQueue(): Queue {
  const queue = g.__fileIaBrandself ?? createQueue(FILE_IA)
  g.__fileIaBrandself = queue
  return queue
}
