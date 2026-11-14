import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  CLE_STOCKAGE_INSTALLATION,
  ETAT_INITIAL,
  avecAffichage,
  avecPlusTard,
  avecRefus,
  avecVisite,
  cheminAutorise,
  lireEtat,
  origineDuChemin,
  peutAfficher,
  typeAppareil,
} from '../utils/pwa-install'
import type { ContexteAffichage, EtatInstallation, TypeAppareil } from '../utils/pwa-install'

// S15 : fenêtre d'installation PWA du studio. Règles dans app/utils/pwa-install.ts :
// jamais à la 1re visite, jamais pendant une saisie ni si un autre message est ouvert,
// « Plus tard » = 30 jours, deux refus = plus jamais, mêmes limites sur tous les appareils.
// Pas de donnée personnelle : type d'appareil et origine seulement. Côté client uniquement.

const CLE_SESSION = 'pwa_install_session'
/** Délai avant de proposer : laisse la page se poser, et à l'utilisateur de commencer sa tâche. */
const DELAI_PROPOSITION_MS = 4000
const TENTATIVES_MAX = 5

const SELECTEUR_MESSAGE_OUVERT = [
  '[role="dialog"]:not([data-pwa-install])',
  '[role="alertdialog"]',
  '[role="alert"]',
  '[aria-modal="true"]',
  '[data-message-ouvert]',
].join(',')

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
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua) && /Safari/.test(ua)
}

function isStandalone(): boolean {
  if (!isClient()) return false
  return window.matchMedia('(display-mode: standalone)').matches
}

function lireEtatStocke(): EtatInstallation {
  try {
    return lireEtat(localStorage.getItem(CLE_STOCKAGE_INSTALLATION))
  }
  catch {
    return { ...ETAT_INITIAL }
  }
}

function ecrireEtatStocke(etat: EtatInstallation): void {
  try {
    localStorage.setItem(CLE_STOCKAGE_INSTALLATION, JSON.stringify(etat))
  }
  catch {
    // Stockage indisponible (navigation privée, quota) : pas critique, la fenêtre ne s'affichera simplement pas.
  }
}

/** Vrai à la première lecture d'une session : une visite = une session de navigation, pas un rechargement. */
function premiereLectureDeSession(): boolean {
  try {
    if (sessionStorage.getItem(CLE_SESSION)) return false
    sessionStorage.setItem(CLE_SESSION, '1')
    return true
  }
  catch {
    return true
  }
}

function saisieEnCours(): boolean {
  const actif = document.activeElement
  if (!(actif instanceof HTMLElement)) return false
  return actif instanceof HTMLInputElement || actif instanceof HTMLTextAreaElement || actif instanceof HTMLSelectElement || actif.isContentEditable
}

function messageOuvert(): boolean {
  return document.querySelector(SELECTEUR_MESSAGE_OUVERT) !== null
}

// Événement natif (Chrome/Edge) : un seul écouteur pour toute l'application.
let evenementInstallation: BeforeInstallPromptEvent | null = null
const evenementRecu = ref(false)
if (isClient()) {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    evenementInstallation = event as BeforeInstallPromptEvent
    evenementRecu.value = true
  })
}

export type ResultatInstallation = 'acceptee' | 'refusee' | 'indisponible'

/** Ouvre l'invite native du navigateur (une seule fois par événement reçu). */
async function lancerInstallation(): Promise<ResultatInstallation> {
  const evenement = evenementInstallation
  if (!evenement) return 'indisponible'
  evenementInstallation = null
  try {
    await evenement.prompt()
    const { outcome } = await evenement.userChoice
    return outcome === 'accepted' ? 'acceptee' : 'refusee'
  }
  catch {
    return 'indisponible'
  }
}

/** Accès simple à l'installation (page Compte) : aucune fenêtre, aucun minuteur. */
export function usePwaInstall() {
  enregistrerServiceWorker()
  const dejaInstalle = isStandalone()
  const appareil: TypeAppareil = isClient() ? typeAppareil(window.navigator.userAgent) : 'inconnu'
  return { dejaInstalle, appareil, installer: lancerInstallation }
}

