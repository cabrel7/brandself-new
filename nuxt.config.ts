// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'
import { loadDrapeauxPublics } from './shared/env'

// Validation de l'environnement dès le chargement de la configuration :
// `pnpm dev` / `pnpm build` échouent immédiatement si une variable manque.
const { googleActif, boiteOtpDev, paiementEnLigne } =loadDrapeauxPublics(process.env, process.argv)

export default defineNuxtConfig({
  // `nuxt-phosphor-icons` (doublon de @nuxt/icon, aucun usage, auto-import
  // `getIconList` jamais résolu) et `nuxt-qrcode` (aucun usage avant S6) sont
  // retirés : ils ralentissaient le démarrage de `pnpm dev`.
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxtjs/better-auth', '@nuxtjs/seo', '@nuxt/image', '@nuxt/icon/module', 'dayjs-nuxt', '@vueuse/nuxt/module', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // Pas de mode sombre en v1 : évite la classe `dark` selon la préférence système.
  ui: { colorMode: false },
  vite: {
    plugins: [tailwindcss()],
    // dayjs publie un bundle UMD sans export ESM : sans pré-bundling, le
    // graphe client casse au chargement (« does not provide an export named
    // 'default' ») et l'hydratation n'attache jamais.
    //
    // `useSortable` / `sortablejs` ne sont importés que par le studio (ssr: false) :
    // sans pré-bundling, Vite les découvre à la première visite du studio, relance
    // l'optimisation et recharge la page (« new dependencies optimized »).
    optimizeDeps: { include: ['dayjs', 'sortablejs', '@vueuse/integrations/useSortable'] },
    server: {
      // Dossiers sans rapport avec le graphe de l'application : inutile de les surveiller.
      watch: {
        ignored: ['**/storage/**', '**/test-results/**', '**/playwright-report/**', '**/.output/**', '**/dist-e2e/**'],
      },
    },
  },
  // Exclus du scan de Nuxt (pages, composants, plugins…).
  ignore: ['storage', 'test-results', 'playwright-report', 'docs'],
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      version: '0.1.0',
      googleActif,
      // Boîte aux lettres de développement (aucun fournisseur configuré en
      // local) : affichée sur /connexion/code. Jamais vraie en production.
      boiteOtpDev,
      // Faux en v1 : seul le règlement « sur place » est proposé pour un service payant.
      paiementEnLigne,
    },
  },
  site: {
    name: 'Brandself',
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Brandself',
    },
  },
  fonts: {
    families: [
      { name: 'Fraunces', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'Figtree', provider: 'google', weights: [400, 500, 600] },
    ],
  },
  auth: {
    redirects: {
      login: '/connexion',
      guest: '/studio',
      logout: '/connexion',
      sessionExpired: '/connexion',
    },
  },
  routeRules: {
    // Studio et onboarding : espace connecté, rendu client uniquement (aucun contenu privé côté serveur).
    '/studio': { ssr: false },
    '/studio/**': { ssr: false, auth: { only: 'user', redirectTo: '/connexion' } },
    '/onboarding': { ssr: false, auth: { only: 'user', redirectTo: '/connexion' } },
    '/connexion': { auth: { only: 'guest', redirectTo: '/studio' } },
    '/connexion/code': { auth: { only: 'guest', redirectTo: '/studio' } },
  },
  // Développement uniquement : les sous-modules lourds de @nuxtjs/seo sont coupés.
  // nuxt-og-image télécharge des polices depuis fonts.gstatic.com pendant le build
  // Nitro de dev ; un échec réseau fait échouer ce build (« dev server unavailable »).
  // Rien n'est modifié en production (`$production` et la configuration de base).
  $development: {
    ogImage: { enabled: false },
    linkChecker: { enabled: false },
    aiReady: { enabled: false },
    sitemap: { enabled: false },
    robots: { enabled: false },
    // Pas de sourcemaps en dev : `combineSourcemaps` pèse ~8 s de CPU au premier rendu.
    sourcemap: { server: false, client: false },
    nitro: { externals: { trace: false } },
  },
  compatibilityDate: '2025-07-15',
  // Désactivé : les Nuxt DevTools alourdissent fortement le dev sur 7 Go de RAM.
  // Réactiver ponctuellement avec `devtools: { enabled: true }`.
  devtools: { enabled: false },
})
