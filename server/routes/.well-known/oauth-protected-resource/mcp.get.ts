import { defineEventHandler } from 'h3'
import { CHEMIN_RESSOURCE_PROTEGEE_MCP, servirDecouverte } from '../../../mcp/decouverte'

// RFC 9728 §3.1 : la ressource est https://hôte/mcp, le chemin /mcp est inséré après /.well-known/…
export default defineEventHandler((event) => servirDecouverte(event, CHEMIN_RESSOURCE_PROTEGEE_MCP))
