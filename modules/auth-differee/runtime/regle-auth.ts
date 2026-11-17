/**
 * Décision « cette route a-t-elle une règle d'authentification ? », sans aucune importation de Nuxt ni de
 * Better Auth (testable seule). Même ordre de recherche que la garde de `@nuxtjs/better-auth`
 * (`runtime/app/middleware/auth.global.js`) : meta de la page, puis règles du module, puis règles de route de Nuxt.
 * Une règle absente ou égale à `false` ne protège rien : la garde ne serait pas appliquée non plus.
 */
export function reglePresente(auth: unknown): boolean {
  return auth !== undefined && auth !== false
}

export interface SourcesRegleAuth {
  /** `to.meta.auth` (défini par `definePageMeta`). */
  meta: unknown
  /** Règle `auth` fusionnée des règles collectées par le module (`#auth/route-rules`). */
  regleModule: () => unknown
  /** Règle `auth` des `routeRules` de Nuxt (`getRouteRules`). */
  regleNuxt: () => unknown | Promise<unknown>
}

export async function routeAUneRegleAuth(sources: SourcesRegleAuth): Promise<boolean> {
  if (sources.meta !== undefined) return reglePresente(sources.meta)
  const duModule = sources.regleModule()
  if (duModule !== undefined) return reglePresente(duModule)
  return reglePresente(await sources.regleNuxt())
}
