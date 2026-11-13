import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nettoyerAffichage, nettoyerLigne } from '../../server/services/emails/gabarit/echappement'
import { cleIdempotenceOtp } from '../../server/jobs/otp'

const FILE_AUTH = 'messages-auth'
const FILE_LEGACY = 'emails'
const IDENTIFIANT = '42'
const INSTANT = 1_700_000_000_000

describe('cleIdempotenceOtp', () => {
  it('should give two different keys to jobs with the same id in two different queues', () => {
    expect(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT)).not.toBe(cleIdempotenceOtp(FILE_LEGACY, IDENTIFIANT, INSTANT))
  })

  it('should give the same key to the same job replayed (same queue, id and timestamp)', () => {
    expect(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT)).toBe(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT))
  })

  it('should give a new key when the counter restarts (same queue and id, later timestamp)', () => {
    expect(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT)).not.toBe(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT + 1))
  })

  it('should keep the otp-email prefix and contain queue, id and timestamp', () => {
    expect(cleIdempotenceOtp(FILE_AUTH, IDENTIFIANT, INSTANT)).toBe(`otp-email:${FILE_AUTH}:${IDENTIFIANT}:${INSTANT}`)
  })
})

describe('nettoyage des marques de direction', () => {
  const MARQUES = ['‎', '‏', '؜']

  it.each(MARQUES)('should strip U+%# from nettoyerLigne and nettoyerAffichage', (marque) => {
    expect(nettoyerLigne(`a${marque}b`)).toBe('ab')
    expect(nettoyerAffichage(`a${marque}b`)).toBe('ab')
  })
})

describe('expéditeurs OTP en production', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../../shared/env', () => ({ env: { NODE_ENV: 'production', NUXT_PUBLIC_SITE_URL: 'https://jesuis.pro' } }))
  })

  afterEach(() => {
    vi.doUnmock('../../shared/env')
    vi.restoreAllMocks()
  })

  it('should throw OTP_SMS_NON_CONFIGURE and never log the code or the number', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { SenderOtpSms } = await import('../../server/services/otp/envoi')

    await expect(new SenderOtpSms().send('+237699000011', '123456')).rejects.toThrow('OTP_SMS_NON_CONFIGURE')
    expect(info).not.toHaveBeenCalled()
  })

  it('should throw RESEND_NON_CONFIGURE without transport and write nothing in the logs', async () => {
    const espions = (['info', 'log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const { SenderOtpEmail } = await import('../../server/services/otp/envoi')

    await expect(new SenderOtpEmail(null).send('alice@exemple.test', '123456', 'otp-email:x')).rejects.toThrow('RESEND_NON_CONFIGURE')
    for (const espion of espions) expect(espion).not.toHaveBeenCalled()
  })
})

describe('SenderOtpSms hors production', () => {
  it('should keep logging in the console outside production', async () => {
    vi.resetModules()
    vi.doMock('../../shared/env', () => ({ env: { NODE_ENV: 'test' } }))
    vi.doMock('../../server/utils/redis', () => ({ redis: { set: vi.fn(async () => 'OK') } }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { SenderOtpSms } = await import('../../server/services/otp/envoi')

    await new SenderOtpSms().send('+237699000011', '123456')

    expect(info).toHaveBeenCalledTimes(1)
    vi.doUnmock('../../shared/env')
    vi.doUnmock('../../server/utils/redis')
    vi.restoreAllMocks()
  })
})
