import { afterEach, describe, expect, it, vi } from 'vitest'
import { cheminNormalise } from '../../../shared/admin'
import { fakeEvent } from '../../support/h3'

// A1 (M2) : logique d'hôte du serveur. `server/utils/hote.ts` (décision et en-têtes), `server/plugins/hote-admin.ts`
// (avant le service des fichiers statiques de Nitro : neutralise la méthode) et `server/middleware/00-hote.ts`
// (404 uniforme). Événements h3 RÉELS (`fakeEvent`) : aucun mock de h3. Hôte d'administration de test : `admin.localhost`
// (défaut hors production). `defineNitroPlugin` est une fonction auto-importée par Nitro : on la fournit, identité.

const HOTE_ADMIN = 'admin.localhost:3000'
const HOTE_PUBLIC = 'localhost:3000'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function plugin(): Promise<(event: ReturnType<typeof fakeEvent>) => void> {
  vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)
  const module = await import('../../../server/plugins/hote-admin')
  const enregistres: Array<(event: ReturnType<typeof fakeEvent>) => void> = []
  ;(module.default as unknown as (app: unknown) => void)({
    hooks: { hook: (nom: string, fn: (event: ReturnType<typeof fakeEvent>) => void) => { if (nom === 'request') enregistres.push(fn) } },
  })
  expect(enregistres).toHaveLength(1)
  return enregistres[0]!
}

const requete = (host: string | undefined, url: string, method = 'GET', extra: Record<string, string> = {}) =>
  fakeEvent({ method, url, headers: { ...(host === undefined ? {} : { host }), ...extra } })

const entete = (event: ReturnType<typeof fakeEvent>, nom: string): string | undefined => {
  const valeur = event.node.res.getHeader(nom)
  return valeur === undefined ? undefined : String(valeur)
}

describe('server/utils/hote.ts : evaluerHote et poserEntetesAdmin', () => {
  it.each([
    ['/sw.js'], ['/manifest.json'], ['/studio'], ['/favicon.png'], ['/'], ['/mcp'], ['/api/studio/moi'],
  ])('should refuse %s on the administration host', async (chemin) => {
    const { evaluerHote } = await import('../../../server/utils/hote')

    expect(evaluerHote(requete(HOTE_ADMIN, chemin))).toEqual({ hoteAdmin: true, refuser: true })
  })

  it.each([['/admin'], ['/api/admin/session'], ['/admin/connexion'], ['/api/auth/get-session'], ['/_nuxt/x.js']])(
    'should let %s through on the administration host',
    async (chemin) => {
      const { evaluerHote } = await import('../../../server/utils/hote')

      expect(evaluerHote(requete(HOTE_ADMIN, chemin))).toEqual({ hoteAdmin: true, refuser: false })
    },
  )

  it.each([['/admin'], ['/api/admin/x'], ['/api/auth/admin/set-role'], ['/%61dmin']])('should refuse %s on the public host', async (chemin) => {
    const { evaluerHote } = await import('../../../server/utils/hote')

    expect(evaluerHote(requete(HOTE_PUBLIC, chemin))).toEqual({ hoteAdmin: false, refuser: true })
  })

  it.each([['/'], ['/studio'], ['/dr-cabrel'], ['/sw.js'], ['/manifest.json'], ['/api/health']])('should leave %s alone on the public host', async (chemin) => {
    const { evaluerHote } = await import('../../../server/utils/hote')

    expect(evaluerHote(requete(HOTE_PUBLIC, chemin))).toEqual({ hoteAdmin: false, refuser: false })
  })

  it('should ignore X-Forwarded-Host: only the Host header decides', async () => {
    const { evaluerHote } = await import('../../../server/utils/hote')

    expect(evaluerHote(requete(HOTE_PUBLIC, '/api/admin/session', 'GET', { 'x-forwarded-host': 'admin.localhost' })).hoteAdmin).toBe(false)
    expect(evaluerHote(requete(HOTE_ADMIN, '/studio', 'GET', { 'x-forwarded-host': 'localhost' })).hoteAdmin).toBe(true)
  })

  it('should treat a missing Host header as the public host', async () => {
    const { evaluerHote } = await import('../../../server/utils/hote')

    expect(evaluerHote(requete(undefined, '/api/admin/session'))).toEqual({ hoteAdmin: false, refuser: true })
  })

  it('should set the security headers, and no-store except for static assets', async () => {
    const { poserEntetesAdmin } = await import('../../../server/utils/hote')
    const page = requete(HOTE_ADMIN, '/admin')
    const statique = requete(HOTE_ADMIN, '/_nuxt/entry.js')

    poserEntetesAdmin(page)
    poserEntetesAdmin(statique)

    expect(entete(page, 'x-robots-tag')).toBe('noindex, nofollow')
    expect(entete(page, 'referrer-policy')).toBe('no-referrer')
    expect(entete(page, 'x-frame-options')).toBe('DENY')
    expect(entete(page, 'cache-control')).toBe('no-store')
    expect(entete(statique, 'x-robots-tag')).toBe('noindex, nofollow')
    expect(entete(statique, 'cache-control')).toBeUndefined()
  })
})

