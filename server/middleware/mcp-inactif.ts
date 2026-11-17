import { createError, defineEventHandler } from 'h3'
import { REGLAGE_CLES } from '../../shared/reglages'
import { Reglages } from '../services/reglages'
import { estSousChemin, normaliserChemin } from '../mcp/chemin'

// S16 : serveur MCP livré désactivé (MCP_ACTIF=false). Les routes OAuth du plugin `mcp()` sont montées sous
// /api/auth/ par Better Auth ; sans cette garde, l'enregistrement dynamique de clients resterait ouvert à
// n'importe qui. Désactivé = ces routes répondent 404, comme si le serveur d'autorisation n'existait pas.
// `/api/auth/token` (plugin jwt : jeton JWT d'une session) n'est utilisé par aucun flux de l'application
// (connexion, OTP, Google : vérifié, aucune référence dans app/ ni server/) ; il n'a de sens que pour le MCP.
// Le chemin est normalisé avant comparaison (`//`, `%2e`, `%6f`, casse, `./`, query).
export const PREFIXES_OAUTH = ['/api/auth/oauth2', '/api/auth/jwks', '/api/auth/.well-known', '/api/auth/token']

export function estCheminOauth(cheminBrut: string): boolean {
  const chemin = normaliserChemin(cheminBrut)
  return PREFIXES_OAUTH.some((prefixe) => estSousChemin(chemin, prefixe))
}

export default defineEventHandler(async (event) => {
  // A4 : coupure globale pilotée à chaud ; repli FERMÉ si la table est illisible (D-A4-06). Lecture seulement pour un chemin OAuth.
  if (!estCheminOauth(event.path)) return
  if (await Reglages.lire(REGLAGE_CLES.mcpActif)) return
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
})
