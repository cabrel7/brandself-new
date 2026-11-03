import { RELATIONNEL_MAX_PAR_SEMAINE } from '../../../shared/notifications'
import type { EmailCategorie, EmailStatut } from '../../../shared/notifications'

// S9 (docs/specs/S9-notifications.md #88) : au plus N e-mails `relationnel` par semaine ISO locale
// et par destinataire. Règle PURE : la lecture des lignes et le verrou consultatif par utilisateur
// sont dans la planification ; ici on décide à partir des lignes déjà lues.

export interface LigneOutboxPlafond {
  categorie: EmailCategorie
  statut: EmailStatut
  createdAt: Date
}

/**
 * Vrai si le plafond est atteint : nombre de lignes `relationnel`, non annulées (un e-mail qui n'est
 * jamais parti libère le quota), créées depuis `debutSemaine` inclus, supérieur ou égal à `max`.
 */
export function plafondRelationnelAtteint(
  lignes: readonly LigneOutboxPlafond[],
  debutSemaine: Date,
  max: number = RELATIONNEL_MAX_PAR_SEMAINE,
): boolean {
  const debut = debutSemaine.getTime()
  const comptees = lignes.filter((ligne) =>
    ligne.categorie === 'relationnel'
    && ligne.statut !== 'annule'
    && ligne.createdAt.getTime() >= debut,
  )
  return comptees.length >= max
}
