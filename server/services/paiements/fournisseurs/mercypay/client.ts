import {
  MERCY_ENTETE_IDEMPOTENCE,
  MERCY_REPONSE_MAX_OCTETS,
  MERCY_RETRY_APRES_MAX_S,
} from './constantes'

// P1 (docs/specs/P1-mercypay.md §4.2) : client HTTP minimal de Mercy Pay (`fetch` natif, aucune bibliothèque). Règles de
// sécurité : la clé ne va que dans l'en-tête `Authorization`, jamais dans une URL, un message d'erreur ou un journal ;
// aucune redirection suivie (l'en-tête partirait vers un autre hôte) ; la réponse est lue avec un plafond de taille ;
// aucun nouvel essai (le rejeu avec la même `Idempotency-Key` est l'affaire de l'appelant). Ce module ne journalise rien.

export interface OptionsClientMercy {
  /** Adresse de base avec `/api/v1`, sans barre finale (validée par `loadEnv`). */
  baseUrl: string
  cleApi: string
  /** Transport injectable (tests). */
  fetch?: typeof fetch
}

export interface ReponseMercy {
  statut: number
  /** Corps JSON décodé, `undefined` s'il est absent, illisible ou trop gros. Jamais journalisé. */
  corps: unknown
  /** Secondes demandées par `Retry-After`, plafonnées ; `null` si absent ou illisible. */
  retryAfterS: number | null
}

/** Échec de transport : délai dépassé (`DELAI`) ou toute autre panne réseau (`RESEAU`). */
export class MercyTransportError extends Error {
  readonly code: 'DELAI' | 'RESEAU'

  constructor(code: 'DELAI' | 'RESEAU') {
    super(`MERCYPAY_TRANSPORT_${code}`)
    this.name = 'MercyTransportError'
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
    if (total > MERCY_REPONSE_MAX_OCTETS) {
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
  return Number.isInteger(secondes) && secondes > 0 ? Math.min(secondes, MERCY_RETRY_APRES_MAX_S) : null
}

export interface ClientMercy {
  /** `cleIdempotence` = notre identifiant de paiement, réutilisé à l'identique pour chaque rejeu. */
  post(chemin: string, corps: string, cleIdempotence: string, signal: AbortSignal): Promise<ReponseMercy>
  get(chemin: string, signal: AbortSignal): Promise<ReponseMercy>
}

export function creerClientMercy({ baseUrl, cleApi, fetch: transport = fetch }: OptionsClientMercy): ClientMercy {
  async function requete(
    methode: 'GET' | 'POST',
    chemin: string,
    corps: string | undefined,
    cleIdempotence: string | undefined,
    signal: AbortSignal,
  ): Promise<ReponseMercy> {
    const entetes: Record<string, string> = {
      Authorization: `Bearer ${cleApi}`,
      Accept: 'application/json',
    }
    if (corps !== undefined) entetes['Content-Type'] = 'application/json'
    if (cleIdempotence !== undefined) entetes[MERCY_ENTETE_IDEMPOTENCE] = cleIdempotence
    try {
      const reponse = await transport(`${baseUrl}${chemin}`, {
        method: methode,
        headers: entetes,
        ...(corps === undefined ? {} : { body: corps }),
        signal,
        redirect: 'error',
      })
      return { statut: reponse.status, corps: await lireCorpsBorne(reponse), retryAfterS: lireRetryAfter(reponse) }
    } catch (erreur) {
      // Le message d'origine n'est pas conservé : il peut contenir l'adresse ou un fragment de réponse.
      const delai = signal.aborted || (erreur instanceof Error && NOMS_ERREUR_DELAI.has(erreur.name))
      throw new MercyTransportError(delai ? 'DELAI' : 'RESEAU')
    }
  }

  return {
    post: (chemin, corps, cleIdempotence, signal) => requete('POST', chemin, corps, cleIdempotence, signal),
    get: (chemin, signal) => requete('GET', chemin, undefined, undefined, signal),
  }
}
