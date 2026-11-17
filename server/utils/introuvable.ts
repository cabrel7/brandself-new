import { createError } from 'h3'
import type { H3Error } from 'h3'

/**
 * A1 : réponse UNIQUE de l'administration à toute anomalie (hôte, session, rôle, suspension, durée, origine).
 * Un 404 au corps identique ne révèle ni l'existence de la route ni la cause du refus. La stack est vidée
 * (Nitro la sérialise en développement) ; aucun détail n'est ajouté.
 */
export function introuvableAdmin(): H3Error {
  const erreur = createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Not Found' })
  erreur.stack = ''
  return erreur
}
