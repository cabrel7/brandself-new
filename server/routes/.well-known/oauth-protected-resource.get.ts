import { defineEventHandler } from 'h3'
import { CHEMIN_RESSOURCE_PROTEGEE, servirDecouverte } from '../../mcp/decouverte'

// RFC 9728 : métadonnées de la ressource protégée (serveur MCP).
export default defineEventHandler((event) => servirDecouverte(event, CHEMIN_RESSOURCE_PROTEGEE))
