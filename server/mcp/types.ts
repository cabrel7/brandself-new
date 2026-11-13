// S16 : types partagés du serveur MCP. Aucun secret n'y transite.

import type { Scope } from './auth'
import type { ZodTypeAny } from 'zod'

export type { Scope }

/**
 * Contexte d'un appel d'outil. `vitrineId`, `username` et `fuseau` viennent TOUJOURS de la vitrine de l'utilisateur
 * authentifié (résolue côté serveur), jamais des arguments de l'assistant.
 */
export interface ContexteMcp {
  userId: string
  vitrineId: string
  username: string
  /** Fuseau IANA de la vitrine : toutes les heures renvoyées à l'assistant sont exprimées dans ce fuseau. */
  fuseau: string
  assistantId: string
  scopes: readonly Scope[]
}

/** Ce que le jeton fournit ; le reste du contexte est résolu en base par le serveur. */
export type BaseContexteMcp = Omit<ContexteMcp, 'vitrineId' | 'username' | 'fuseau'>

export interface OptionsHandlerMcp {
  cleIdempotence?: string
  /** Réglage « détail des réservations et des messages » (décision #21) : toujours faux tant qu'il n'est pas câblé. */
  detailAutorise?: boolean
  /** Horloge injectable (tests) ; `new Date()` par défaut. */
  maintenant?: Date
}

export interface OutilMcpDefinition {
  nom: string
  description: string
  annotation: 'lecture seule' | 'écriture'
  scopes: readonly Scope[]
  /** Clé d'idempotence acceptée (outils d'écriture uniquement). */
  idempotence: boolean
  /** Schéma Zod de validation des arguments d'entrée. */
  schema: ZodTypeAny
}
