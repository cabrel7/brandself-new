import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAILS_NOTIFICATIONS_CONCURRENCE_WORKER,
  FILE_EMAILS_LEGACY,
  FILE_EMAILS_NOTIFICATIONS,
  FILE_IA,
  FILE_MAINTENANCE,
  FILE_MESSAGES_AUTH,
  FILE_SYSTEM,
  MESSAGES_AUTH_CONCURRENCE_WORKER,
} from '../../shared/jobs'
import { DESABONNEMENT_ACTION_LIMIT, DESABONNEMENT_APERCU_LIMIT } from '../../shared/limites'
import { HEURE_MS, JOUR_MS, MS_PAR_SECONDE, SECONDES_PAR_JOUR } from '../../shared/temps'

// Séparation des files : une opération sensible à la latence (OTP) n'attend jamais derrière une opération
// lente ou limitée en débit (e-mails de notification, purges, IA). worker/index.ts est un script de démarrage
// non importable : le câblage se lit dans la source.

const RACINE = path.resolve(import.meta.dirname, '../..')
const lire = (fichier: string): string => readFileSync(path.join(RACINE, fichier), 'utf-8')

/** Texte d'un `new Worker(` jusqu'au suivant : contient la file, le processeur et les options. */
function blocWorker(source: string, fichier: string): string {
  const blocs = source.split('new Worker(').slice(1)
  const trouve = blocs.find((bloc) => bloc.trimStart().startsWith(fichier))
  if (trouve === undefined) throw new Error(`Aucun worker pour ${fichier}`)
  // Le `new Worker(` se ferme par une parenthèse en colonne 0.
  return trouve.split('\n)\n')[0] ?? trouve
}

describe('noms et constantes des files', () => {
  it('should give every queue its own name', () => {
    const noms = [FILE_SYSTEM, FILE_MAINTENANCE, FILE_MESSAGES_AUTH, FILE_EMAILS_NOTIFICATIONS, FILE_IA, FILE_EMAILS_LEGACY]
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('should keep the legacy name only for the transition drain', () => {
    expect(FILE_EMAILS_LEGACY).toBe('emails')
    expect(FILE_MESSAGES_AUTH).not.toBe(FILE_EMAILS_LEGACY)
    expect(FILE_EMAILS_NOTIFICATIONS).not.toBe(FILE_EMAILS_LEGACY)
  })

  it('should process OTP in parallel and notification e-mails one at a time (the limiter sets the rate)', () => {
    expect(MESSAGES_AUTH_CONCURRENCE_WORKER).toBeGreaterThan(1)
    expect(EMAILS_NOTIFICATIONS_CONCURRENCE_WORKER).toBe(1)
  })
})

describe('câblage du worker', () => {
  const worker = lire('worker/index.ts')

  it('should not rate-limit the authentication queue (OTP)', () => {
    const bloc = blocWorker(worker, 'FILE_MESSAGES_AUTH')
    expect(bloc).not.toContain('limiter')
    expect(bloc).toContain('MESSAGES_AUTH_CONCURRENCE_WORKER')
  })

  it('should rate-limit the notification e-mail queue', () => {
    const bloc = blocWorker(worker, 'FILE_EMAILS_NOTIFICATIONS')
    expect(bloc).toContain('limiter: { max: EMAILS_DEBIT_MAX, duration: EMAILS_DEBIT_FENETRE_MS }')
  })

  it('should route OTP jobs only to the authentication worker and outbox jobs only to the notification worker', () => {
    expect(worker).toContain('processOtpJob,')
    expect(worker).toMatch(/FILE_EMAILS_NOTIFICATIONS,\s+processNotificationEmailJob,/)
    expect(worker).toMatch(/FILE_MESSAGES_AUTH,\s+processOtpJob,/)
  })

  it('should keep purges off the ia and system queues', () => {
    const maintenance = blocWorker(worker, 'FILE_MAINTENANCE')
    expect(maintenance).toContain('JOBS.purgerIa')
    expect(maintenance).toContain('JOBS.purgerNotifications')
    expect(blocWorker(worker, 'FILE_IA')).not.toContain('purge')
    expect(blocWorker(worker, 'FILE_SYSTEM')).not.toContain('purge')
  })

  it('should drain the legacy queue during the transition release and clean the old purge schedulers', () => {
    expect(worker).toMatch(/new Worker\(\s+FILE_EMAILS_LEGACY,/)
    expect(worker).toContain('iaQueue.removeJobScheduler(IA_PURGE_SCHEDULER_ID)')
    expect(worker).toContain('systemQueue.removeJobScheduler(NOTIFICATIONS_PURGE_SCHEDULER_ID)')
    expect(worker).toContain('planifierPurge(maintenanceQueue)')
    expect(worker).toContain('planifierPurgeNotifications(maintenanceQueue)')
  })
})

describe('producteurs', () => {
  it('should enqueue OTP on the authentication queue and nothing else there', () => {
    const auth = lire('server/auth.config.ts')
    expect(auth).toContain('new Queue(FILE_MESSAGES_AUTH')
    expect(auth).not.toContain('FILE_EMAILS')
  })

  it('should no longer write to the legacy queue', () => {
    const queues = lire('server/jobs/queues.ts')
    expect(queues).not.toContain('FILE_EMAILS_LEGACY')
    expect(queues).toContain('FILE_EMAILS_NOTIFICATIONS')
  })
})

describe('constantes de temps partagées', () => {
  it('should derive every duration from the same base', () => {
    expect(MS_PAR_SECONDE).toBe(1_000)
    expect(HEURE_MS).toBe(3_600_000)
    expect(JOUR_MS).toBe(86_400_000)
    expect(SECONDES_PAR_JOUR).toBe(86_400)
  })

  it('should not redefine them in the services', () => {
    for (const fichier of [
      'server/services/desabonnement.ts',
      'server/services/notifications/pertinence.ts',
      'server/services/notifications/planification.ts',
      'server/services/notifications/purge.ts',
    ]) {
      expect(lire(fichier), fichier).not.toMatch(/^const (HEURE_MS|JOUR_MS|SECONDES_PAR_JOUR|MS_PAR_SECONDE)\b/m)
    }
  })
})

describe('budgets du désabonnement', () => {
  it('should give the preview (GET) a wider budget than the action (POST)', () => {
    expect(DESABONNEMENT_APERCU_LIMIT.limit).toBeGreaterThan(DESABONNEMENT_ACTION_LIMIT.limit)
    expect(DESABONNEMENT_ACTION_LIMIT).toEqual({ limit: 20, windowS: 60 })
    expect(DESABONNEMENT_APERCU_LIMIT).toEqual({ limit: 60, windowS: 60 })
  })
})
