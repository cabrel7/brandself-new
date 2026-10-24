import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { redis } from '../utils/redis'

export interface EtatSante {
  statut: 'ok' | 'degrade'
  base: boolean
  redis: boolean
  version: string
}

async function verifierBase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`)
    return true
  } catch {
    return false
  }
}

async function verifierRedis(): Promise<boolean> {
  try {
    const reponse = await redis.ping()
    return reponse === 'PONG'
  } catch {
    return false
  }
}

export async function verifierSante(version: string): Promise<EtatSante> {
  const [base, redisOk] = await Promise.all([verifierBase(), verifierRedis()])
  return {
    statut: base && redisOk ? 'ok' : 'degrade',
    base,
    redis: redisOk,
    version,
  }
}
