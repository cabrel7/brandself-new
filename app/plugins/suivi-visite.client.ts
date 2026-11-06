// S11 (#183) : envoi de la vue depuis le navigateur, jamais depuis le HTML.
// Contrat S12 : le microcache de 10 s ne doit compter aucune vue — d'où un plugin
// `.client` (aucun envoi au SSR), un envoi par navigation après `page:finish`,
// planifié dans le temps mort du navigateur et jamais bloquant : une 429 ou une
// erreur réseau n'interrompt jamais la navigation (échec silencieux).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('page:finish', () => {
    const route = useRoute()
    const username = route.params.username
    // Pages studio, tarifs, connexion, accueil… : aucune n'a ce paramètre de route.
    if (typeof username !== 'string') return

    const envoyer = (): void => {
      void fetch(`/api/public/${encodeURIComponent(username)}/vue`, {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chemin: window.location.pathname, origine: document.referrer || null }),
      }).catch(() => {})
    }

    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(envoyer, { timeout: 2000 })
    else window.setTimeout(envoyer, 0)
  })
})
