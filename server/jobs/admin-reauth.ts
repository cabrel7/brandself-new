// A1 (D-A1-08) : e-mail du code de réauthentification de l'administrateur.
// Producteur (après le commit de la ligne `admin_reauth`) et traitement (worker) vivent ici, testables.
// Le job porte l'identifiant de la ligne et le code à 6 chiffres ; l'adresse est RELUE en base. Le code n'est
// jamais écrit dans un journal, ni dans une erreur ; le job est supprimé de Redis dès qu'il est terminé.
import { sql } from 'drizzle-orm'
import { UnrecoverableError } from 'bullmq'
import type { JobsOptions, Queue } from 'bullmq'
import { ADMIN_REAUTH_TTL_S, SUPERADMIN } from '../../shared/admin'
import { env } from '../../shared/env'
import {
  JOBS,
  OTP_JOB_BACKOFF_MS,
  OTP_JOB_MAX_ATTEMPTS,
  adminReauthEmailJobDataSchema,
} from '../../shared/jobs'
import type { AdminReauthEmailJobData } from '../../shared/jobs'
import { buildAdminReauthEmail, libelleAction } from '../services/emails/admin-reauth-contenu'
import { EmailTransportError, transactionalEmailTransport } from '../services/emails/transport'
import type { EmailTransport } from '../services/emails/transport'
import { BOITE_OTP_DUREE_SECONDES, BOITE_OTP_PREFIXE } from '../services/otp/envoi'
import { db } from '../utils/db'
import { getMessagesAuthQueue } from './queues'

const SECONDES_PAR_MINUTE = 60
export const ERREUR_ADMIN_REAUTH_JOB_INVALIDE = 'ADMIN_REAUTH_JOB_INVALIDE'
export const ERREUR_ADMIN_REAUTH_EMAIL_ECHEC = 'ADMIN_REAUTH_EMAIL_ECHEC'

/** `removeOnComplete`/`removeOnFail` : le code ne reste jamais dans Redis une fois le job terminé. */
export const adminReauthJobOptions: JobsOptions = {
  attempts: OTP_JOB_MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: OTP_JOB_BACKOFF_MS },
  removeOnComplete: true,
  removeOnFail: true,
}

/** Met en file l'e-mail du code. À appeler APRÈS le commit de la transaction qui a écrit la ligne. */
export async function enfilerEmailReauth(
  data: AdminReauthEmailJobData,
  queue: Pick<Queue, 'add'> = getMessagesAuthQueue(),
): Promise<void> {
  const valide = adminReauthEmailJobDataSchema.parse(data)
  await queue.add(JOBS.sendAdminReauthEmail, valide, adminReauthJobOptions)
}

export interface CibleEmailReauth {
  email: string
  action: string
}

export interface AdminReauthDeps {
  /** Adresse et action de la ligne ouverte ; `null` si consommée, expirée, ou si le compte n'est plus superadmin. */
  lireCible: (reauthId: string) => Promise<CibleEmailReauth | null>
  /** `null` = boîte de développement (aucune clé Resend). */
  transport: EmailTransport | null
  deposerDev: (email: string, code: string) => Promise<void>
}

async function lireCibleEnBase(reauthId: string): Promise<CibleEmailReauth | null> {
  const resultat = await db.execute<{ email: string, action: string }>(sql`
    SELECT u.email AS email, r.action AS action
    FROM admin_reauth r
    JOIN users u ON u.id = r.admin_id
    WHERE r.id = ${reauthId}
      AND r.consomme_le IS NULL
      AND r.expire_le > now()
      AND u.role = ${SUPERADMIN}
      AND u.suspendu = false`)
  return resultat.rows[0] ?? null
}

/** Boîte de développement : même clé que les OTP de connexion (lue par /api/dev/boite-otp). Jamais en production. */
async function deposerDansLaBoiteDev(email: string, code: string): Promise<void> {
  if (env.NODE_ENV === 'production') return
  const { redis } = await import('../utils/redis')
  await redis.set(`${BOITE_OTP_PREFIXE}${email}`, code, 'EX', BOITE_OTP_DUREE_SECONDES)
}

const DEPS_PAR_DEFAUT: AdminReauthDeps = {
  lireCible: lireCibleEnBase,
  transport: env.RESEND_API_KEY && env.NODE_ENV === 'production' ? transactionalEmailTransport : null,
  deposerDev: deposerDansLaBoiteDev,
}

/** Clé d'idempotence Resend : les essais d'un même code partagent la clé, deux codes distincts jamais. */
export function cleIdempotenceReauth(reauthId: string): string {
  return `admin-reauth:${reauthId}`
}

/**
 * Traite un job `send-admin-reauth-email`. Une donnée invalide, ou une ligne qui n'est plus ouverte, ne donne
 * lieu à aucun envoi et à aucune relance (le code serait inutilisable). Les erreurs levées ne reprennent ni
 * l'adresse ni le code.
 */
export async function processAdminReauthEmailJob(rawData: unknown, deps: AdminReauthDeps = DEPS_PAR_DEFAUT): Promise<void> {
  const parsed = adminReauthEmailJobDataSchema.safeParse(rawData)
  // Donnée invalide : aucune relance (elle ne deviendra jamais valide).
  if (!parsed.success) throw new UnrecoverableError(ERREUR_ADMIN_REAUTH_JOB_INVALIDE)
  const { reauthId, code } = parsed.data
  const cible = await deps.lireCible(reauthId)
  if (cible === null) return

  const message = buildAdminReauthEmail({
    destinataire: cible.email,
    code,
    libelleAction: libelleAction(cible.action),
    dureeMinutes: ADMIN_REAUTH_TTL_S / SECONDES_PAR_MINUTE,
    siteUrl: env.NUXT_PUBLIC_SITE_URL,
  })
  if (deps.transport) {
    try {
      await deps.transport.send(message, cleIdempotenceReauth(reauthId))
    } catch (error) {
      throw new EmailTransportError(error instanceof EmailTransportError ? error.code : ERREUR_ADMIN_REAUTH_EMAIL_ECHEC)
    }
    return
  }
  // Sans transport en production, le code ne doit jamais être écrit dans un journal.
  if (env.NODE_ENV === 'production') throw new EmailTransportError('RESEND_NON_CONFIGURE')
  await deps.deposerDev(cible.email, code)
}
