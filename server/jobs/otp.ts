import { z } from 'zod'
import { JOBS } from '../../shared/jobs'
import { enregistrerEnvoi } from '../services/envois-codes'
import { senderOtpEmail, senderOtpSms } from '../services/otp/envoi'
import type { OtpSender } from '../services/otp/envoi'

const otpJobDataSchema = z.strictObject({ identifier: z.string().min(1), code: z.string().min(1) })

interface OtpSenders {
  email: OtpSender
  sms: OtpSender
}

const DEFAULT_SENDERS: OtpSenders = { email: senderOtpEmail, sms: senderOtpSms }

/**
 * Clé d'idempotence Resend d'un job OTP e-mail : `otp-email:<file>:<id>:<timestamp>`. L'id seul n'est unique que
 * par file (les files `emails` et `messages-auth` ont chacune leur compteur, remis à 1 après un flush Redis) ;
 * `timestamp` (instant de mise en file) reste stable entre les essais d'un MÊME job, donc ses réessais gardent
 * la même clé, alors qu'un autre job au même id n'en partage jamais.
 */
export function cleIdempotenceOtp(file: string, id: string | undefined, timestamp: number): string {
  return `otp-email:${file}:${id ?? ''}:${timestamp}`
}

/**
 * Traitement d'un job OTP (e-mail ou SMS). `idempotencyKey` = `cleIdempotenceOtp(...)` (fournie par le worker).
 * Une donnée de job invalide lève une erreur qui ne reprend ni l'adresse ni le code.
 * A4 (D-A4-15) : chaque envoi est consigné dans `envois_codes` (canal, pays, statut, tentative, code d'erreur), SANS
 * identifiant ni code. `enregistrerEnvoi` ne lève jamais : le résultat de l'envoi (réussite ou erreur d'origine) est
 * rendu tel quel, jamais modifié ni rejoué par le journal. `tentative` = numéro de l'essai (1 à 3).
 */
export async function processOtpJob(
  name: string,
  rawData: unknown,
  idempotencyKey: string,
  senders: OtpSenders = DEFAULT_SENDERS,
  tentative = 1,
): Promise<void> {
  if (name !== JOBS.sendOtpEmail && name !== JOBS.sendOtpSms) throw new Error(`Unknown job: ${name}`)
  const parsed = otpJobDataSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('OTP_JOB_INVALIDE')
  const { identifier, code } = parsed.data
  const estEmail = name === JOBS.sendOtpEmail
  try {
    if (estEmail) await senders.email.send(identifier, code, idempotencyKey)
    else await senders.sms.send(identifier, code)
  } catch (erreur) {
    await enregistrerEnvoi({ canal: estEmail ? 'email' : 'sms', numero: estEmail ? undefined : identifier, statut: 'echec', tentative, erreur })
    throw erreur
  }
  await enregistrerEnvoi({ canal: estEmail ? 'email' : 'sms', numero: estEmail ? undefined : identifier, statut: 'envoye', tentative })
}
