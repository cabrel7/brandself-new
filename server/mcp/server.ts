// S16 : point d'entrée du serveur MCP (transport HTTP, route /mcp).
// Protocole MCP 2026-07-28 sur Streamable HTTP : méthodes tools/list et tools/call.
// Aucune logique métier ici : chaque outil délègue aux services existants.

import type { H3Event } from 'h3'
import { readBody, setHeader } from 'h3'
import { z } from 'zod'
import { OUTILS_MCP, type NomOutilMcp, trouverOutil } from './tools'
import {
  TOUTES_PORTÉES,
  verifierMcpActif,
  authentifierMcp,
  verifierPlanPayant,
  verifierPortées,
  resoudreVitrine,
} from './auth'
import { limiterRequête, limiterCréation } from './rate-limit'
import { journaliserAppel } from './journal'
import type { ContexteMcp, ReponseJsonRpc } from './types'

import { executer as executerObtenirVitrine } from './tools/obtenir-vitrine'
import { executer as executerListerServices } from './tools/lister-services'
import { executer as executerCreerService } from './tools/creer-service'
import { executer as executerModifierService } from './tools/modifier-service'
import { executer as executerListerRealisations } from './tools/lister-realisations'
import { executer as executerCreerRealisation } from './tools/creer-realisation'
import { executer as executerModifierRealisation } from './tools/modifier-realisation'
import { executer as executerListerReservations } from './tools/lister-reservations'
import { executer as executerListerMessages } from './tools/lister-messages'

const HANDLERS: Record<NomOutilMcp, (args: unknown, contexte: ContexteMcp, options: { cleIdempotence?: string, detailAutorise?: boolean }) => Promise<unknown>> = {
  obtenir_vitrine: executerObtenirVitrine,
  lister_services: executerListerServices,
  creer_service: executerCreerService,
  modifier_service: executerModifierService,
  lister_realisations: executerListerRealisations,
  creer_realisation: executerCreerRealisation,
  modifier_realisation: executerModifierRealisation,
  lister_reservations: executerListerReservations,
  lister_messages: executerListerMessages,
}

const MCP_ACTIF = (typeof process !== 'undefined' && process.env.MCP_ACTIF) === 'true'

const JSONRPC_PARSE_ERROR = { code: -32700, message: 'Erreur d’analyse du corps JSON-RPC.' }
const JSONRPC_INVALID_REQUEST = { code: -32600, message: 'Requête JSON-RPC invalide.' }
const JSONRPC_METHOD_NOT_FOUND = { code: -32601, message: 'Méthode inconnue.' }
const JSONRPC_INVALID_PARAMS = { code: -32602, message: 'Paramètres invalides.' }

const schemaJsonRpc = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string(),
  params: z.record(z.string(), z.any()).optional(),
})

function reponseSucces(id: string | number | null, result: unknown): ReponseJsonRpc {
  return { jsonrpc: '2.0', id, result }
}

function reponseErreur(id: string | number | null, error: { code: number, message: string }): ReponseJsonRpc {
  return { jsonrpc: '2.0', id, error }
}

function resumerArguments(nom: string, args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return {}
  const objet = args as Record<string, unknown>
  const resume: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(objet)) {
    if (cle === 'cle_idempotence' || cle === 'confirmation_utilisateur') {
      resume[cle] = valeur
    } else if (typeof valeur === 'string') {
      resume[cle] = valeur.slice(0, 80) + (valeur.length > 80 ? '…' : '')
    } else if (typeof valeur === 'boolean' || typeof valeur === 'number') {
      resume[cle] = valeur
    } else if (Array.isArray(valeur)) {
      resume[cle] = `[${valeur.length} élément(s)]`
    } else {
      resume[cle] = typeof valeur
    }
  }
  return resume
}

function listerOutils(): unknown {
  return {
    outils: OUTILS_MCP.map((outil) => ({
      nom: outil.nom,
      description: outil.description,
      annotations: { lectureSeule: outil.annotation === 'lecture seule' },
      inputSchema: outil.schema,
    })),
  }
}

async function executerOutil(
  nom: string,
  args: unknown,
  contexte: ContexteMcp,
): Promise<{ resultat: unknown, estErreur: boolean }> {
  const outil = trouverOutil(nom)
  if (!outil) {
    return { resultat: { message: `Outil inconnu : ${nom}` }, estErreur: true }
  }

  await verifierPlanPayant(contexte.userId)
  verifierPortées(outil.scopes, contexte.scopes)

  if (outil.annotation === 'écriture') {
    await limiterCréation(contexte.userId, contexte.assistantId)
  } else {
    await limiterRequête(contexte.userId, contexte.assistantId)
  }

  const cleIdempotence =
    outil.idempotence && typeof args === 'object' && args !== null
      ? (args as Record<string, unknown>).cle_idempotence as string | undefined
      : undefined

  // Validation Zod des arguments d'outil.
  outil.schema.parse(args)

  const argumentsResume = resumerArguments(nom, args)
  const handler = HANDLERS[nom as NomOutilMcp]

  try {
    if (!handler) {
      throw new Error(`Outil inconnu : ${nom}`)
    }
    const resultat = await handler(args, contexte, { cleIdempotence })
    await journaliserAppel({
      userId: contexte.userId,
      assistantId: contexte.assistantId,
      outil: nom,
      argumentsResume,
      resultat,
    })
    return { resultat, estErreur: false }
  } catch (error) {
    await journaliserAppel({
      userId: contexte.userId,
      assistantId: contexte.assistantId,
      outil: nom,
      argumentsResume,
      resultat: { erreur: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }
}

export async function gererRequeteMcp(event: H3Event): Promise<unknown> {
  verifierMcpActif(MCP_ACTIF)

  const authorization = event.headers.get('authorization') ?? undefined
  const { userId } = await authentifierMcp(authorization)
  const vitrineId = await resoudreVitrine(userId)

  const assistantId = event.headers.get('mcp-client-id') ?? `assistant:${userId}`

  const contexte: ContexteMcp = { userId, vitrineId, assistantId, scopes: TOUTES_PORTÉES }

  const corps = await readBody(event)
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof corps === 'string' ? corps : JSON.stringify(corps))
  } catch {
    return reponseErreur(null, JSONRPC_PARSE_ERROR)
  }

  const validation = schemaJsonRpc.safeParse(parsed)
  if (!validation.success) {
    return reponseErreur(
      parsed && typeof parsed === 'object' && 'id' in parsed
        ? ((parsed as { id?: unknown }).id as string | number | null)
        : null,
      JSONRPC_INVALID_REQUEST,
    )
  }

  const { id, method, params } = validation.data

  if (method === 'tools/list') {
    return reponseSucces(id, listerOutils())
  }

  if (method === 'tools/call') {
    const nomOutil = (params as { nom?: unknown })?.nom
    if (typeof nomOutil !== 'string') {
      return reponseErreur(id, JSONRPC_INVALID_PARAMS)
    }
    const args = (params as { arguments?: unknown })?.arguments ?? {}

    try {
      const { resultat, estErreur } = await executerOutil(nomOutil as NomOutilMcp, args, contexte)
      return reponseSucces(id, { contenu: [{ type: 'text', text: JSON.stringify(resultat) }], estErreur })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue lors de l’exécution de l’outil.'
      return reponseErreur(id, { code: -32603, message })
    }
  }

  return reponseErreur(id, JSONRPC_METHOD_NOT_FOUND)
}

export default async function mcpHandler(event: H3Event): Promise<unknown> {
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  return gererRequeteMcp(event)
}
