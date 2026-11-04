import { KPAY_ENTETE_CLE_API, KPAY_ENTETE_CLE_SECRETE, KPAY_REPONSE_MAX_OCTETS, KPAY_RETRY_APRES_MAX_S } from './constantes'

// S10 (docs/specs/S10-abonnements.md §5.2) : client HTTP minimal de K-PAY (`fetch` natif, aucune bibliothèque).
// Règles de sécurité : les clés ne vont que dans les en-têtes, jamais dans une URL, un message d'erreur ou un
// journal ; aucune redirection suivie (les en-têtes personnalisés partiraient vers un autre hôte) ; la réponse est
// lue avec un plafond de taille ; aucun nouvel essai. Ce module ne journalise rien.

export interface OptionsClientKpay {
  /** Adresse de base, sans barre finale (validée par `loadEnv`). */
  baseUrl: string
  cleApi: string
  cleSecrete: string
  /** Transport injectable (tests). */
  fetch?: typeof fetch
}

export interface ReponseKpay {
  statut: number
  /** Corps JSON décodé, `undefined` s'il est absent, illisible ou trop gros. Jamais journalisé. */
  corps: unknown
  /** Secondes demandées par `Retry-After`, plafonnées ; `null` si absent ou illisible. */
  retryAfterS: number | null
}

/** Échec de transport : délai dépassé (`DELAI`) ou toute autre panne réseau (`RESEAU`). */
export class KpayTransportError extends Error {
  readonly code: 'DELAI' | 'RESEAU'

  constructor(code: 'DELAI' | 'RESEAU') {
    super(`KPAY_TRANSPORT_${code}`)
    this.name = 'KpayTransportError'
    this.code = code
  }
}

const NOMS_ERREUR_DELAI = new Set(['TimeoutError', 'AbortError'])

async function lireCorpsBorne(reponse: Response): Promise<unknown> {
  const flux = reponse.body
  if (!flux) return undefined
  const lecteur = flux.getReader()
  const morceaux: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) break
    total += value.byteLength
    if (total > KPAY_REPONSE_MAX_OCTETS) {
      await lecteur.cancel()
      return undefined
    }
    morceaux.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(morceaux).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function lireRetryAfter(reponse: Response): number | null {
  const brut = reponse.headers.get('retry-after')
  if (brut === null) return null
  const secondes = Number.parseInt(brut, 10)
  return Number.isInteger(secondes) && secondes > 0 ? Math.min(secondes, KPAY_RETRY_APRES_MAX_S) : null
}

export interface ClientKpay {
  post(chemin: string, corps: unknown, signal: AbortSignal): Promise<ReponseKpay>
  get(chemin: string, signal: AbortSignal): Promise<ReponseKpay>
}

export function creerClientKpay({ baseUrl, cleApi, cleSecrete, fetch: transport = fetch }: OptionsClientKpay): ClientKpay {
  async function requete(methode: 'GET' | 'POST', chemin: string, corps: unknown, signal: AbortSignal): Promise<ReponseKpay> {
    const entetes: Record<string, string> = {
      [KPAY_ENTETE_CLE_API]: cleApi,
      [KPAY_ENTETE_CLE_SECRETE]: cleSecrete,
      Accept: 'application/json',
    }
    if (corps !== undefined) entetes['Content-Type'] = 'application/json'
    try {
      const reponse = await transport(`${baseUrl}${chemin}`, {
        method: methode,
        headers: entetes,
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
        signal,
        redirect: 'error',
      })
      return { statut: reponse.status, corps: await lireCorpsBorne(reponse), retryAfterS: lireRetryAfter(reponse) }
    } catch (erreur) {
      // Le message d'origine n'est pas conservé : il peut contenir l'adresse ou un fragment de réponse.
      const delai = signal.aborted || (erreur instanceof Error && NOMS_ERREUR_DELAI.has(erreur.name))
      throw new KpayTransportError(delai ? 'DELAI' : 'RESEAU')
    }
  }

  return {
    post: (chemin, corps, signal) => requete('POST', chemin, corps, signal),
    get: (chemin, signal) => requete('GET', chemin, undefined, signal),
  }
}
