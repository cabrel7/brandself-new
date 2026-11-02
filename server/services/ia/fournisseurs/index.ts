import { resolveIaFournisseur } from '../../../../shared/env'
import type { Env } from '../../../../shared/env'
import type { IaProvider } from '../types'
import { creerAnthropicProvider } from './anthropic'
import { creerFauxProvider } from './faux'

// S8 §4.2 : choix du fournisseur (règle #71 dans `resolveIaFournisseur`). C'est le seul endroit qui lit
// `IA_CLE_API`, et seul le worker l'appelle : le processus web n'a jamais besoin de la clé.

export type EnvIa = Pick<Env, 'NODE_ENV' | 'IA_FOURNISSEUR' | 'IA_CLE_API' | 'IA_MODELE'>

/** `null` = aucun fournisseur : toutes les générations finissent en repli `sans_fournisseur`. */
export function createIaProvider(env: EnvIa): IaProvider | null {
  switch (resolveIaFournisseur(env)) {
    case 'anthropic':
      return env.IA_CLE_API ? creerAnthropicProvider({ cleApi: env.IA_CLE_API, modele: env.IA_MODELE }) : null
    case 'faux':
      return creerFauxProvider()
    case 'aucun':
      return null
  }
}
