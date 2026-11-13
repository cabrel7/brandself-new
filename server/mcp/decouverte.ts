// S16 : découverte OAuth à la racine du site. Better Auth est monté sous /api/auth : les métadonnées
// RFC 9728 (ressource protégée) et RFC 8414 (serveur d'autorisation) n'existent donc pas à la racine, là où
// les assistants les cherchent. Les routes de server/routes/.well-known/ les republient en transmettant la
// requête au gestionnaire de Better Auth, dont les plugins jwt()/mcp() produisent le document
// (aucune métadonnée écrite à la main). Invisible tant que MCP_ACTIF est faux.

import { createError } from 'h3'
import type { H3Event } from 'h3'
import { env } from '../../shared/env'
import { entetesDe, urlDe } from './requete'

export const CHEMIN_SERVEUR_AUTORISATION = '/.well-known/oauth-authorization-server/api/auth'
export const CHEMIN_RESSOURCE_PROTEGEE = '/.well-known/oauth-protected-resource'
export const CHEMIN_RESSOURCE_PROTEGEE_MCP = '/.well-known/oauth-protected-resource/mcp'

export async function servirDecouverte(event: H3Event, chemin: string): Promise<Response> {
  if (!env.MCP_ACTIF) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const requete = new Request(new URL(chemin, urlDe(event)), { method: event.method, headers: entetesDe(event) })
  return serverAuth(event).handler(requete)
}
