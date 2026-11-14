import { Queue } from 'bullmq'
import { FILE_EMAILS_NOTIFICATIONS, FILE_IA, FILE_IA_FOND, FILE_MAINTENANCE, FILE_MESSAGES_AUTH, FILE_SYSTEM } from '../../shared/jobs'
import { redis } from '../utils/redis'

// Les OTP de connexion sont produits par server/auth.config.ts (fichier limité à node_modules et shared/, il ne peut
// pas importer ce module). La file `messages-auth` n'est reprise ici que pour le code de réauthentification (A1).
const g = globalThis as typeof globalThis & {
  __fileSystemBrandself?: Queue
  __fileMaintenanceBrandself?: Queue
  __fileEmailsNotificationsBrandself?: Queue
  __fileIaBrandself?: Queue
  __fileIaFondBrandself?: Queue
  __fileMessagesAuthBrandself?: Queue
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

/** Décision #24 : régénération du SEO en tâche de fond, à part de `ia` (onboarding, sensible à la latence). */
export function getIaFondQueue(): Queue {
  const queue = g.__fileIaFondBrandself ?? createQueue(FILE_IA_FOND)
  g.__fileIaFondBrandself = queue
  return queue
}

/** A1 : code de réauthentification de l'administrateur (même file que les OTP, jamais de limiteur de débit). */
export function getMessagesAuthQueue(): Queue {
  const queue = g.__fileMessagesAuthBrandself ?? createQueue(FILE_MESSAGES_AUTH)
  g.__fileMessagesAuthBrandself = queue
  return queue
}
