// S16 : limiteur de débit du serveur MCP.
// Par compte et par jeton : 60 requêtes par minute, 20 créations par heure.
// En cas de panne Redis, on laisse passer (fail-open) et on journalise.

import { hitLimit } from '../services/limiteur'
import { TooManyRequestsError } from '../exceptions/http'

const FENÊTRE_REQUETE_S = 60
const LIMITE_REQUETE = 60
const FENÊTRE_CREATION_S = 60 * 60
const LIMITE_CREATION = 20

/** Clé de limiteur pour les requêtes générales (tous outils confondus). */
function cleRequête(userId: string, assistantId: string): string {
  return `mcp:requête:${userId}:${assistantId}`
}

/** Clé de limiteur pour les créations (outils d'écriture). */
function cleCreation(userId: string, assistantId: string): string {
  return `mcp:création:${userId}:${assistantId}`
}

/** Vérifie la limite de requêtes par minute. Lève TooManyRequestsError si dépassée. */
export async function limiterRequête(userId: string, assistantId: string): Promise<void> {
  const status = await hitLimit(cleRequête(userId, assistantId), LIMITE_REQUETE, FENÊTRE_REQUETE_S)
  if (!status.allowed) {
    throw new TooManyRequestsError(status.retryAfter)
  }
}

/** Vérifie la limite de créations par heure. Lève TooManyRequestsError si dépassée. */
export async function limiterCréation(userId: string, assistantId: string): Promise<void> {
  const status = await hitLimit(cleCreation(userId, assistantId), LIMITE_CREATION, FENÊTRE_CREATION_S)
  if (!status.allowed) {
    throw new TooManyRequestsError(status.retryAfter)
  }
}
