// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'
import { loadDrapeauxPublics } from './shared/env'

// Validation de l'environnement dès le chargement de la configuration :
// `pnpm dev` / `pnpm build` échouent immédiatement si une variable manque.
const { googleActif, boiteOtpDev, paiementEnLigne } =loadDrapeauxPublics(process.env, process.argv)

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', 'nuxt-phosphor-icons', '@nuxtjs/better-auth', '@nuxtjs/seo', '@nuxt/image', '@nuxt/icon/module', 'nuxt-qrcode', 'dayjs-nuxt', '@vueuse/nuxt/module', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // Pas de mode sombre en v1 : évite la classe `dark` selon la préférence système.
  ui: { colorMode: false },
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
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
})
