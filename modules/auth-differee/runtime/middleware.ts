import { defu } from 'defu'
import { createRouter, toRouteMatcher } from 'radix3'
import type { NavigationGuardReturn } from 'vue-router'
import { authRouteRules } from '#auth/route-rules'
import { chargerGarde } from '#build/auth-differee/garde.mjs'
import { routeAUneRegleAuth } from './regle-auth'

/**
 * Enveloppe de la garde globale de `@nuxtjs/better-auth` (voir `modules/auth-differee.ts`).
 * Une route sans règle d'authentification (landing, tarifs, vitrines) ne charge ni la garde ni le client
 * Better Auth. Une route avec règle (`/studio/**`, `/onboarding`, `/connexion**`) exécute la garde du module,
 * inchangée, dans le contexte Nuxt courant.
 */
const matcher = Object.keys(authRouteRules).length ? toRouteMatcher(createRouter({ routes: authRouteRules })) : null

function regleDuModule(chemin: string): unknown {
  const correspondances = matcher?.matchAll(chemin)
  if (!correspondances?.length) return undefined
  return (defu({}, ...correspondances.reverse()) as { auth?: unknown }).auth
}

export default defineNuxtRouteMiddleware(async (to, from) => {
  const nuxtApp = useNuxtApp()
  const protegee = await routeAUneRegleAuth({
    meta: to.meta.auth,
    regleModule: () => regleDuModule(to.path),
    regleNuxt: async () => (await getRouteRules({ path: to.path })).auth,
  })
  if (!protegee) return
  const garde = await chargerGarde()
  // La garde d'origine renvoie une valeur de navigation (redirection, erreur, `undefined`) : on la propage telle quelle.
  // Le type de l'import dynamique est `unknown` côté module ; la forme réelle est celle d'un garde de route.
  return (await nuxtApp.runWithContext(() => garde(to, from))) as NavigationGuardReturn
})
