import { defineEventHandler } from 'h3'
import { CHEMIN_SERVEUR_AUTORISATION, servirDecouverte } from '../../../../mcp/decouverte'

// RFC 8414 §3 : pour l'émetteur https://hôte/api/auth, le client insère le chemin après /.well-known/…
export default defineEventHandler((event) => servirDecouverte(event, CHEMIN_SERVEUR_AUTORISATION))
