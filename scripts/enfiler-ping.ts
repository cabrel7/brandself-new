import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../shared/env'
import { FILE_SYSTEME, JOBS } from '../shared/jobs'

const connexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
const file = new Queue(FILE_SYSTEME, { connection: connexion })

const job = await file.add(JOBS.ping, { emisA: new Date().toISOString() })
console.info(`Job « ${JOBS.ping} » #${job.id} ajouté à la file « ${FILE_SYSTEME} ».`)

await file.close()
connexion.disconnect()
process.exit(0)
