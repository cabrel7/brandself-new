import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JOBS } from '../../../shared/jobs'
import { avecEnvoisEnPanne, lignesEnvois, otpJobModule, reinitialiserA4 } from '../support/admin-a4'

// A4 CA12 (D-A4-15, R4) : journal d'envoi des codes. `processOtpJob` écrit
// UNE ligne par tentative (canal, pays déduit de l'indicatif, statut, numéro de tentative, code d'erreur court), sans
// identifiant, sans numéro, sans code ; une erreur d'écriture est AVALÉE et ne doit JAMAIS changer le sort du job (sinon BullMQ
// relancerait l'envoi d'un code de connexion). Base RÉELLE (la panne d'écriture est un déclencheur PostgreSQL de test) ;
// seuls les expéditeurs (Resend, passerelle SMS) sont factices. S1/S9 : `tests/integration/otp-envoi.test.ts` reste la non-régression.

const CODE = '482916'
const TEL_CM = '+237653456789'
const TEL_FR = '+33612345678'
const EMAIL = 'canari.envoi.zorglub@exemple.test'

beforeEach(async () => {
  await reinitialiserA4()
})

function expediteurs(echecs: { email?: Error, sms?: Error } = {}) {
  const email = vi.fn(async () => { if (echecs.email) throw echecs.email })
  const sms = vi.fn(async () => { if (echecs.sms) throw echecs.sms })
  return {
    email,
    sms,
    senders: { email: { canal: 'email' as const, send: email }, sms: { canal: 'sms' as const, send: sms } },
  }
}

async function traiter(name: string, identifier: string, senders: ReturnType<typeof expediteurs>['senders'], tentativesFaites = 0): Promise<unknown> {
  const { processOtpJob } = await otpJobModule()
  return processOtpJob(name, { identifier, code: CODE }, 'otp-email:messages-auth:42:1700000000000', senders, tentativesFaites + 1)
}

describe('journal d\'envoi des codes (CA12)', () => {
  it('should write one row per attempt (e-mail: no country; SMS: country of the dial code; failure: short code and attempt number), and never a number, an address or a code', async () => {
    const ok = expediteurs()
    const sms = expediteurs({ sms: new Error('OTP_SMS_NON_CONFIGURE') })
    const fuite = expediteurs({ email: new Error(`Resend a refusé ${EMAIL} avec le code ${CODE}`) })

    await traiter(JOBS.sendOtpEmail, EMAIL, ok.senders)
    await traiter(JOBS.sendOtpSms, TEL_FR, ok.senders)
    const echecSms = await traiter(JOBS.sendOtpSms, TEL_CM, sms.senders, 1).then(() => 'resolu', (erreur: Error) => erreur.message)
    await traiter(JOBS.sendOtpEmail, EMAIL, fuite.senders, 2).catch(() => undefined)

    expect(echecSms).toBe('OTP_SMS_NON_CONFIGURE')
    const lignes = await lignesEnvois()
    expect(lignes.map(({ canal, pays, statut, tentative, code_erreur }) => ({ canal, pays, statut, tentative, code_erreur }))).toEqual([
      { canal: 'email', pays: null, statut: 'envoye', tentative: 1, code_erreur: null },
      { canal: 'sms', pays: 'FR', statut: 'envoye', tentative: 1, code_erreur: null },
      { canal: 'sms', pays: 'CM', statut: 'echec', tentative: 2, code_erreur: 'OTP_SMS_NON_CONFIGURE' },
      { canal: 'email', pays: null, statut: 'echec', tentative: 3, code_erreur: expect.stringMatching(/^[A-Z][A-Z0-9_]{0,39}$/) },
    ])
    const brut = JSON.stringify(lignes)
    for (const interdit of [CODE, '653456789', '612345678', 'zorglub', 'canari', EMAIL]) expect(brut, interdit).not.toContain(interdit)
  })

  it('should NOT change the fate of the job when the journal write fails: one e-mail sent and no error for a success, the ORIGINAL error for a failure', async () => {
    const ok = expediteurs()
    const sms = expediteurs({ sms: new Error('OTP_SMS_NON_CONFIGURE') })

    await avecEnvoisEnPanne(async () => {
      await expect(traiter(JOBS.sendOtpEmail, EMAIL, ok.senders)).resolves.not.toThrow()
      const erreur = await traiter(JOBS.sendOtpSms, TEL_CM, sms.senders).then(() => undefined, (e: Error) => e)
      expect(erreur?.message).toBe('OTP_SMS_NON_CONFIGURE')
    })

    expect(ok.email).toHaveBeenCalledTimes(1)
    expect(sms.sms).toHaveBeenCalledTimes(1)
    expect(await lignesEnvois()).toEqual([])
  })
})
