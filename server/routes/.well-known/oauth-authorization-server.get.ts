import { defineEventHandler } from 'h3'
import { CHEMIN_SERVEUR_AUTORISATION, servirDecouverte } from '../../mcp/decouverte'

// RFC 8414 à la racine (le document est celui de l'émetteur /api/auth).
export default defineEventHandler((event) => servirDecouverte(event, CHEMIN_SERVEUR_AUTORISATION))
