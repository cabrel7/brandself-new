// A4 (D-A4-04) : « valeur du code » d'un réglage, quand la table `reglages` n'a pas de ligne. SEUL lecteur de `env` pour
// les réglages : le registre (shared/reglages.ts) reste pur. Trois réglages tirent leur valeur d'une variable
// d'environnement (D-A4-07), les autres de leur défaut de registre.
import { env } from '../../shared/env'
import { REGLAGES } from '../../shared/reglages'
import type { ReglageCle, ReglageValeur } from '../../shared/reglages'

export function valeurDuCode(cle: ReglageCle): ReglageValeur {
  const definition = REGLAGES[cle]
  const variable = 'variableEnv' in definition ? definition.variableEnv : undefined
  switch (variable) {
    case 'MCP_ACTIF':
      return env.MCP_ACTIF
    case 'PAIEMENT_EN_LIGNE':
      return env.PAIEMENT_EN_LIGNE
    case 'SEO_IA_REGENERATION_ACTIVE':
      return env.SEO_IA_REGENERATION_ACTIVE
    case undefined:
      return definition.defaut
  }
}