/** Fenêtre d'installation affichée selon les règles S15 (montée une seule fois, dans app.vue). */
export function useInstallPrompt() {
  enregistrerServiceWorker()
  const route = useRoute()
  const { enregistrerEvenement } = usePwaStats()

  const visible = ref(false)
  const iosSafari = ref(false)
  const appareil = ref<TypeAppareil>('inconnu')

  let minuterie: ReturnType<typeof setTimeout> | null = null
  let dejaProposeSession = false
  let tentatives = 0

  function contexte(): ContexteAffichage {
    return {
      chemin: route.path,
      maintenant: Date.now(),
      dejaInstalle: isStandalone(),
      installable: iosSafari.value || evenementInstallation !== null,
      saisieEnCours: saisieEnCours(),
      messageOuvert: messageOuvert(),
      dejaProposeSession,
    }
  }

  function annulerMinuterie(): void {
    if (minuterie) clearTimeout(minuterie)
    minuterie = null
  }

  function tenter(): void {
    minuterie = null
    if (visible.value) return
    const etat = lireEtatStocke()
    const ctx = contexte()
    if (peutAfficher(etat, ctx)) {
      dejaProposeSession = true
      // L'horodatage est posé au moment où la fenêtre apparaît, pas à sa fermeture.
      ecrireEtatStocke(avecAffichage(etat, ctx.maintenant))
      visible.value = true
      void enregistrerEvenement('proposee', origineDuChemin(ctx.chemin), appareil.value)
      return
    }
    // Bloquée seulement par un champ actif ou un message : on réessaie un peu plus tard.
    const bloqueeTemporairement = ctx.saisieEnCours || ctx.messageOuvert
    if (bloqueeTemporairement && tentatives < TENTATIVES_MAX
      && peutAfficher(etat, { ...ctx, saisieEnCours: false, messageOuvert: false })) {
      tentatives += 1
      planifier(false)
    }
  }

  function planifier(reinitialiser = true): void {
    annulerMinuterie()
    if (reinitialiser) tentatives = 0
    minuterie = setTimeout(tenter, DELAI_PROPOSITION_MS)
  }

  function fermerFenetre(): void {
    visible.value = false
  }

  /** « Plus tard », Échap, croix : revient dans 30 jours, ne compte pas comme un refus. */
  function plusTard(): void {
    ecrireEtatStocke(avecPlusTard(lireEtatStocke(), Date.now()))
    fermerFenetre()
  }

  /** « Non merci » : refus explicite. Deux refus = plus jamais. */
  function refuser(): void {
    ecrireEtatStocke(avecRefus(lireEtatStocke(), Date.now()))
    fermerFenetre()
    void enregistrerEvenement('refusee', origineDuChemin(route.path), appareil.value)
  }

  async function installer(): Promise<void> {
    fermerFenetre()
    const resultat = await lancerInstallation()
    if (resultat === 'acceptee') {
      void enregistrerEvenement('installee', origineDuChemin(route.path), appareil.value)
    }
    else if (resultat === 'refusee') {
      ecrireEtatStocke(avecRefus(lireEtatStocke(), Date.now()))
      void enregistrerEvenement('refusee', origineDuChemin(route.path), appareil.value)
    }
  }

  function surTouche(event: KeyboardEvent): void {
    if (event.key === 'Escape' && visible.value && !event.defaultPrevented) plusTard()
  }

  onMounted(() => {
    iosSafari.value = isIosSafari()
    appareil.value = typeAppareil(window.navigator.userAgent)
    if (isStandalone()) return
    if (premiereLectureDeSession()) ecrireEtatStocke(avecVisite(lireEtatStocke()))
    document.addEventListener('keydown', surTouche)
    watch(() => route.path, (chemin) => {
      if (visible.value && !cheminAutorise(chemin)) fermerFenetre()
      else if (!visible.value) planifier()
    }, { immediate: true })
    watch(evenementRecu, () => {
      if (!visible.value) planifier()
    })
  })

  onBeforeUnmount(() => {
    annulerMinuterie()
    if (isClient()) document.removeEventListener('keydown', surTouche)
  })

  return { visible, iosSafari, appareil, plusTard, refuser, installer }
}

// Enregistrement du service worker (côté client uniquement, une seule fois, au premier usage d'un composable
// ci-dessus). A1 : jamais sur l'hôte d'administration (aucun service worker, aucune mise en cache).
let serviceWorkerDemande = false
function enregistrerServiceWorker(): void {
  if (serviceWorkerDemande || !isClient() || !('serviceWorker' in navigator)) return
  serviceWorkerDemande = true
  if (useHoteAdmin()) return
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
    // Échec silencieux : le SW n'est pas critique pour le fonctionnement de l'app.
  })
}
