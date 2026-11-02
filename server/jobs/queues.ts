import { Queue } from 'bullmq'
import { FILE_SYSTEM, FILE_EMAILS, FILE_IA } from '../../shared/jobs'
import { redis } from '../utils/redis'

const g = globalThis as typeof globalThis & {
  __fileSystemBrandself?: Queue
  __fileEmailsBrandself?: Queue
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

export function getEmailsQueue(): Queue {
  const queue = g.__fileEmailsBrandself ?? createQueue(FILE_EMAILS)
  g.__fileEmailsBrandself = queue
  return queue
}

export function getIaQueue(): Queue {
  const queue = g.__fileIaBrandself ?? createQueue(FILE_IA)
  g.__fileIaBrandself = queue
  return queue
}
