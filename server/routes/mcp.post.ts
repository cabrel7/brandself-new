// S16 : route /mcp (transport Streamable HTTP sans état, réponses JSON). Seule la méthode POST est exposée
// (mcp.get.ts et mcp.delete.ts répondent 405). Livré désactivé : MCP_ACTIF=false répond 403 MCP_INACTIF.
// Authentification : jeton d'accès OAuth 2.1 (découverte sous /.well-known/, voir server/routes/.well-known/).
// Essai en dev, sans IA : scripts/essai-mcp.ts (client MCP du SDK) ou MCP Inspector.
import { defineApiHandler } from '../utils/api'
import { gererRequeteMcp } from '../mcp/http'

export default defineApiHandler(gererRequeteMcp)
