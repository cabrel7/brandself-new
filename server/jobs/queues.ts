import { Queue } from 'bullmq'
import { FILE_EMAILS, FILE_SYSTEME } from '../../shared/jobs'
import { redis } from '../utils/redis'

const g = globalThis as typeof globalThis & {
  __fileSystemeBrandself?: Queue
  __fileEmailsBrandself?: Queue
}

function creerFile(nom: string): Queue {
  return new Queue(nom, { connection: redis })
}

export function getFileSysteme(): Queue {
  const file = g.__fileSystemeBrandself ?? creerFile(FILE_SYSTEME)
  g.__fileSystemeBrandself = file
  return file
}

export function getEmailsQueue(): Queue {
  const file = g.__fileEmailsBrandself ?? creerFile(FILE_EMAILS)
  g.__fileEmailsBrandself = file
  return file
}
