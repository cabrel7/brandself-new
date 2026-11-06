// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'
import { loadDrapeauxPublics, loadSiteConfig } from './shared/env'
import {
  LLMS_NOTES,
  LLMS_SECTIONS,
  NOINDEX_ROUTES,
  ROBOTS_IA_POLITIQUE_DEFAUT,
  SITE_DESCRIPTION,
  SITEMAP_CACHE_S,
  SITEMAP_URLS_PAR_CARTE,
  construireGroupesRobots,
} from './shared/seo'

// Validation de l'environnement dès le chargement de la configuration :
// `pnpm dev` / `pnpm build` échouent immédiatement si une variable manque.
const { googleActif, boiteOtpDev, paiementEnLigne } = loadDrapeauxPublics(process.env, process.argv)
const siteConfig = loadSiteConfig(process.env, process.argv)

// S12 (#149) : une directive par route, appliquée en meta et en `X-Robots-Tag` (routeRules.robots).
const reglesNoindex = Object.fromEntries(
  Object.entries(NOINDEX_ROUTES).map(([route, directive]) => [route, { robots: directive }]),
)

export default defineNuxtConfig({
  // `nuxt-phosphor-icons` (doublon de @nuxt/icon, aucun usage, auto-import
  // `getIconList` jamais résolu) est retiré : il ralentissait le démarrage de `pnpm dev`.
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxtjs/better-auth', '@nuxtjs/seo', '@nuxt/image', '@nuxt/icon/module', 'dayjs-nuxt', '@vueuse/nuxt/module', '@nuxt/ui', 'nuxt-qrcode'],
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
  // `indexable` volontairement absent : une valeur explicite l'emporterait sur `env` et sur
  // NUXT_PUBLIC_SITE_ENV au runtime. Sans lui, indexable <=> env === 'production' (staging = noindex).
  site: {
    url: siteConfig.url,
    name: 'Brandself',
    description: SITE_DESCRIPTION,
    defaultLocale: 'fr',
    trailingSlash: false,
    ...(siteConfig.env ? { env: siteConfig.env } : {}),
  },
  // S12 (#147) : l'image de partage est générée par sharp (variante `partage`), pas par nuxt-og-image.
  ogImage: { enabled: false },
  // La canonique est posée par server/middleware/canonique.ts (#146).
  seo: { redirectToCanonicalSiteUrl: false },
  robots: {
    // Le groupe `*` (Disallow ROBOTS_DISALLOW, Allow /) vient de construireGroupesRobots : pas de `disallow`
    // de premier niveau, qui créerait un second groupe `*` en double.
    groups: construireGroupesRobots(ROBOTS_IA_POLITIQUE_DEFAUT),
  },
  sitemap: {
    sitemaps: {
      pages: { includeAppSources: false, urls: ['/', '/tarifs'] },
      vitrines: { sources: ['/api/__sitemap__/vitrines'], chunks: SITEMAP_URLS_PAR_CARTE },
    },
    cacheMaxAgeSeconds: SITEMAP_CACHE_S,
    autoLastmod: false,
  },
  aiReady: {
    llmsTxt: { pages: false, sections: [...LLMS_SECTIONS], notes: [...LLMS_NOTES] },
    llmsFullTxt: false,
    contentNegotiation: false,
    botNegotiation: false,
    sitemapMd: false,
    agentSkills: false,
    mcpServerCard: false,
    apiCatalog: false,
    database: false,
    describedby: true,
    llmsTxtCacheSeconds: 3600,
    contentSignal: { aiTrain: false, search: true, aiInput: true, contentUsage: false },
  },
  schemaOrg: { identity: 'Organization' },
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Brandself',
    },
  },
  fonts: {
    families: [
      // S12 (#159) : graisses réellement utilisées (600/700 titres, 500 initiales décoratives ; 400 jamais).
      // `styles` non précisé = normal + italique (témoignage à la une). Préchargement : titres seulement.
      { name: 'Fraunces', provider: 'google', weights: [500, 600, 700], subsets: ['latin'], preload: true },
      { name: 'Figtree', provider: 'google', weights: [400, 500, 600], subsets: ['latin'], preload: false },
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
    ...reglesNoindex,
    // Studio et onboarding : espace connecté, rendu client uniquement (aucun contenu privé côté serveur).
    '/studio': { ssr: false },
    '/studio/**': { ssr: false, auth: { only: 'user', redirectTo: '/connexion' } },
    '/onboarding': { ssr: false, auth: { only: 'user', redirectTo: '/connexion' } },
    '/connexion': { auth: { only: 'guest', redirectTo: '/studio' } },
    '/connexion/code': { auth: { only: 'guest', redirectTo: '/studio' } },
    // S9 (#89) : page de désabonnement, ouverte depuis un e-mail sans session (aucune règle `auth`), rendue
    // côté serveur. Le jeton est dans l'URL : jamais indexée, jamais en cache, aucun Referer sortant.
    '/desabonnement': {
      robots: NOINDEX_ROUTES['/desabonnement'],
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    },
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
