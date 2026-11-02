import { and, eq } from 'drizzle-orm'
import { promptsIa } from '../../../shared/db/schema'
import type { PromptIa } from '../../../shared/db/schema'
import type { IaType } from '../../../shared/ia'
import {
  SCHEMA_SORTIE_PROPOSITION,
  SCHEMA_SORTIE_TEXTE,
  schemaPromptParametres,
} from '../../../shared/schemas/ia'
import type { PromptParametres } from '../../../shared/schemas/ia'
import { db } from '../../utils/db'

// S8 §4.4 : les prompts vivent en base (versionnés, CLAUDE.md §4 règle 6), jamais dans le code.
// Ce module les charge, vérifie leur cohérence, et rend le gabarit en UNE passe sur une liste blanche.

const VARIABLE_GABARIT = /\{\{(\w+)\}\}/g

/** Variables que le code sait fournir (liste blanche, décision #80). */
export const VARIABLES_AUTORISEES = ['donnees'] as const

/** Identifiant de schéma de sortie attendu pour chaque type (le code en dépend : on le vérifie au chargement). */
const SCHEMA_SORTIE_PAR_TYPE: Record<IaType, string> = {
  onboarding_vitrine: SCHEMA_SORTIE_PROPOSITION,
  ameliorer_texte: SCHEMA_SORTIE_TEXTE,
}

export interface PromptCharge {
  id: string
  type: IaType
  version: number
  systeme: string
  gabarit: string
  parametres: PromptParametres
}

/**
 * Remplace `{{variable}}` en une seule passe (callback : la valeur est insérée telle quelle, jamais
 * lue comme motif de remplacement `$&`, et jamais re-balayée). Une variable hors liste blanche reste
 * en l'état : rien n'est lu dans l'environnement ni dans le prototype.
 */
export function renderGabarit(gabarit: string, valeurs: { donnees: string }): string {
  return gabarit.replace(VARIABLE_GABARIT, (placeholder: string, nom: string) =>
    (VARIABLES_AUTORISEES as readonly string[]).includes(nom) ? valeurs[nom as keyof typeof valeurs] : placeholder,
  )
}

/**
 * Données du gabarit : JSON de l'entrée dont les chevrons sont échappés (\u003c, \u003e), pour qu'un
 * texte saisi ne puisse jamais fermer la balise <donnees>. Le JSON reste valide et équivalent.
 */
export function serialiserDonnees(entree: object): string {
  return JSON.stringify(entree).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

function variablesDuGabarit(gabarit: string): string[] {
  return [...new Set([...gabarit.matchAll(VARIABLE_GABARIT)].map((m) => m[1] ?? ''))].sort()
}

function memesVariables(declarees: readonly string[], trouvees: readonly string[]): boolean {
  const a = [...new Set(declarees)].sort()
  return a.length === trouvees.length && a.every((v, i) => v === trouvees[i])
}

/**
 * Valide une ligne `prompts_ia` : réglages lisibles, variables déclarées = variables du gabarit (toutes
 * autorisées), schéma de sortie attendu par le code. Sinon `null` (le service sert le repli `sans_prompt`).
 * Le journal ne contient que le type et la raison, jamais le texte du prompt.
 */
export function lirePrompt(ligne: PromptIa): PromptCharge | null {
  const echec = (raison: string): null => {
    console.error({ ia: 'prompt invalide', type: ligne.type, raison })
    return null
  }
  const type = ligne.type as IaType
  if (SCHEMA_SORTIE_PAR_TYPE[type] !== ligne.schemaSortie) return echec('schema_sortie')
  const parametres = schemaPromptParametres.safeParse(ligne.parametres)
  if (!parametres.success) return echec('parametres')
  const trouvees = variablesDuGabarit(ligne.gabarit)
  if (!memesVariables(ligne.variables, trouvees)) return echec('variables')
  if (!trouvees.every((v) => (VARIABLES_AUTORISEES as readonly string[]).includes(v))) return echec('variable_inconnue')
  return {
    id: ligne.id,
    type,
    version: ligne.version,
    systeme: ligne.systeme,
    gabarit: ligne.gabarit,
    parametres: parametres.data,
  }
}

/** Version `actif` du type, ou `null` si absente ou incohérente. */
export async function getActivePrompt(type: IaType): Promise<PromptCharge | null> {
  const [ligne] = await db
    .select()
    .from(promptsIa)
    .where(and(eq(promptsIa.type, type), eq(promptsIa.actif, true)))
    .limit(1)
  return ligne ? lirePrompt(ligne) : null
}

/** Prompt avec lequel une génération a été créée (et son empreinte calculée), même s'il n'est plus actif. */
export async function getPromptById(id: string): Promise<PromptCharge | null> {
  const [ligne] = await db.select().from(promptsIa).where(eq(promptsIa.id, id)).limit(1)
  return ligne ? lirePrompt(ligne) : null
}
