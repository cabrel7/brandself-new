import { and, desc, eq } from 'drizzle-orm'
import { promptsIa } from '../../../shared/db/schema'
import type { PromptIa } from '../../../shared/db/schema'
import type { IaType } from '../../../shared/ia'
import {
  SCHEMA_SORTIE_PROPOSITION,
  SCHEMA_SORTIE_SEO,
  SCHEMA_SORTIE_TEXTE,
  schemaPromptParametres,
} from '../../../shared/schemas/ia'
import type { PromptParametres } from '../../../shared/schemas/ia'
import type { ValeursPrompt } from '../../../shared/schemas/admin-versions'
import { UnprocessableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import type { TransactionAdmin } from '../admin/audit'

// S8 §4.4 : les prompts vivent en base (versionnés, CLAUDE.md §4 règle 6), jamais dans le code.
// Ce module les charge, vérifie leur cohérence, et rend le gabarit en UNE passe sur une liste blanche.

const VARIABLE_GABARIT = /\{\{(\w+)\}\}/g

/** Variables que le code sait fournir (liste blanche, décision #80). */
export const VARIABLES_AUTORISEES = ['donnees'] as const

/** Identifiant de schéma de sortie attendu pour chaque type (le code en dépend : on le vérifie au chargement). */
export const SCHEMA_SORTIE_PAR_TYPE: Record<IaType, string> = {
  onboarding_vitrine: SCHEMA_SORTIE_PROPOSITION,
  ameliorer_texte: SCHEMA_SORTIE_TEXTE,
  seo_vitrine: SCHEMA_SORTIE_SEO,
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

export function variablesDuGabarit(gabarit: string): string[] {
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

// ---------------------------------------------------------------------------------------------
// A5 (D-A5-09) : versions de prompt. Éditer = NOUVELLE ligne inactive ; le contenu est figé par un déclencheur de la
// base (`prompts_ia_figer`), seul `actif` bouge. Ces fonctions s'appellent DANS la transaction de l'écriture (le
// verrou, l'idempotence, la réauthentification et le journal sont portés par `configuration/versions.ts`).
// ---------------------------------------------------------------------------------------------

/** Variables du gabarit, triées. Toute variable hors liste blanche : 422 `VARIABLE_INCONNUE` (CA09), rien n'est écrit. */
export function variablesAutoriseesDuGabarit(gabarit: string): string[] {
  const trouvees = variablesDuGabarit(gabarit)
  const inconnues = trouvees.filter((nom) => !(VARIABLES_AUTORISEES as readonly string[]).includes(nom))
  if (inconnues.length > 0) {
    throw new UnprocessableError('VARIABLE_INCONNUE', { champs: { 'valeurs.gabarit': inconnues.map((nom) => `{{${nom}}}`) } })
  }
  return trouvees
}

export interface NouvelleVersionPrompt {
  id: string
  type: IaType
  valeurs: ValeursPrompt
  creePar: string
  motif: string
}

/** Nouvelle ligne `prompts_ia` INACTIVE (numéro = dernier + 1). `variables` et `schema_sortie` sont calculés par le serveur. */
export async function creerVersionPrompt(tx: TransactionAdmin, entree: NouvelleVersionPrompt): Promise<PromptIa> {
  const variables = variablesAutoriseesDuGabarit(entree.valeurs.gabarit)
  const [derniere] = await tx
    .select({ version: promptsIa.version })
    .from(promptsIa)
    .where(eq(promptsIa.type, entree.type))
    .orderBy(desc(promptsIa.version))
    .limit(1)
  const [creee] = await tx
    .insert(promptsIa)
    .values({
      id: entree.id,
      type: entree.type,
      version: (derniere?.version ?? 0) + 1,
      systeme: entree.valeurs.systeme,
      gabarit: entree.valeurs.gabarit,
      variables,
      parametres: entree.valeurs.parametres,
      schemaSortie: SCHEMA_SORTIE_PAR_TYPE[entree.type],
      actif: false,
      motif: entree.motif,
      creePar: entree.creePar,
    })
    .returning()
  if (!creee) throw new Error('PROMPT_NON_CREE')
  return creee
}

/**
 * Active une version (désactive l'ancienne dans la même transaction : l'index unique partiel n'admet qu'une active).
 * Une ligne que `lirePrompt` refuse (schéma de sortie, réglages, variables) n'est jamais activée : sinon chaque
 * génération tomberait en repli `sans_prompt`. Sert aussi au retour arrière (réactiver une version précédente).
 */
export async function activerPrompt(
  tx: TransactionAdmin,
  id: string,
): Promise<{ precedente: PromptIa | null, activee: PromptIa }> {
  const [cible] = await tx.select().from(promptsIa).where(eq(promptsIa.id, id)).for('update').limit(1)
  if (!cible) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  if (cible.actif || lirePrompt(cible) === null) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  const [precedente] = await tx
    .update(promptsIa)
    .set({ actif: false })
    .where(and(eq(promptsIa.type, cible.type), eq(promptsIa.actif, true)))
    .returning()
  const [activee] = await tx.update(promptsIa).set({ actif: true }).where(eq(promptsIa.id, id)).returning()
  if (!activee) throw new Error('PROMPT_NON_ACTIVE')
  return { precedente: precedente ?? null, activee }
}
