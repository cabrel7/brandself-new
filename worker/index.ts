import { Worker } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../shared/env'
import type { OtpJobData } from '../shared/jobs'
import { FILE_EMAILS, FILE_SYSTEM, JOBS } from '../shared/jobs'
import { senderOtpEmail, senderOtpSms } from '../server/services/otp/envoi'

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
}

const workerSystem = new Worker(
  FILE_SYSTEM,
  async (job) => {
    if (job.name === JOBS.ping) {
      console.info(`[worker] ping processed (job ${job.id})`)
      return { pong: true, processedAt: new Date().toISOString() }
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  { connection: createConnection() },
)

const workerEmails = new Worker(
  FILE_EMAILS,
  async (job) => {
    const data = job.data as OtpJobData
    if (job.name === JOBS.sendOtpEmail) {
      await senderOtpEmail.send(data.identifier, data.code)
      return
    }
    if (job.name === JOBS.sendOtpSms) {
      await senderOtpSms.send(data.identifier, data.code)
      return
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  { connection: createConnection() },
)

for (const worker of [workerSystem, workerEmails]) {
  worker.on('completed', (job) => {
    console.info(`[worker] job « ${job.name} » #${job.id} completed`)
  })
  worker.on('failed', (job, error) => {
    console.error(`[worker] job « ${job?.name} » failed: ${error.message}`)
  })
}

console.info(`[worker] started — queues « ${FILE_SYSTEM} » and « ${FILE_EMAILS} » (${env.REDIS_URL})`)

async function stop(signal: string): Promise<void> {
  console.info(`[worker] stopping (${signal})…`)
  await Promise.all([workerSystem.close(), workerEmails.close()])
  process.exit(0)
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
