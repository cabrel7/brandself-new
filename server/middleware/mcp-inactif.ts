import { createError, defineEventHandler } from 'h3'
import { env } from '../../shared/env'
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

export default defineEventHandler((event) => {
  if (env.MCP_ACTIF) return
  if (estCheminOauth(event.path)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
