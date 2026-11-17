// S16 : couche HTTP du serveur MCP (POST /mcp). Chemin d'une requête :
//   MCP_ACTIF -> jeton d'accès OAuth (requireMcpAuth : 401 + WWW-Authenticate sinon) -> consentement toujours
//   valable -> corps borné -> serveur MCP du SDK (Streamable HTTP sans état, réponse JSON) -> outils -> services.
// Aucune logique métier ici.

import { requireMcpAuth } from '@better-auth/mcp'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { MCP_CORPS_MAX_OCTETS, MCP_PORTEES } from '../../shared/mcp'
import { REGLAGE_CLES } from '../../shared/reglages'
import { ContentTooLargeError } from '../exceptions/http'
import { adresseServeurMcp } from '../services/assistants'
import { Reglages } from '../services/reglages'
import { lireCorpsBorne } from '../services/webhooks-paiement'
import { compteSuspendu, lireIdentiteJeton, résoudrePortées, verifierMcpActif } from './auth'
import { entetesDe, urlDe } from './requete'
import { creerServeurMcp } from './server'

const CHEMIN_METADONNEES_RESSOURCE = '/.well-known/oauth-protected-resource'
const CODE_JSONRPC_NON_AUTORISE = -32001
const CODE_JSONRPC_INTERDIT = -32003
const STATUT_HTTP_INTERDIT = 403

function jsonRpcErreur(statut: number, code: number, message: string, entetes: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status: statut,
    headers: { 'Content-Type': 'application/json', ...entetes },
  })
}

/** 401 RFC 6750 / RFC 9728 : le client relance l'autorisation (consentement révoqué ou jeton sans identité). */
function reponseJetonRefuse(): Response {
  const ressource = new URL(adresseServeurMcp())
  const metadonnees = `${ressource.origin}${CHEMIN_METADONNEES_RESSOURCE}${ressource.pathname.replace(/\/$/, '')}`
  return jsonRpcErreur(
    401,
    CODE_JSONRPC_NON_AUTORISE,
    'Autorisation révoquée ou invalide. Reconnectez l’assistant.',
    { 'WWW-Authenticate': `Bearer error="invalid_token", error_description="authorization revoked or invalid", resource_metadata="${metadonnees}"` },
  )
}

/**
 * Corps lu en flux, coupé dès que la limite est dépassée : un corps « chunked » (sans content-length) n'est
 * jamais accumulé en mémoire au-delà de MCP_CORPS_MAX_OCTETS (413 CORPS_TROP_GROS). Même lecteur borné que les
 * webhooks (délai de lecture compris), pas de seconde implémentation.
 */
async function lireCorps(event: H3Event): Promise<string> {
  const annonce = Number.parseInt(event.node.req.headers['content-length'] ?? '', 10)
  if (Number.isFinite(annonce) && annonce > MCP_CORPS_MAX_OCTETS) throw new ContentTooLargeError('CORPS_TROP_GROS')
  return (await lireCorpsBorne(event.node.req, MCP_CORPS_MAX_OCTETS)).toString('utf8')
}

export async function gererRequeteMcp(event: H3Event): Promise<Response> {
  verifierMcpActif(await Reglages.lire(REGLAGE_CLES.mcpActif))
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const url = urlDe(event)
  // Requête sans corps pour l'authentification : un appelant sans jeton ne nous fait jamais lire de corps.
  const requeteAuth = new Request(url, { method: 'POST', headers: entetesDe(event) })

  const proteger = requireMcpAuth(
    serverAuth(event),
    async (_requete, claims) => {
      const identite = lireIdentiteJeton(claims)
      if (!identite) return reponseJetonRefuse()
      const portées = await résoudrePortées(identite)
      if (portées === null) return reponseJetonRefuse()
      // A2 (CA03) : compte suspendu = 403 avant toute lecture du corps, jeton encore valable ou non. Message neutre.
      if (await compteSuspendu(identite.userId)) {
        return jsonRpcErreur(STATUT_HTTP_INTERDIT, CODE_JSONRPC_INTERDIT, 'Accès refusé.')
      }

      const corps = await lireCorps(event)
      const requete = new Request(url, { method: 'POST', headers: entetesDe(event), body: corps })

      const serveur = creerServeurMcp({ userId: identite.userId, assistantId: identite.clientId, scopes: portées })
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      await serveur.connect(transport)
      try {
        return await transport.handleRequest(requete)
      } finally {
        await transport.close()
        await serveur.close()
      }
    },
    { resource: adresseServeurMcp(), challengeScopes: [...MCP_PORTEES] },
  )
  return proteger(requeteAuth)
}
