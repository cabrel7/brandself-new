// S15 : service worker statique pour le studio et les pages marketing jesuis.pro.
// Rôle unique : page de repli hors ligne (/offline.html) et icônes de marque disponibles sans réseau.
// Aucune donnée personnelle, aucune réponse d'API, aucun script de l'application en cache.
//
// Règle de sûreté : on n'intercepte QUE les navigations et les fichiers listés dans PRECACHE.
// Tout le reste (/_nuxt/*, modules Vite du mode développement, polices, images de vitrine) passe
// par le réseau sans que ce worker s'en mêle. Un cache « d'abord » sur /_nuxt/ servait des modules
// périmés après chaque build ou réoptimisation de Vite (« Failed to fetch dynamically imported module »).

const CACHE_NAME = 'jesuis-pro-v2'
const PRECACHE = [
  '/brand/icone.png',
  '/brand/favicon.svg',
  '/brand/apple-touch-icon.png',
  '/brand/logo.svg',
  '/offline.html',
]
const PAGE_HORS_LIGNE = '/offline.html'

// Installation : précharge uniquement le strict nécessaire.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

// Activation : supprime tous les anciens caches (dont jesuis-pro-v1, qui contenait des modules périmés).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Pages : réseau d'abord, page de repli si le réseau est indisponible.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(PAGE_HORS_LIGNE).then((reponse) => reponse ?? Response.error())),
    )
    return
  }

  // Fichiers préchargés : cache d'abord. Tout le reste n'est pas intercepté.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((enCache) => enCache ?? fetch(request)))
  }
})
