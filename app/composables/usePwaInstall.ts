// S15 : detection du mode autonome et gestion de la fenetre d'installation PWA.
// Pas de donnee personnelle : seulement le type d'appareil et l'origine.
// Stockage sur l'appareil (localStorage) pour la frequence (30 j / deux refus).
// Cote client uniquement.

const STORAGE_PREFIX = 'pwa_install_'
const STORAGE_KEY_STATS = `${STORAGE_PREFIX}stats`
const LATER_DAYS = 30
const MAX_REFUSALS = 2

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function isIosSafari(): boolean {
  if (!isClient()) return false
  const ua = window.navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !/Chrome/.test(ua) && /Safari/.test(ua)
}

function isStandalone(): boolean {
  if (!isClient()) return false
  return window.matchMedia('(display-mode: standalone)').matches
}

function getDeviceType(): 'mobile' | 'tablette' | 'ordinateur' | 'inconnu' {
  if (!isClient()) return 'inconnu'
  const ua = window.navigator.userAgent
  if (/tablet|ipad/.test(ua)) return 'tablette'
  if (/mobile|iphone|android/.test(ua)) return 'mobile'
  return 'ordinateur'
}

function getOrigine(): 'studio' | 'marketing' {
  if (!isClient()) return 'marketing'
  const path = window.location.pathname
  if (path.startsWith('/studio/')) return 'studio'
  return 'marketing'
}

function getStorage<T>(key: string, defaultValue: T): T {
  if (!isClient()) return defaultValue
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : defaultValue
  } catch {
    return defaultValue
  }
}

function setStorage<T>(key: string, value: T): void {
  if (!isClient()) return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Silencieux : le stockage local n'est pas critique.
  }
}

export function usePwaInstall() {
  const dejaInstalle = isStandalone()
  const iosSafari = isIosSafari()
  const origine = getOrigine()
  const deviceType = getDeviceType()

  // Recuperation de l'evenement beforeinstallprompt (Chrome/Edge, pas iOS).
  let beforeInstallPromptEvent: Event | null = null
  if (isClient()) {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault()
      beforeInstallPromptEvent = event
    })
  }

  // Verification de la frequence : jamais a la premiere visite, Plus tard = 30 j, deux refus = plus jamais.
  function peutAfficherPrompt(): boolean {
    if (dejaInstalle) return false
    if (iosSafari) return true // iOS : affichage statique des instructions, pas de blocage par refus
    const stats = getStorage<{ refusals: number, lastPrompt?: number }>(STORAGE_KEY_STATS, { refusals: 0 })
    if (stats.refusals >= MAX_REFUSALS) return false // deux refus : plus jamais
    if (stats.refusals === 1 && stats.lastPrompt) {
      const joursDepuis = (Date.now() - stats.lastPrompt) / (1000 * 60 * 60 * 24)
      if (joursDepuis < LATER_DAYS) return false // un refus : delai de 30 jours
    }
    return true
  }

  function afficherPrompt(): void {
    if (!peutAfficherPrompt()) return
  }

  function refuserPrompt(): void {
    if (!isClient()) return
    const stats = getStorage<{ refusals: number, lastPrompt?: number }>(STORAGE_KEY_STATS, { refusals: 0 })
    setStorage(STORAGE_KEY_STATS, { refusals: stats.refusals + 1, lastPrompt: Date.now() })
  }

  async function installer(): Promise<void> {
    if (beforeInstallPromptEvent) {
      ;(beforeInstallPromptEvent as BeforeInstallPromptEvent).prompt()
      await (beforeInstallPromptEvent as BeforeInstallPromptEvent).userChoice
      beforeInstallPromptEvent = null
    } else if (iosSafari) {
      // iOS : pas d'evenement, l'utilisateur suit les instructions manuelles.
    }
  }

  return {
    dejaInstalle,
    iosSafari,
    origine,
    deviceType,
    peutAfficherPrompt,
    afficherPrompt,
    refuserPrompt,
    installer,
  }
}

// Enregistrement du service worker (cote client uniquement, appele des le premier usage du composable).
if (isClient() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
    // Echec silencieux : le SW n'est pas critique pour le fonctionnement de l'app.
  })
}
