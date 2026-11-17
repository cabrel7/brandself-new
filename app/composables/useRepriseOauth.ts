import type { LocationQueryRaw } from 'vue-router'

/** Chemin Better Auth qui reprend une autorisation OAuth (une fois connecté, il renvoie vers la page de consentement). */
export const CHEMIN_AUTORISATION_OAUTH = '/api/auth/oauth2/authorize'
/** Page de consentement : si elle est ouverte sans session, le module d'auth renvoie vers /connexion?redirect=<cette page + query>. */
export const CHEMIN_CONSENTEMENT = '/studio/assistants/autorisation'
const PARAM_REDIRECTION = 'redirect'
const TAILLE_MAX_QUERY = 8192
const PARAM_CLIENT = 'client_id'
const PARAM_SIGNATURE = 'sig'

/** Une query OAuth émise par Better Auth : identifiant de client et signature, chacun une seule fois. */
function estQueryOauth(params: URLSearchParams): boolean {
  return params.getAll(PARAM_CLIENT).length === 1
    && Boolean(params.get(PARAM_CLIENT))
    && params.getAll(PARAM_SIGNATURE).length === 1
    && Boolean(params.get(PARAM_SIGNATURE))
}

function valider(query: string): string {
  if (!query || query.length > TAILLE_MAX_QUERY) return ''
  return estQueryOauth(new URLSearchParams(query)) ? query : ''
}

/**
 * Extrait la query OAuth d'une query string (avec ou sans `?`) : soit directement (redirection de Better Auth),
 * soit dans `redirect` quand cette valeur est EXACTEMENT notre page de consentement (redirection du module d'auth).
 * Retourne '' si ce n'est pas une query OAuth valable. Ne retourne jamais autre chose qu'une query string.
 */
export function extraireQueryOauth(recherche: string): string {
  const brute = recherche.replace(/^\?/, '')
  const directe = valider(brute)
  if (directe) return directe
  const redirection = new URLSearchParams(brute).get(PARAM_REDIRECTION)
  const prefixe = `${CHEMIN_CONSENTEMENT}?`
  if (redirection?.startsWith(prefixe)) return valider(redirection.slice(prefixe.length))
  return ''
}

/** Query string brute de la page courante (sans `?`), à lire au moment de l'action ; '' hors navigateur. */
export function lireQueryOauthBrute(): string {
  return import.meta.client ? extraireQueryOauth(window.location.search) : ''
}

/**
 * Reprise d'une autorisation OAuth à travers la connexion : la query émise par Better Auth (client_id, scope,
 * sig, exp…) suit l'utilisateur d'écran en écran, puis `reprendre()` renvoie vers authorize.
 * Sécurité : la destination est TOUJOURS `CHEMIN_AUTORISATION_OAUTH` + la query ; aucune URL reçue n'est suivie.
 */
export function useRepriseOauth() {
  const route = useRoute()

  /** Query à reporter sur les liens et redirections internes (vide sans reprise en cours). */
  const queryReprise = computed<LocationQueryRaw>(() => {
    const query = extraireQueryOauth(route.fullPath.split('?').slice(1).join('?'))
    const resultat: Record<string, string | string[]> = {}
    for (const [cle, valeur] of new URLSearchParams(query)) {
      const existant = resultat[cle]
      if (existant === undefined) resultat[cle] = valeur
      else resultat[cle] = Array.isArray(existant) ? [...existant, valeur] : [existant, valeur]
    }
    return resultat
  })

  const enCours = computed(() => Object.keys(queryReprise.value).length > 0)

  /** Cible interne pour aller à un écran de connexion en gardant la reprise. */
  function versConnexion(chemin: '/connexion' | '/connexion/code'): { path: string, query: LocationQueryRaw } {
    return { path: chemin, query: queryReprise.value }
  }

  /** URL de reprise de l'autorisation, ou `null` s'il n'y a pas de reprise valable. */
  function urlReprise(): string | null {
    const brute = lireQueryOauthBrute()
    return brute ? `${CHEMIN_AUTORISATION_OAUTH}?${brute}` : null
  }

  /** Navigation complète (la route est servie par Better Auth, pas par le routeur). Renvoie `false` sans reprise. */
  function reprendre(): boolean {
    const url = urlReprise()
    if (!url) return false
    window.location.href = url
    return true
  }

  return { enCours, queryReprise, versConnexion, urlReprise, reprendre }
}
