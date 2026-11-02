import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Worker } from 'bullmq'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FILE_IA, IA_JOB_ID_PREFIXE, IA_PURGE_CRON, IA_PURGE_SCHEDULER_ID, IA_PURGE_TZ, JOBS, iaJobDataSchema } from '../../shared/jobs'
import { ENTREE_ONBOARDING_DEMO } from '../unit/support/ia-fixtures'
import { createUser, insertGeneration } from './support/fabriques'
import { creerGeneration, iaFaux, iaGenerations, jobsIa, lireGeneration, queuesJobs, reinitialiserIa } from './support/ia'

// S8 §5, §9 : vraie file BullMQ et vrai Worker sur Redis /15, exécuteur réel, faux fournisseur réel.
// Le processeur ci-dessous reproduit le routage décrit pour worker/index.ts (ia-generer → executeGeneration,
// ia-purger → purgeGenerations) ; worker/index.ts est un script de démarrage qui n'est pas importable.

const DELAI_MAX_MS = 10_000
const PAUSE_MS = 100

let connexion: Redis
let worker: Worker | undefined
let providerFaux: { appels: number } | undefined

async function attendre<T>(lire: () => Promise<T | undefined>): Promise<T> {
  const fin = Date.now() + DELAI_MAX_MS
  for (;;) {
    const valeur = await lire()
    if (valeur !== undefined) return valeur
    if (Date.now() > fin) throw new Error('Délai dépassé : la génération n’a pas été traitée par le worker.')
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
  }
}

async function demarrerWorker(): Promise<void> {
  const { executeGeneration, purgeGenerations } = await iaGenerations()
  const { creerFauxProvider } = await iaFaux()
  const provider = creerFauxProvider()
  providerFaux = provider
  worker = new Worker(
    FILE_IA,
    async (job) => {
      if (job.name === JOBS.genererIa) {
        const { generationId } = iaJobDataSchema.parse(job.data)
        await executeGeneration(generationId, { provider, now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) })
        return
      }
      if (job.name === JOBS.purgerIa) {
        await purgeGenerations(new Date())
        return
      }
      throw new Error(`Job inconnu : ${job.name}`)
    },
    { connection: connexion, concurrency: 4 },
  )
  await worker.waitUntilReady()
}

beforeAll(() => {
  connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
})

beforeEach(async () => {
  await reinitialiserIa()
})

afterEach(async () => {
  // Un worker laissé vivre d'un test à l'autre avale le job du test suivant
  // avant son assertion de comptage : on ferme à chaque fois.
  await worker?.close()
  worker = undefined
  providerFaux = undefined
})

afterAll(async () => {
  await worker?.close()
  connexion.disconnect()
})

describe('file ia et worker réels', () => {
  it('should process a created generation to « terminee » in less than 10 seconds (CA20)', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    await demarrerWorker()

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    const terminee = await attendre(async () => {
      const lue = await lireGeneration(ligne.id)
      return lue && lue.statut !== 'en_attente' && lue.statut !== 'en_cours' ? lue : undefined
    })
    expect(terminee).toMatchObject({ statut: 'terminee', fournisseur: 'faux', tentatives: 1 })
    expect(providerFaux?.appels).toBe(1)
  })

  it('should run a job only once even if the same generation is enqueued twice (deterministic job id, idempotent transition)', async () => {
    const { enqueueGeneration } = await jobsIa()
    const { getIaQueue } = await queuesJobs()
    const user = await createUser()
    const ligne = await insertGeneration(user.id)
    await enqueueGeneration(getIaQueue(), ligne.id)
    await enqueueGeneration(getIaQueue(), ligne.id)
    expect((await getIaQueue().getJobCounts('waiting', 'delayed', 'active')).waiting).toBe(1)
    await demarrerWorker()

    await attendre(async () => ((await lireGeneration(ligne.id))?.statut === 'terminee' ? true : undefined))

    expect(providerFaux?.appels).toBe(1)
  })

  it('should fall back (not stay pending) when the job asks for a generation that is in « panne » mode', async () => {
    const createGeneration = await creerGeneration()
    const { definirModeFaux } = await import('./support/ia')
    const user = await createUser()
    await definirModeFaux('panne')
    await demarrerWorker()

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    const repli = await attendre(async () => {
      const lue = await lireGeneration(ligne.id)
      return lue?.statut === 'repli' ? lue : undefined
    })
    expect(repli.motifRepli).toBe('echec_fournisseur')
  }, 30_000)

  it('should keep a job that carries a malformed payload out of the executor (strict schema, nothing personal in Redis)', () => {
    expect(iaJobDataSchema.safeParse({ generationId: randomUUID(), metier: 'Cardiologue' }).success).toBe(false)
    expect(IA_JOB_ID_PREFIXE).toBe('ia-generation-')
  })

  it('should register the daily purge once, at 03:00 UTC, even when planned twice (upsert)', async () => {
    const { planifierPurge } = await jobsIa()
    const { getIaQueue } = await queuesJobs()

    await planifierPurge(getIaQueue())
    await planifierPurge(getIaQueue())

    const planifications = await getIaQueue().getJobSchedulers()
    expect(planifications.filter((p) => p.key === IA_PURGE_SCHEDULER_ID)).toHaveLength(1)
    expect(planifications[0]).toMatchObject({ pattern: IA_PURGE_CRON, tz: IA_PURGE_TZ })
  })
})
