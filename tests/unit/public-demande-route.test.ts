import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent } from '../support/h3'

const { createDemande, enforceLimit, legacyGetRequestIP } = vi.hoisted(() => ({
  createDemande: vi.fn(),
  enforceLimit: vi.fn(),
  legacyGetRequestIP: vi.fn(),
}))

vi.mock('#server/services/demandes', () => ({ createDemande }))
vi.mock('#server/services/limiteur', () => ({ enforceLimit }))
vi.mock('#server/resources/agenda', () => ({
  toDemandeCreatedResource: (item: { id: string, statut: string }) => ({ demande: item }),
}))

const routeDemande = () => import('../../server/api/public/[username]/demandes/index.post')

beforeEach(() => {
  createDemande.mockResolvedValue({ item: { id: 'demande-1', statut: 'nouvelle' } })
  enforceLimit.mockResolvedValue(undefined)
  legacyGetRequestIP.mockReturnValue('192.0.2.200')
  vi.stubGlobal('getRequestIP', legacyGetRequestIP)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('POST public demandes', () => {
  it('should resolve the public slug server-side instead of accepting a service UUID', async () => {
    const { default: handler } = await routeDemande()
    const event = fakeEvent({
      method: 'POST',
      params: { username: 'dr-cabrel' },
      body: JSON.stringify({
        service: 'atelier-equipe',
        nom: 'Ariane Mballa',
        email: 'ariane.mballa@example.com',
        telephone: '+237699000001',
        siteWeb: '',
        message: 'Je souhaite inscrire mon équipe.',
      }),
    })

    await expect(handler(event)).resolves.toEqual({ demande: { id: 'demande-1', statut: 'nouvelle' } })
    expect(createDemande).toHaveBeenCalledTimes(1)
    expect(createDemande).toHaveBeenCalledWith('dr-cabrel', {
      serviceSlug: 'atelier-equipe',
      nom: 'Ariane Mballa',
      email: 'ariane.mballa@example.com',
      telephone: '+237699000001',
      message: 'Je souhaite inscrire mon équipe.',
    })
    expect(event.node.res.statusCode).toBe(201)
  })

  it('should key the fail-closed limiter with the IP resolved by the anti-spoofing helper', async () => {
    const { default: handler } = await routeDemande()
    const forwardedIp = '2001:db8::42'
    const event = fakeEvent({
      method: 'POST',
      headers: { 'x-forwarded-for': forwardedIp },
      params: { username: 'dr-cabrel' },
      body: JSON.stringify({
        service: 'atelier-equipe',
        nom: 'Ariane Mballa',
        email: 'ariane.mballa@example.com',
        telephone: '+237699000001',
        siteWeb: '',
        message: 'Je souhaite inscrire mon équipe.',
      }),
    })
    Object.defineProperty(event.node.req.socket, 'remoteAddress', {
      configurable: true,
      value: '127.0.0.1',
    })

    await handler(event)

    expect(enforceLimit).toHaveBeenCalledOnce()
    expect(enforceLimit).toHaveBeenCalledWith(
      `demande-publique:${forwardedIp}`,
      expect.any(Number),
      expect.any(Number),
      { failClosed: true },
    )
    expect(legacyGetRequestIP).not.toHaveBeenCalled()
  })
})
