// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', 'nuxt-phosphor-icons', '@nuxtjs/better-auth', '@nuxtjs/seo', '@nuxt/image', '@nuxt/icon/module', 'nuxt-qrcode', 'dayjs-nuxt', '@vueuse/nuxt/module'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      version: '0.1.0',
    },
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true }
})
