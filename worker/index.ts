import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import Redis from 'ioredis'
import { env, resolveIaFournisseur } from '../shared/env'
import { assertConfigPaiements } from '../server/config/paiements'
import { IA_BASE_URL_DEFAUT, IA_CONCURRENCE_WORKER } from '../shared/ia'
import { schemaSeoJobData } from '../shared/schemas/ia'
import {
  EMAILS_NOTIFICATIONS_CONCURRENCE_WORKER,
  FILE_EMAILS_LEGACY,
  FILE_EMAILS_NOTIFICATIONS,
  FILE_IA,
  FILE_IA_FOND,
  FILE_MAINTENANCE,
  FILE_MESSAGES_AUTH,
  FILE_PAIEMENTS,
  FILE_SYSTEM,
  IA_FOND_CONCURRENCE_WORKER,
  IA_JOB_LOCK_MS,
  IA_JOB_MAX_STALLED,
  IA_PURGE_SCHEDULER_ID,
  JOBS,
  MAINTENANCE_CONCURRENCE_WORKER,
  MESSAGES_AUTH_CONCURRENCE_WORKER,
  PAIEMENTS_CONCURRENCE_WORKER,
  SYSTEM_CONCURRENCE_WORKER,
  iaJobDataSchema,
  transactionalEmailJobDataSchema,
} from '../shared/jobs'
import { EMAILS_DEBIT_FENETRE_MS, EMAILS_DEBIT_MAX, NOTIFICATIONS_PURGE_SCHEDULER_ID } from '../shared/notifications'
import { planifierPurge } from '../server/jobs/ia'
import { dispatchPendingTransactionalEmails } from '../server/jobs/email-outbox'
import { planifierVerificationsPaiements } from '../server/jobs/paiements'
import { planifierNotificationsRepetees, planifierPurgeNotifications } from '../server/jobs/notifications'
import { planifierPurgeIndisponibilites } from '../server/jobs/indisponibilites'
import { planifierPurgeOauth } from '../server/jobs/oauth'
import { traiterRafraichirCacheMedias } from '../server/jobs/rafraichir-cache-medias'
import { planifierPurgeWebhooksRefuses } from '../server/jobs/webhooks-refuses'
import { planifierAgregationStatistiques, planifierPurgeStatistiques } from '../server/jobs/statistiques'
import { processTransactionalEmail } from '../server/services/email-outbox'
import { planifierNotifications } from '../server/services/notifications/planification'
import { purgeOutbox } from '../server/services/notifications/purge'
import { executeGeneration, purgeGenerations } from '../server/services/ia/generations'
import { createIaProvider } from '../server/services/ia/fournisseurs'
import { regenererSeoVitrine } from '../server/services/ia/seo'
import type { ExecutionDeps } from '../server/services/ia/types'
import { purgerIndisponibilites } from '../server/services/indisponibilites-purge'
import { purgerOauth } from '../server/services/oauth-purge'
import { purgerWebhooksRefuses } from '../server/services/webhooks-refuses'
import { agregerStatistiques, purgerStatistiques } from '../server/services/statistiques'
import { verifierPaiementsDus } from '../server/services/abonnements'
import { purgeProgressionsAbandonnees } from '../server/services/onboarding'
import { cleIdempotenceOtp, processOtpJob as processOtpJobData } from '../server/jobs/otp'
import { processAdminReauthEmailJob } from '../server/jobs/admin-reauth'

const OUTBOX_POLL_INTERVAL_MS = 5_000

// S10 : même validation qu'au démarrage du serveur (en production, des prix `a_valider` empêchent de démarrer).
assertConfigPaiements(env)

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
    // S9 : tick de planification des e-mails récurrents (5 min). Nombres seulement dans les journaux.
    if (job.name === JOBS.planifierNotifications) {
      const planifiees = await planifierNotifications(new Date())
      console.info(
        `[worker] notifications planifiées : ${planifiees.resumes} résumé(s), ${planifiees.rappelsJour} rendez-vous du jour`,
      )
      return
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  { connection: createConnection(), concurrency: SYSTEM_CONCURRENCE_WORKER },
)

