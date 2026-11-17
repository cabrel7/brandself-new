// S16 : seul POST est exposé (pas de flux serveur SSE ni de session à fermer : transport sans état).
import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'

export default defineEventHandler((event) => {
  setResponseStatus(event, 405)
  setResponseHeader(event, 'Allow', 'POST')
  return { jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée. Utilisez POST.' }, id: null }
})
