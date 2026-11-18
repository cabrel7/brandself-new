import { addTemplate, addTypeTemplate, createResolver, defineNuxtModule } from 'nuxt/kit'
import { NOM_MIDDLEWARE, retirerAuthGlobale } from './auth-differee/retrait'

/**
 * S13-A (L2) : le client d'authentification (`better-auth/client` et ses extensions) ne doit pas partir sur les
 * pages publiques. `@nuxtjs/better-auth` 0.3.12 enregistre deux éléments globaux qui l'importent :
 *  - le plugin client `session.client` (requête de session à chaque page) ;
 *  - le middleware global `auth` (garde des routes qui ont une règle `auth`).
 * Ce module retire le plugin et remplace le middleware par une enveloppe qui ne charge la garde d'origine
 * (même fichier, même comportement) que sur les routes ayant une règle d'authentification.
 *
 * Inchangés : `session.server` (rendu serveur), `useUserSession` (la garde charge la session avant le studio),
 * les règles `routeRules` de `nuxt.config.ts`, la garde serveur `route-access`.
 *
 * Dépendance à des détails internes du module : la version est épinglée ; si le plugin ou le middleware est
 * introuvable (renommage après une montée de version), le build ÉCHOUE au lieu de laisser une garde absente.
 */

export default defineNuxtModule({
  meta: { name: 'auth-differee' },
  setup(_options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    let cheminGarde: string | null = null

    // Le plugin et le middleware du module sont ajoutés par des hooks `app:resolve` enregistrés pendant son
    // installation. On s'inscrit à `modules:done` (après TOUS les modules) pour que notre hook s'exécute après.
    nuxt.hook('modules:done', () => {
      nuxt.hook('app:resolve', (app) => {
        cheminGarde = retirerAuthGlobale(app)
        app.middleware.push({ name: NOM_MIDDLEWARE, path: resolve('./auth-differee/runtime/middleware'), global: true })
      })
    })

    // Charge la garde d'origine à la demande (import dynamique : chunk séparé, jamais dans l'entrée).
    addTemplate({
      filename: 'auth-differee/garde.mjs',
      getContents: () => {
        if (!cheminGarde) throw new Error('[auth-differee] la garde du module n\'a pas été résolue avant la génération.')
        return `export const chargerGarde = () => import(${JSON.stringify(cheminGarde)}).then((m) => m.default)\n`
      },
      write: true,
    })
    addTypeTemplate({
      filename: 'types/auth-differee.d.ts',
      getContents: () => `declare module '#build/auth-differee/garde.mjs' {
  import type { RouteLocationNormalized } from 'vue-router'
  export const chargerGarde: () => Promise<(to: RouteLocationNormalized, from: RouteLocationNormalized) => unknown>
}
`,
    })
  },
})
