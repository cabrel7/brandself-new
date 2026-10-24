import { Worker } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../shared/env'
import { FILE_SYSTEME, JOBS } from '../shared/jobs'

const connexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

const worker = new Worker(
  FILE_SYSTEME,
  async (job) => {
    if (job.name === JOBS.ping) {
      console.info(`[worker] ping traité (job ${job.id})`)
      return { pong: true, traiteA: new Date().toISOString() }
    }
    throw new Error(`Job inconnu : ${job.name}`)
  },
  { connection: connexion },
)

worker.on('completed', (job) => {
  console.info(`[worker] job « ${job.name} » #${job.id} terminé`)
})

worker.on('failed', (job, erreur) => {
  console.error(`[worker] job « ${job?.name} » échoué : ${erreur.message}`)
})

console.info(`[worker] démarré sur la file « ${FILE_SYSTEME} » (${env.REDIS_URL})`)

async function arreter(signal: string): Promise<void> {
  console.info(`[worker] arrêt (${signal})…`)
  await worker.close()
  connexion.disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void arreter('SIGINT'))
process.on('SIGTERM', () => void arreter('SIGTERM'))
