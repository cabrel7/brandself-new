import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../shared/env'
import type { OtpJobData } from '../shared/jobs'
import { FILE_EMAILS, FILE_SYSTEM, JOBS, transactionalEmailJobDataSchema } from '../shared/jobs'
import { dispatchPendingTransactionalEmails } from '../server/jobs/email-outbox'
import { processTransactionalEmail } from '../server/services/email-outbox'
import { senderOtpEmail, senderOtpSms } from '../server/services/otp/envoi'

const OUTBOX_POLL_INTERVAL_MS = 5_000

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

const emailDispatchQueue = new Queue(FILE_EMAILS, { connection: createConnection() })

const workerEmails = new Worker(
  FILE_EMAILS,
  async (job) => {
    if (job.name === JOBS.sendTransactionalEmail) {
      const data = transactionalEmailJobDataSchema.parse(job.data)
      await processTransactionalEmail(data.outboxId)
      return
    }
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
  worker.on('failed', (job) => {
    console.error(`[worker] job « ${job?.name} » #${job?.id} failed (JOB_FAILED)`)
  })
}

let dispatchRunning = false
async function dispatchOutbox(): Promise<void> {
  if (dispatchRunning) return
  dispatchRunning = true
  try {
    await dispatchPendingTransactionalEmails(emailDispatchQueue)
  }
  catch {
    console.error('[worker] transactional email dispatch failed (OUTBOX_DISPATCH_FAILED)')
  }
  finally {
    dispatchRunning = false
  }
}

const dispatchTimer = setInterval(() => void dispatchOutbox(), OUTBOX_POLL_INTERVAL_MS)
dispatchTimer.unref()
void dispatchOutbox()

console.info(`[worker] started — queues « ${FILE_SYSTEM} » and « ${FILE_EMAILS} »`)

async function stop(signal: string): Promise<void> {
  console.info(`[worker] stopping (${signal})…`)
  clearInterval(dispatchTimer)
  try {
    await Promise.all([workerSystem.close(), workerEmails.close(), emailDispatchQueue.close()])
    process.exit(0)
  } catch {
    console.error('[worker] shutdown failed (WORKER_SHUTDOWN_FAILED)')
    process.exit(1)
  }
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
