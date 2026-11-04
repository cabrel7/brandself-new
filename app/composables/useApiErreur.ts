import type { ErrorCode } from '#shared/erreurs'

/** Erreur d'API lue de façon sûre (contrat : docs/specs/S2-backend.md §5). */
export interface ErreurApi {
  statut: number | null
  code: ErrorCode | null
  champs: Record<string, string[] | undefined>
  manquants: string[]
  /** TROP_DE_REQUETES : secondes avant la fin de la fenêtre. */
  retryAfter: number | null
  /** Détails bruts de l'erreur (`data` du corps) : ressource et limite d'un plan, id d'un paiement ouvert… */
  donnees: Record<string, unknown>
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null
}

function listeTexte(valeur: unknown): string[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Extrait statut, code et détails d'une erreur de `$fetch` / `useFetch`.
 * Le corps de l'erreur est `{ statusCode, message, data: { code, champs?, manquants? } }`.
 */
export function lireErreurApi(erreur: unknown): ErreurApi {
  const resultat: ErreurApi = { statut: null, code: null, champs: {}, manquants: [], retryAfter: null, donnees: {} }
  if (!estObjet(erreur)) return resultat

  if (typeof erreur.statusCode === 'number') resultat.statut = erreur.statusCode
  else if (typeof erreur.status === 'number') resultat.statut = erreur.status

  const corps = estObjet(erreur.data) ? erreur.data : null
  const details = corps && estObjet(corps.data) ? corps.data : corps
  if (!details) return resultat

  resultat.donnees = details

  if (typeof details.code === 'string') resultat.code = details.code as ErrorCode
  if (typeof details.retryAfter === 'number') resultat.retryAfter = details.retryAfter
  if (estObjet(details.champs)) {
    for (const [nom, messages] of Object.entries(details.champs)) {
      resultat.champs[nom] = listeTexte(messages)
    }
  }
  resultat.manquants = listeTexte(details.manquants)
  return resultat
}
