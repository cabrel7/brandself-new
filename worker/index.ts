import { Worker } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../shared/env'
import type { DonneesOtpJob } from '../shared/jobs'
import { FILE_EMAILS, FILE_SYSTEME, JOBS } from '../shared/jobs'
import { senderOtpEmail, senderOtpSms } from '../server/services/otp/envoi'

function creerConnexion(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
}

const workerSysteme = new Worker(
  FILE_SYSTEME,
  async (job) => {
    if (job.name === JOBS.ping) {
      console.info(`[worker] ping traité (job ${job.id})`)
      return { pong: true, traiteA: new Date().toISOString() }
    }
    throw new Error(`Job inconnu : ${job.name}`)
  },
  { connection: creerConnexion() },
)

const workerEmails = new Worker(
  FILE_EMAILS,
  async (job) => {
    const donnees = job.data as DonneesOtpJob
    if (job.name === JOBS.envoyerOtpEmail) {
      await senderOtpEmail.envoyer(donnees.identifiant, donnees.code)
      return
    }
    if (job.name === JOBS.envoyerOtpSms) {
      await senderOtpSms.envoyer(donnees.identifiant, donnees.code)
      return
    }
    throw new Error(`Job inconnu : ${job.name}`)
  },
  { connection: creerConnexion() },
)

for (const worker of [workerSysteme, workerEmails]) {
  worker.on('completed', (job) => {
    console.info(`[worker] job « ${job.name} » #${job.id} terminé`)
  })
  worker.on('failed', (job, erreur) => {
    console.error(`[worker] job « ${job?.name} » échoué : ${erreur.message}`)
  })
}

console.info(`[worker] démarré — files « ${FILE_SYSTEME} » et « ${FILE_EMAILS} » (${env.REDIS_URL})`)

async function arreter(signal: string): Promise<void> {
  console.info(`[worker] arrêt (${signal})…`)
  await Promise.all([workerSysteme.close(), workerEmails.close()])
  process.exit(0)
}

process.on('SIGINT', () => void arreter('SIGINT'))
process.on('SIGTERM', () => void arreter('SIGTERM'))
