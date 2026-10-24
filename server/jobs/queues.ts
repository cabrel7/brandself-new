import { Queue } from 'bullmq'
import { FILE_SYSTEME } from '../../shared/jobs'
import { redis } from '../utils/redis'

const g = globalThis as typeof globalThis & { __fileSystemeBrandself?: Queue }

function creerFileSysteme(): Queue {
  return new Queue(FILE_SYSTEME, { connection: redis })
}

export function getFileSysteme(): Queue {
  const file = g.__fileSystemeBrandself ?? creerFileSysteme()
  g.__fileSystemeBrandself = file
  return file
}