// Maintenance : purges quotidiennes, lentes et jamais urgentes. Isolées pour ne retarder ni le tick de
// planification (`system`) ni les générations IA (`ia`).
const workerMaintenance = new Worker(
  FILE_MAINTENANCE,
  async (job) => {
    if (job.name === JOBS.purgerNotifications) {
      const purgees = await purgeOutbox(new Date())
      console.info(`[worker] purge notifications : ${purgees} ligne(s) supprimée(s)`)
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
    // S11 : agrégation puis purge des statistiques (aucune donnée personnelle dans le journal).
    if (job.name === JOBS.agregerStatistiques) {
      await agregerStatistiques(new Date())
      console.info('[worker] statistiques agrégées (STATISTIQUES_AGREGEES)')
      return
    }
    if (job.name === JOBS.purgerStatistiques) {
      await purgerStatistiques(new Date())
      console.info('[worker] statistiques purgées (STATISTIQUES_PURGEES)')
      return
    }
    // S16 : clients OAuth orphelins, assertions et jetons expirés (nombres seulement dans le journal).
    if (job.name === JOBS.purgerOauth) {
      const bilan = await purgerOauth(new Date())
      console.info(
        `[worker] purge OAuth : ${bilan.clients} client(s), ${bilan.assertions} assertion(s), ${bilan.jetonsAcces} jeton(s) d'accès, ${bilan.jetonsRenouvellement} jeton(s) de renouvellement supprimé(s)`,
      )
      return
    }
    // Indisponibilités de plus de 90 jours (nombre seulement dans le journal : la raison saisie peut être personnelle).
    if (job.name === JOBS.purgerIndisponibilites) {
      const purgees = await purgerIndisponibilites(new Date())
      console.info(`[worker] purge indisponibilités : ${purgees} ligne(s) supprimée(s)`)
      return
    }
    // A3 : compteur des webhooks refusés de plus de 90 jours (nombre seulement dans le journal).
    if (job.name === JOBS.purgerWebhooksRefuses) {
      const purgees = await purgerWebhooksRefuses(new Date())
      console.info(`[worker] purge webhooks refusés : ${purgees} ligne(s) supprimée(s)`)
      return
    }
    // Éviction du cache nginx des images d'un compte suspendu / bloqué / rétabli (nombres seulement dans le journal).
    if (job.name === JOBS.rafraichirCacheMedias) {
      const bilan = await traiterRafraichirCacheMedias(job.data)
      if (!bilan.saute) {
        console.info(`[worker] cache des images : ${bilan.demandees} variante(s) redemandée(s), ${bilan.erreurs} en échec`)
      }
      return
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  { connection: createConnection(), concurrency: MAINTENANCE_CONCURRENCE_WORKER },
)

// Le traitement vit dans server/jobs/otp.ts (testable) ; la clé d'idempotence (file du job + id + instant de mise en
// file) est celle du job : un essai répété du même job réutilise sa clé, deux jobs distincts n'en partagent jamais.
async function processOtpJob(job: Job): Promise<void> {
  // A1 : le code de réauthentification de l'administrateur partage la file des codes de connexion (jamais de limiteur).
  if (job.name === JOBS.sendAdminReauthEmail) {
    await processAdminReauthEmailJob(job.data)
    return
  }
  await processOtpJobData(job.name, job.data, cleIdempotenceOtp(job.queueName, job.id, job.timestamp))
}

async function processNotificationEmailJob(job: Job): Promise<void> {
  if (job.name !== JOBS.sendTransactionalEmail) throw new Error(`Unknown job: ${job.name}`)
  const data = transactionalEmailJobDataSchema.parse(job.data)
  await processTransactionalEmail(data.outboxId)
}

// Authentification : OTP e-mail et SMS, SANS limiteur de débit (le code de connexion ne doit jamais attendre).
const workerMessagesAuth = new Worker(
  FILE_MESSAGES_AUTH,
  processOtpJob,
  { connection: createConnection(), concurrency: MESSAGES_AUTH_CONCURRENCE_WORKER },
)

// S9 #92 : e-mails de notification (outbox), AVEC débit d'envoi (quota Resend). Les 429 suivent le chemin
// d'essai existant de l'outbox.
const emailDispatchQueue = new Queue(FILE_EMAILS_NOTIFICATIONS, { connection: createConnection() })

const workerEmailsNotifications = new Worker(
  FILE_EMAILS_NOTIFICATIONS,
  processNotificationEmailJob,
  {
    connection: createConnection(),
    concurrency: EMAILS_NOTIFICATIONS_CONCURRENCE_WORKER,
    limiter: { max: EMAILS_DEBIT_MAX, duration: EMAILS_DEBIT_FENETRE_MS },
  },
)

// TRANSITION (une release) : vide l'ancienne file unique `emails` (OTP + outbox) sur laquelle des jobs ont pu
// être enfilés par l'ancienne version juste avant le déploiement. Aucun producteur n'y écrit plus. Retirer ce
// worker à la release suivante (voir docs/specs/S9-notifications.md, notes de déploiement).
const workerEmailsLegacy = new Worker(
  FILE_EMAILS_LEGACY,
  async (job) => {
    if (job.name === JOBS.sendTransactionalEmail) {
      await processNotificationEmailJob(job)
      return
    }
    await processOtpJob(job)
  },
  {
    connection: createConnection(),
    limiter: { max: EMAILS_DEBIT_MAX, duration: EMAILS_DEBIT_FENETRE_MS },
  },
)

// S10 : rapprochement des paiements (tick de 10 s) : expiration locale puis interrogation d'un lot borné, dans le
// budget global d'appels du fournisseur. Seuls les bilans non nuls sont journalisés.
const workerPaiements = new Worker(
  FILE_PAIEMENTS,
  async (job) => {
    if (job.name !== JOBS.verifierPaiements) throw new Error(`Unknown job: ${job.name}`)
    const bilan = await verifierPaiementsDus(new Date())
    if (bilan.expires + bilan.reclames + bilan.appliques + bilan.erreurs > 0) {
      console.info(
        `[worker] paiements : ${bilan.expires} expiré(s), ${bilan.reclames} réclamé(s), ${bilan.appliques} appliqué(s), ${bilan.erreurs} erreur(s)`,
      )
    }
  },
  { connection: createConnection(), concurrency: PAIEMENTS_CONCURRENCE_WORKER },
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
if (fournisseurIa === 'openai') {
  // Fournisseur compatible OpenAI : on journalise le modèle et l'hôte seulement (ni la clé, ni l'URL complète).
  console.info(`[worker] IA compatible OpenAI : modèle ${env.IA_MODELE}, hôte ${new URL(env.IA_BASE_URL ?? IA_BASE_URL_DEFAUT).host}`)
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
    throw new Error(`Unknown job: ${job.name}`)
  },
  {
    connection: createConnection(),
    concurrency: IA_CONCURRENCE_WORKER,
    lockDuration: IA_JOB_LOCK_MS,
    maxStalledCount: IA_JOB_MAX_STALLED,
  },
)

// Décision #24 : file `ia-fond`, à part de `ia`. Régénération du SEO d'une vitrine (job différé de 5 minutes),
// une à la fois ; mêmes dépendances (fournisseur, horloge) que `ia`. Le job ne porte qu'un identifiant de vitrine.
const workerIaFond = new Worker(
  FILE_IA_FOND,
  async (job) => {
    if (job.name === JOBS.regenererSeoIa) {
      const data = schemaSeoJobData.parse(job.data)
      await regenererSeoVitrine(data.vitrineId, iaDeps)
      return
    }
    throw new Error(`Unknown job: ${job.name}`)
  },
  {
    connection: createConnection(),
    concurrency: IA_FOND_CONCURRENCE_WORKER,
    lockDuration: IA_JOB_LOCK_MS,
    maxStalledCount: IA_JOB_MAX_STALLED,
  },
)

for (const worker of [workerSystem, workerMaintenance, workerMessagesAuth, workerEmailsNotifications, workerEmailsLegacy, workerIa, workerIaFond]) {
  worker.on('completed', (job) => {
    console.info(`[worker] job « ${job.name} » #${job.id} completed`)
  })
  worker.on('failed', (job) => {
    console.error(`[worker] job « ${job?.name} » #${job?.id} failed (JOB_FAILED)`)
  })
}

workerPaiements.on('failed', (job) => {
  console.error(`[worker] job « ${job?.name} » #${job?.id} failed (JOB_FAILED)`)
})

const systemQueue = new Queue(FILE_SYSTEM, { connection: createConnection() })
const maintenanceQueue = new Queue(FILE_MAINTENANCE, { connection: createConnection() })
const paiementsQueue = new Queue(FILE_PAIEMENTS, { connection: createConnection() })

// TRANSITION (une release) : les deux purges vivaient sur `ia` et `system`. On retire ces anciens
// ordonnanceurs (et leur prochain job différé) avant de poser les nouveaux sur `maintenance`. Idempotent :
// `false` si l'ordonnanceur n'existe déjà plus.
Promise.all([
  iaQueue.removeJobScheduler(IA_PURGE_SCHEDULER_ID),
  systemQueue.removeJobScheduler(NOTIFICATIONS_PURGE_SCHEDULER_ID),
]).catch(() => {
  console.error('[worker] legacy purge schedulers cleanup failed (LEGACY_SCHEDULERS_CLEANUP_FAILED)')
})

// Purges quotidiennes sur la file `maintenance` ; idempotents au redémarrage.
planifierPurge(maintenanceQueue).catch(() => {
  console.error('[worker] IA purge scheduling failed (IA_PURGE_SCHEDULE_FAILED)')
})
planifierPurgeNotifications(maintenanceQueue).catch(() => {
  console.error('[worker] notifications purge scheduling failed (NOTIFICATIONS_PURGE_SCHEDULE_FAILED)')
})
// S11 : agrégation (11:00 UTC) et purge (05:00 UTC) des statistiques sur la même file ; sans cet
// ordonnanceur, `statistiques_jour_*` n'est jamais écrit et la lecture hybride renvoie toujours zéro.
planifierAgregationStatistiques(maintenanceQueue).catch(() => {
  console.error('[worker] statistics aggregation scheduling failed (STATISTIQUES_AGREGATION_SCHEDULE_FAILED)')
})
planifierPurgeStatistiques(maintenanceQueue).catch(() => {
  console.error('[worker] statistics purge scheduling failed (STATISTIQUES_PURGE_SCHEDULE_FAILED)')
})

planifierPurgeOauth(maintenanceQueue).catch(() => {
  console.error('[worker] OAuth purge scheduling failed (OAUTH_PURGE_SCHEDULE_FAILED)')
})

planifierPurgeIndisponibilites(maintenanceQueue).catch(() => {
  console.error('[worker] unavailability purge scheduling failed (INDISPONIBILITES_PURGE_SCHEDULE_FAILED)')
})

planifierPurgeWebhooksRefuses(maintenanceQueue).catch(() => {
  console.error('[worker] refused webhooks purge scheduling failed (WEBHOOKS_REFUSES_PURGE_SCHEDULE_FAILED)')
})

// S9 : tick de planification sur la file `system`, idempotent au redémarrage.
planifierNotificationsRepetees(systemQueue).catch(() => {
  console.error('[worker] notifications scheduling failed (NOTIFICATIONS_SCHEDULE_FAILED)')
})

planifierVerificationsPaiements(paiementsQueue).catch(() => {
  console.error('[worker] payments scheduling failed (PAYMENTS_SCHEDULE_FAILED)')
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
  `[worker] started — queues « ${FILE_SYSTEM} », « ${FILE_MAINTENANCE} », « ${FILE_MESSAGES_AUTH} », « ${FILE_EMAILS_NOTIFICATIONS} », « ${FILE_IA} », « ${FILE_IA_FOND} », « ${FILE_PAIEMENTS} » and legacy « ${FILE_EMAILS_LEGACY} » (IA provider: ${fournisseurIa})`,
)

async function stop(signal: string): Promise<void> {
  console.info(`[worker] stopping (${signal})…`)
  clearInterval(dispatchTimer)
  try {
    await Promise.all([
      workerSystem.close(),
      workerMaintenance.close(),
      workerMessagesAuth.close(),
      workerEmailsNotifications.close(),
      workerEmailsLegacy.close(),
      workerIa.close(),
      workerIaFond.close(),
      workerPaiements.close(),
      paiementsQueue.close(),
      emailDispatchQueue.close(),
      iaQueue.close(),
      systemQueue.close(),
      maintenanceQueue.close(),
    ])
    process.exit(0)
  } catch {
    console.error('[worker] shutdown failed (WORKER_SHUTDOWN_FAILED)')
    process.exit(1)
  }
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
