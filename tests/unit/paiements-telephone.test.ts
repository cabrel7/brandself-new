import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TELEPHONE_EMPREINTE_HKDF_INFO, TELEPHONE_MASQUE_CARACTERE } from '../../shared/paiements'
import { getMoyenPaiement } from '../../server/config/paiements'
import { echec, moduleTelephone } from './support/s10'

// S10 §1 #116, CA26 : normalisation du numéro, masque d'affichage, empreinte HMAC (limite par numéro).
// Le numéro n'est JAMAIS stocké en clair : seul le masque (CHECK « contient • ») et l'empreinte (64 hex) existent.

const MTN = getMoyenPaiement('kpay:MTN_MOMO_CMR')!
const SECRET = process.env.NUXT_BETTER_AUTH_SECRET ?? ''

async function normaliser(saisie: string): Promise<string> {
  const { normaliserNumero } = await moduleTelephone()
  return normaliserNumero(saisie, MTN)
}

describe('normaliserNumero (CA26)', () => {
  it.each(['653 456 789', '653456789', '+237653456789', '237653456789', '+237 653 456 789', ' 653456789 '])('should normalise %j to 237653456789', async (saisie) => {
    expect(await normaliser(saisie)).toBe('237653456789')
  })

  it.each([
    ['0653456789', 'a leading zero'],
    ['553456789', 'a first digit other than 6'],
    ['2376534567890', 'one digit too many after the dial code'],
    ['65345678', 'one digit too few'],
    ['+33653456789', 'another country dial code'],
    ['+237+653456789', 'a plus sign in the middle'],
    ['65345678a', 'a letter'],
    ['653-456-789', 'dashes'],
    ['', 'an empty input'],
    ['+', 'a lone plus sign'],
    ['23765345678', 'the dial code and one digit too few'],
  ])('should refuse %j (%s) with 422 TELEPHONE_INVALIDE', async (saisie) => {
    const erreur = await echec(() => normaliser(saisie))

    expect(erreur).toMatchObject({ code: 'TELEPHONE_INVALIDE', status: 422 })
  })

  it('should not echo the refused number in the error message', async () => {
    const erreur = await echec(() => normaliser('0653456789'))

    expect(erreur.message).not.toContain('653456789')
  })

  it('should refuse a number of another wallet country than the chosen operator', async () => {
    const { normaliserNumero } = await moduleTelephone()

    const erreur = await echec(() => normaliserNumero('653456789', getMoyenPaiement('kpay:ORANGE_CIV')!))

    expect(erreur.code).toBe('TELEPHONE_INVALIDE')
  })
})

describe('masquer (CA26)', () => {
  it('should keep the dial code, the first digit and the last two digits', async () => {
    const { masquer } = await moduleTelephone()

    expect(masquer('237653456789')).toBe('+237 6•• ••• •89')
  })

  it('should always contain the mask character and never the full number, for many numbers', async () => {
    const { masquer } = await moduleTelephone()
    for (let i = 0; i < 200; i += 1) {
      const national = `6${String(10_000_000 + i * 391_731).padStart(8, '0').slice(-8)}`
      const masque = masquer(`237${national}`)

      expect(masque).toContain(TELEPHONE_MASQUE_CARACTERE)
      expect(masque).not.toContain(national)
      expect(masque.length).toBeLessThanOrEqual(32)
      expect(masque.startsWith('+237 6')).toBe(true)
      expect(masque.endsWith(national.slice(-2))).toBe(true)
    }
  })
})

describe('empreinte', () => {
  it('should be a 64 hexadecimal characters HMAC, stable for the same number', async () => {
    const { empreinte } = await moduleTelephone()

    expect(empreinte('237653456789')).toMatch(/^[0-9a-f]{64}$/)
    expect(empreinte('237653456789')).toBe(empreinte('237653456789'))
  })

  it('should differ for two different numbers, including numbers differing by one digit', async () => {
    const { empreinte } = await moduleTelephone()

    expect(empreinte('237653456789')).not.toBe(empreinte('237653456788'))
  })

  it('should be keyed : not a plain hash of the number that anyone could brute force (10^8 numbers)', async () => {
    const { empreinte } = await moduleTelephone()

    expect(empreinte('237653456789')).not.toBe(createHash('sha256').update('237653456789').digest('hex'))
    expect(empreinte('237653456789', 'un-autre-secret-assez-long-0123456789')).not.toBe(empreinte('237653456789'))
  })

  it('should be an HMAC-SHA256 keyed by the HKDF-SHA256 of the application secret (empty salt, 32 bytes, info from shared/)', async () => {
    const { empreinte } = await moduleTelephone()
    const cle = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), TELEPHONE_EMPREINTE_HKDF_INFO, 32))

    expect(empreinte('237653456789')).toBe(createHmac('sha256', cle).update('237653456789').digest('hex'))
  })
})
