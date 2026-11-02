import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { env, resolveIaFournisseur } from '../shared/env'
import { IA_CONCURRENCE_WORKER } from '../shared/ia'
import type { OtpJobData } from '../shared/jobs'
import {
  FILE_EMAILS,
  FILE_IA,
  FILE_SYSTEM,
  IA_JOB_LOCK_MS,
  IA_JOB_MAX_STALLED,
  JOBS,
  iaJobDataSchema,
  transactionalEmailJobDataSchema,
} from '../shared/jobs'
import { planifierPurge } from '../server/jobs/ia'
import { dispatchPendingTransactionalEmails } from '../server/jobs/email-outbox'
import { processTransactionalEmail } from '../server/services/email-outbox'
import { executeGeneration, purgeGenerations } from '../server/services/ia/generations'
import { createIaProvider } from '../server/services/ia/fournisseurs'
import type { ExecutionDeps } from '../server/services/ia/types'
import { purgeProgressionsAbandonnees } from '../server/services/onboarding'
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

// S8 : file `ia`. Le worker est le SEUL processus qui lit la clé du fournisseur (createIaProvider).
// Le journal de démarrage donne le fournisseur résolu, jamais la clé.
const fournisseurIa = resolveIaFournisseur(env)
const iaDeps: ExecutionDeps = {
  provider: createIaProvider(env),
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
if (fournisseurIa === 'aucun') {
  console.warn('[worker] aucun fournisseur IA configuré : les générations serviront le texte de repli (IA_SANS_FOURNISSEUR)')
}

const iaQueue = new Queue(FILE_IA, { connection: createConnection() })

const workerIa = new Worker(
  FILE_IA,
  async (job) => {
    if (job.name === JOBS.genererIa) {
      const data = iaJobDataSchema.parse(job.data)
      await executeGeneration(data.generationId, iaDeps)
      return
    }
    if (job.name === JOBS.purgerIa) {
      const purgees = await purgeGenerations()
      console.info(`[worker] purge IA : ${purgees} génération(s) purgée(s)`)
      // Même job quotidien : les inscriptions abandonnées (rétention des données personnelles, 90 jours).
      const abandonnees = await purgeProgressionsAbandonnees()
      console.info(`[worker] purge inscriptions : ${abandonnees} progression(s) abandonnée(s) supprimée(s)`)
      return
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  {
    connection: createConnection(),
    concurrency: IA_CONCURRENCE_WORKER,
    lockDuration: IA_JOB_LOCK_MS,
    maxStalledCount: IA_JOB_MAX_STALLED,
  },
)

for (const worker of [workerSystem, workerEmails, workerIa]) {
  worker.on('completed', (job) => {
    console.info(`[worker] job « ${job.name} » #${job.id} completed`)
  })
  worker.on('failed', (job) => {
    console.error(`[worker] job « ${job?.name} » #${job?.id} failed (JOB_FAILED)`)
  })
}

planifierPurge(iaQueue).catch(() => {
  console.error('[worker] IA purge scheduling failed (IA_PURGE_SCHEDULE_FAILED)')
})

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

console.info(
  `[worker] started — queues « ${FILE_SYSTEM} », « ${FILE_EMAILS} » and « ${FILE_IA} » (IA provider: ${fournisseurIa})`,
)

async function stop(signal: string): Promise<void> {
  console.info(`[worker] stopping (${signal})…`)
  clearInterval(dispatchTimer)
  try {
    await Promise.all([
      workerSystem.close(),
      workerEmails.close(),
      workerIa.close(),
      emailDispatchQueue.close(),
      iaQueue.close(),
    ])
    process.exit(0)
  } catch {
    console.error('[worker] shutdown failed (WORKER_SHUTDOWN_FAILED)')
    process.exit(1)
  }
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
