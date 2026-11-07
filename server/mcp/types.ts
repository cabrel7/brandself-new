// S16 : types partagés du serveur MCP. Aucun secret n'y transite.

import type { Scope } from './auth'
import type { ZodTypeAny } from 'zod'

export type { Scope }

export interface ContexteMcp {
  userId: string
  vitrineId: string
  assistantId: string
  scopes: readonly Scope[]
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

export interface OutilResultat {
  content: Array<{ type: 'text', text: string }>
  isError?: boolean
}

export interface RequeteJsonRpc {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

export interface ReponseJsonRpc {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number, message: string, data?: unknown }
}
