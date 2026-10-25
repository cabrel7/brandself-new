// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', 'nuxt-phosphor-icons', '@nuxtjs/better-auth', '@nuxtjs/seo', '@nuxt/image', '@nuxt/icon/module', 'nuxt-qrcode', 'dayjs-nuxt', '@vueuse/nuxt/module'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    // dayjs publie un bundle UMD sans export ESM : sans pré-bundling, le
    // graphe client casse au chargement (« does not provide an export named
    // 'default' ») et l'hydratation n'attache jamais.
    optimizeDeps: { include: ['dayjs'] },
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      version: '0.1.0',
      googleActif: Boolean(process.env.GOOGLE_CLIENT_ID),
    },
  },
  site: {
    name: 'Brandself',
  },
  app: {
    head: {
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
    '/studio/**': { auth: { only: 'user', redirectTo: '/connexion' } },
    '/onboarding': { auth: { only: 'user', redirectTo: '/connexion' } },
    '/connexion': { auth: { only: 'guest', redirectTo: '/studio' } },
    '/connexion/code': { auth: { only: 'guest', redirectTo: '/studio' } },
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
})
