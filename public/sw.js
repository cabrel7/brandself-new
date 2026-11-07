// S15 : service worker statique pour le studio et les pages marketing jesuis.pro.
// Precache les fichiers statiques du studio (polices, scripts, icônes).
// Aucune donnee personnelle, aucune reponse d'API mise en cache.
// Page de repli hors ligne chaude : /offline.html.

const CACHE_NAME = 'jesuis-pro-v1'
const STATIC_ASSETS = [
  '/',
  '/studio/',
  '/studio/agenda',
  '/studio/services',
  '/brand/icone.png',
  '/brand/favicon.svg',
  '/brand/apple-touch-icon.png',
  '/brand/logo.svg',
  '/offline.html',
]

// Installation : precache les assets statiques.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  )
})

// Activation : supprime les anciens caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  )
})

// Interception des requetes : reseau d'abord, cache en secours pour les assets statiques,
// page de repli hors ligne pour les pages du studio/marketing en cas d'echec.
// Jamais de cache pour les reponses d'API ni donnees personnelles.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Ne jamais intercepter les appels d'API.
  if (url.pathname.startsWith('/api/')) return

  // Pour les pages HTML : reseau d'abord, cache en secours, repli hors ligne.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/offline.html')
      )
    )
    return
  }

  // Pour les assets statiques : cache d'abord, reseau en secours.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        // Mise en cache uniquement des assets du meme origine et non-API.
        if (response.ok && url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
