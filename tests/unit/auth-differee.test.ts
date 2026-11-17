import { describe, expect, it, vi } from 'vitest'
import { retirerAuthGlobale } from '../../modules/auth-differee/retrait'
import type { AppResolue } from '../../modules/auth-differee/retrait'
import { reglePresente, routeAUneRegleAuth } from '../../modules/auth-differee/runtime/regle-auth'

const RACINE = '/projet/node_modules/@nuxtjs/better-auth/dist'
const CHEMIN_GARDE = `${RACINE}/runtime/app/middleware/auth.global.js`

function appCourante(): AppResolue {
  return {
    plugins: [
      { src: '/projet/app/plugins/autre.ts' },
      { src: `${RACINE}/runtime/app/plugins/session.server.js`, mode: 'server' },
      { src: `${RACINE}/runtime/app/plugins/session.client.js`, mode: 'client' },
    ],
    middleware: [
      { name: 'admin', path: '/projet/app/middleware/admin.ts' },
      { name: 'auth', path: CHEMIN_GARDE, global: true },
    ],
  }
}

describe('retirerAuthGlobale', () => {
  it('retire le plugin client et le middleware global, garde le reste, et renvoie le chemin de la garde', () => {
    const app = appCourante()
    const chemin = retirerAuthGlobale(app)
    expect(chemin).toBe(CHEMIN_GARDE)
    expect(app.plugins.map((p) => p.src)).toEqual([
      '/projet/app/plugins/autre.ts',
      `${RACINE}/runtime/app/plugins/session.server.js`,
    ])
    expect(app.middleware.map((m) => m.name)).toEqual(['admin'])
  })

  it('échoue bruyamment si le plugin client est introuvable, sans rien retirer', () => {
    const app = appCourante()
    app.plugins = app.plugins.filter((p) => !p.src?.includes('session.client'))
    expect(() => retirerAuthGlobale(app)).toThrow(/\[auth-differee\].*plugin client/s)
    expect(app.middleware).toHaveLength(2)
  })

  it('échoue bruyamment si le middleware global est introuvable, sans retirer le plugin', () => {
    const app = appCourante()
    app.middleware = app.middleware.filter((m) => m.name !== 'auth')
    expect(() => retirerAuthGlobale(app)).toThrow(/\[auth-differee\].*middleware global/s)
    expect(app.plugins).toHaveLength(3)
  })

  it('échoue si le middleware a été renommé ou déplacé par une montée de version', () => {
    const app = appCourante()
    app.middleware = [{ name: 'auth', path: `${RACINE}/runtime/app/middleware/guard.js`, global: true }]
    expect(() => retirerAuthGlobale(app)).toThrow(/auth\.global/)
  })

  it('nomme les deux éléments quand les deux manquent', () => {
    expect(() => retirerAuthGlobale({ plugins: [], middleware: [] })).toThrow(/plugin client.*et.*middleware global/s)
  })

  it("n'accepte pas un plugin du même nom venant d'un autre paquet", () => {
    const app = appCourante()
    app.plugins = [{ src: '/projet/node_modules/autre-module/dist/runtime/app/plugins/session.client.js' }]
    expect(() => retirerAuthGlobale(app)).toThrow(/plugin client/)
  })
})

describe('routeAUneRegleAuth (enveloppe de la garde)', () => {
  const regle = { only: 'user', redirectTo: '/connexion' }

  it("ne charge aucune règle de Nuxt ni du module quand la page déclare sa règle en meta", async () => {
    const regleModule = vi.fn()
    const regleNuxt = vi.fn()
    expect(await routeAUneRegleAuth({ meta: regle, regleModule, regleNuxt })).toBe(true)
    expect(regleModule).not.toHaveBeenCalled()
    expect(regleNuxt).not.toHaveBeenCalled()
  })

  it('page publique sans aucune règle : la garde ne sera pas chargée', async () => {
    expect(await routeAUneRegleAuth({ meta: undefined, regleModule: () => undefined, regleNuxt: () => undefined })).toBe(false)
  })

  it('règle trouvée dans les règles du module : la garde est chargée', async () => {
    const regleNuxt = vi.fn()
    expect(await routeAUneRegleAuth({ meta: undefined, regleModule: () => regle, regleNuxt })).toBe(true)
    expect(regleNuxt).not.toHaveBeenCalled()
  })

  it('règle trouvée seulement dans les routeRules de Nuxt (asynchrone) : la garde est chargée', async () => {
    expect(await routeAUneRegleAuth({ meta: undefined, regleModule: () => undefined, regleNuxt: async () => 'guest' })).toBe(true)
  })

  it('une règle `false` ne protège rien (comme la garde du module)', async () => {
    expect(await routeAUneRegleAuth({ meta: false, regleModule: () => regle, regleNuxt: () => regle })).toBe(false)
    expect(reglePresente(false)).toBe(false)
    expect(reglePresente(undefined)).toBe(false)
    expect(reglePresente('guest')).toBe(true)
  })
})
