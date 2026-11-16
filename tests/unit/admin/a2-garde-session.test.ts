import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent } from '../../support/h3'

// A2 CA01 (garde de session) : `requireSuperadmin` relit la session à CHAQUE requête et répond le MÊME 404 quelle que
// soit la cause (hôte, origine, session absente, compte suspendu ou plus superadmin, session trop ancienne). Unitaire :
// le lecteur de session (accès base) est remplacé, il est prouvé sur PostgreSQL dans tests/integration/admin/
// session-admin.test.ts. Événements h3 RÉELS, aucun mock de h3. Un compte suspendu = `lireSessionAdmin` renvoie null.

const lireSessionAdmin = vi.fn()
const supprimerSessionAdmin = vi.fn()
const getRequestSession = vi.fn()

vi.mock('../../../server/services/admin/session', () => ({ lireSessionAdmin, supprimerSessionAdmin }))

const HOTE_ADMIN = 'admin.localhost:3000'
const ORIGINE_ADMIN = 'http://admin.localhost:3000'
const SESSION_OK = { adminId: 'a1', nom: 'Admin', email: 'admin@exemple.test', sessionId: 's1', sessionCreeeLe: new Date(), expireLe: new Date(Date.now() + 3_600_000) }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('getRequestSession', getRequestSession)
  getRequestSession.mockResolvedValue({ session: { id: 's1' } })
  lireSessionAdmin.mockResolvedValue(SESSION_OK)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function garde(event: ReturnType<typeof fakeEvent>) {
  const { requireSuperadmin } = await import('../../../server/utils/admin')
  return requireSuperadmin(event).then((contexte) => ({ contexte }), (erreur: { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }) => ({ erreur }))
}

const requete = (host: string, method = 'GET', extra: Record<string, string> = {}) =>
  fakeEvent({ method, url: '/api/admin/utilisateurs', headers: { host, cookie: 'better-auth.session_token=x', ...extra } })

describe('requireSuperadmin : une seule réponse à toute anomalie', () => {
  it('should let a legitimate administration session through and relay the administrator and the IP', async () => {
    const resultat = await garde(requete(HOTE_ADMIN))

    expect(resultat).toMatchObject({ contexte: { adminId: 'a1', sessionId: 's1' } })
    expect(lireSessionAdmin).toHaveBeenCalledWith('s1')
  })

  it('should re-read the session at EVERY call: a session suspended between two requests is refused on the second', async () => {
    expect(await garde(requete(HOTE_ADMIN))).toHaveProperty('contexte')
    lireSessionAdmin.mockResolvedValue(null)

    const apres = await garde(requete(HOTE_ADMIN))

    expect(apres).toHaveProperty('erreur')
    expect(lireSessionAdmin).toHaveBeenCalledTimes(2)
  })

  it('should answer the very same 404 for a public host, a missing session, an unreadable session, a suspended or demoted account and a foreign origin', async () => {
    const causes: Array<() => Promise<unknown>> = [
      () => garde(requete('localhost:3000')),
      () => { getRequestSession.mockResolvedValue(null); return garde(requete(HOTE_ADMIN)) },
      () => { getRequestSession.mockRejectedValue(new Error('base indisponible')); return garde(requete(HOTE_ADMIN)) },
      () => { lireSessionAdmin.mockResolvedValue(null); return garde(requete(HOTE_ADMIN)) },
      () => garde(requete(HOTE_ADMIN, 'POST', { origin: 'https://evil.example' })),
      () => garde(requete(HOTE_ADMIN, 'POST', { origin: ORIGINE_ADMIN, 'sec-fetch-site': 'cross-site' })),
    ]
    const corps: unknown[] = []

    for (const cause of causes) {
      vi.resetAllMocks()
      getRequestSession.mockResolvedValue({ session: { id: 's1' } })
      lireSessionAdmin.mockResolvedValue(SESSION_OK)
      const resultat = await cause() as { erreur?: { statusCode?: number, statusMessage?: string, message?: string, data?: unknown } }
      expect(resultat.erreur?.statusCode).toBe(404)
      corps.push({ statusCode: resultat.erreur?.statusCode, statusMessage: resultat.erreur?.statusMessage, message: resultat.erreur?.message, data: resultat.erreur?.data })
    }

    for (const c of corps) expect(c).toEqual(corps[0])
  })

  it('should not even read the session on a public host or from a foreign origin (no database work for an attacker)', async () => {
    await garde(requete('localhost:3000'))
    await garde(requete(HOTE_ADMIN, 'POST', { origin: 'https://evil.example' }))

    expect(getRequestSession).not.toHaveBeenCalled()
    expect(lireSessionAdmin).not.toHaveBeenCalled()
  })

  it('should never trust X-Forwarded-Host to pick the administration host', async () => {
    const resultat = await garde(requete('localhost:3000', 'GET', { 'x-forwarded-host': 'admin.localhost:3000' }))

    expect(resultat).toHaveProperty('erreur')
    expect(lireSessionAdmin).not.toHaveBeenCalled()
  })

  it('should leak no stack and no cause in the refusal', async () => {
    lireSessionAdmin.mockResolvedValue(null)

    const { erreur } = await garde(requete(HOTE_ADMIN)) as { erreur: { stack?: string, message?: string, data?: unknown } }

    expect(erreur.stack ?? '').toBe('')
    expect(String(erreur.message)).toBe('Not Found')
    expect(JSON.stringify(erreur.data ?? null)).not.toMatch(/suspendu|banned|role|session|admin/i)
  })
})
