import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { FILE_MESSAGES_AUTH, JOBS } from '../../shared/jobs'
import { lireEnv } from './session'

// Réauthentification d'une écriture d'administration (A1 D-A1-08), côté navigateur : l'interface envoie le code par
// e-mail (job `messages-auth`). Le test met la file en pause le temps de la lecture (aucun worker n'emporte le job),
// retient les jobs déjà présents (reliquats d'un run précédent) pour ne lire que le code DEMANDÉ par l'interface, puis
// remplit les six cases du champ de code (reka-ui PinInput : des `input[inputmode="numeric"]`, pas un seul champ).

const ATTENTE_JOB_MS = 15_000
const INTERVALLE_MS = 100
const ETATS = ['wait', 'paused', 'delayed', 'active', 'prioritized', 'completed', 'failed'] as const

let redis: Redis | undefined
let file: Queue | undefined

function fileAuth(): Queue {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  file ??= new Queue(FILE_MESSAGES_AUTH, { connection: redis })
  return file
}

export async function fermerReauth(): Promise<void> {
  await file?.close()
  await redis?.quit()
  file = undefined
  redis = undefined
}

async function identifiantsExistants(): Promise<Set<string>> {
  const jobs = await fileAuth().getJobs([...ETATS], 0, -1)
  return new Set(jobs.map((j) => String(j.id)))
}

async function attendreNouveauCode(avant: ReadonlySet<string>): Promise<string> {
  const fin = Date.now() + ATTENTE_JOB_MS
  for (;;) {
    const jobs = await fileAuth().getJobs([...ETATS], 0, -1)
    const nouveau = jobs.find((j) => j.name === JOBS.sendAdminReauthEmail && !avant.has(String(j.id)) && typeof (j.data as { code?: unknown }).code === 'string')
    if (nouveau) return (nouveau.data as { code: string }).code
    if (Date.now() > fin) throw new Error('Aucun code de réauthentification demandé par l’interface.')
    await new Promise((resolve) => setTimeout(resolve, INTERVALLE_MS))
  }
}

/**
 * Clique « Recevoir le code » dans `zone`, lit le code envoyé (file en pause) et le saisit dans les six cases.
 * `zone` est le panneau ou la boîte de dialogue qui contient la confirmation.
 */
export async function demanderEtSaisirCode(zone: Locator): Promise<void> {
  const file = fileAuth()
  await file.pause()
  try {
    const avant = await identifiantsExistants()
    await zone.getByRole('button', { name: 'Recevoir le code' }).click()
    const code = await attendreNouveauCode(avant)
    // Les six cases du champ de code (d'autres champs numériques peuvent exister dans la zone : on se limite au champ de code).
    const cases = zone.getByLabel('Code de confirmation à 6 chiffres').locator('input[inputmode="numeric"]')
    await expect(cases).toHaveCount(code.length)
    // Le premier reçoit le focus, la frappe avance seule de case en case.
    await cases.first().click()
    await zone.page().keyboard.type(code)
    await expect(cases.last()).toHaveValue(code.slice(-1))
  } finally {
    await file.resume()
  }
}