describe('server/plugins/hote-admin.ts : avant le service des fichiers statiques', () => {
  it.each([['/sw.js'], ['/manifest.json'], ['/studio'], ['/favicon.png']])(
    'should set the headers AND turn the method of a refused %s into OPTIONS (the static handler only serves GET and HEAD)',
    async (chemin) => {
      const hook = await plugin()
      const event = requete(HOTE_ADMIN, chemin, 'GET')

      hook(event)

      expect(event.node.req.method).toBe('OPTIONS')
      expect(entete(event, 'x-robots-tag')).toBe('noindex, nofollow')
      expect(entete(event, 'x-frame-options')).toBe('DENY')
    },
  )

  it('should also neutralise HEAD and POST on a refused path', async () => {
    const hook = await plugin()
    for (const methode of ['HEAD', 'POST']) {
      const event = requete(HOTE_ADMIN, '/sw.js', methode)
      hook(event)
      expect(event.node.req.method, methode).toBe('OPTIONS')
    }
  })

  it.each([['/admin'], ['/api/admin/session'], ['/admin/connexion']])('should leave the method of %s untouched (headers still set)', async (chemin) => {
    const hook = await plugin()
    const event = requete(HOTE_ADMIN, chemin, 'GET')

    hook(event)

    expect(event.node.req.method).toBe('GET')
    expect(entete(event, 'x-robots-tag')).toBe('noindex, nofollow')
  })

  it.each([['/admin'], ['/api/admin/x'], ['/api/auth/admin/set-role']])('should neutralise the method of %s on the public host, without admin headers', async (chemin) => {
    const hook = await plugin()
    const event = requete(HOTE_PUBLIC, chemin, 'GET')

    hook(event)

    expect(event.node.req.method).toBe('OPTIONS')
    expect(entete(event, 'x-robots-tag')).toBeUndefined()
  })

  it.each([['/'], ['/studio'], ['/sw.js'], ['/manifest.json'], ['/dr-cabrel']])('should do nothing to %s on the public host', async (chemin) => {
    const hook = await plugin()
    const event = requete(HOTE_PUBLIC, chemin, 'GET')

    hook(event)

    expect(event.node.req.method).toBe('GET')
    expect(entete(event, 'x-robots-tag')).toBeUndefined()
    expect(entete(event, 'x-frame-options')).toBeUndefined()
  })

  it('should not be fooled by X-Forwarded-Host', async () => {
    const hook = await plugin()
    const faux = requete(HOTE_PUBLIC, '/sw.js', 'GET', { 'x-forwarded-host': 'admin.localhost' })
    const vrai = requete(HOTE_ADMIN, '/sw.js', 'GET', { 'x-forwarded-host': 'localhost' })

    hook(faux)
    hook(vrai)

    expect(faux.node.req.method).toBe('GET')
    expect(vrai.node.req.method).toBe('OPTIONS')
  })
})

describe('server/middleware/00-hote.ts : 404 uniforme', () => {
  async function middleware() {
    return (await import('../../../server/middleware/00-hote')).default as unknown as (event: ReturnType<typeof fakeEvent>) => void
  }

  it('should throw the uniform 404 for a refused path, after setting the headers', async () => {
    const handler = await middleware()
    const event = requete(HOTE_ADMIN, '/studio')

    expect(() => handler(event)).toThrowError(expect.objectContaining({ statusCode: 404, message: 'Not Found' }))
    expect(entete(event, 'x-robots-tag')).toBe('noindex, nofollow')
    expect(event.context.hoteAdmin).toBe(true)
  })

  it('should let an allowed path through and flag the context', async () => {
    const handler = await middleware()
    const admin = requete(HOTE_ADMIN, '/api/admin/session')
    const publique = requete(HOTE_PUBLIC, '/studio')

    expect(() => handler(admin)).not.toThrow()
    expect(() => handler(publique)).not.toThrow()
    expect(admin.context.hoteAdmin).toBe(true)
    expect(publique.context.hoteAdmin).toBe(false)
  })

  it('should give the same 404 body on the public host for an administration path', async () => {
    const handler = await middleware()
    const erreurs: unknown[] = []
    for (const [hote, chemin] of [[HOTE_PUBLIC, '/api/admin/session'], [HOTE_ADMIN, '/studio'], [HOTE_PUBLIC, '/admin']] as const) {
      try {
        handler(requete(hote, chemin))
      } catch (erreur) {
        const e = erreur as { statusCode: number, statusMessage: string, message: string, data: unknown }
        erreurs.push(JSON.stringify({ s: e.statusCode, m: e.statusMessage, t: e.message, d: e.data }))
      }
    }

    expect(erreurs).toHaveLength(3)
    expect(new Set(erreurs).size).toBe(1)
  })
})

describe('middleware OTP : le chemin est normalisé avant la comparaison (limiteur non contournable)', () => {
  const CANONIQUE = '/api/auth/email-otp/send-verification-otp'

  it.each([[`${CANONIQUE}?x=1`], [`//api/auth/email-otp/send-verification-otp`], [`${CANONIQUE}#a`], ['/api/auth/./email-otp/send-verification-otp'], [`${CANONIQUE}/`], ['/API/AUTH/EMAIL-OTP/SEND-VERIFICATION-OTP']])(
    'should reduce %s to the limited path',
    (brut) => {
      expect(cheminNormalise(brut)).toBe(CANONIQUE)
    },
  )

  it('should call the normaliser before testing membership of the limited paths', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../../server/middleware/otp-limiteur.ts', import.meta.url), 'utf-8')

    expect(source).toMatch(/cheminNormalise\(event\.path\)/)
    expect(source).toMatch(/OTP_PATHS\.has\(chemin\)/)
    expect(source).not.toMatch(/OTP_PATHS\.has\(event\.path\)/)
  })
})
