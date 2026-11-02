import type { IaFournisseurAppele } from '../../../shared/ia'

// S8 §4.1 : interface du fournisseur d'IA. Le service ne connaît que ce contrat ; l'adaptateur Anthropic
// et le faux fournisseur (tests) l'implémentent. Aucun import de SDK ici.

export interface IaOutil {
  nom: string
  description: string
  /** JSON Schema de la sortie attendue (z.toJSONSchema). */
  schema: Record<string, unknown>
}

export interface IaRequete {
  systeme: string
  message: string
  outil: IaOutil
  parametres: { temperature: number, maxTokens: number }
  /** Délai maximal de CETTE tentative, en millisecondes. */
  delaiMs: number
  signal: AbortSignal
}

export interface IaReponse {
  /** Entrée de l'outil appelé : non fiable, toujours validée par Zod avant usage. */
  donnees: unknown
  tokensEntree: number
  tokensSortie: number
  modele: string
}

export interface IaProvider {
  readonly nom: IaFournisseurAppele
  generer(requete: IaRequete): Promise<IaReponse>
}

export type IaErreurFournisseurCode = 'delai' | 'fournisseur' | 'reponse_vide'

/** Erreur d'un fournisseur : un code court, jamais le message brut (il peut contenir des données). */
export class IaErreur extends Error {
  constructor(public readonly code: IaErreurFournisseurCode) {
    super(code)
    this.name = 'IaErreur'
  }
}

/** Dépendances de l'exécuteur : l'horloge et l'attente sont injectables (tests déterministes). */
export interface ExecutionDeps {
  /** `null` = aucun fournisseur résolu (repli `sans_fournisseur`). */
  provider: IaProvider | null
  now(): number
  sleep(ms: number): Promise<void>
}
