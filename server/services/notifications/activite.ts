import { and, eq, gte, lt } from 'drizzle-orm'
import { demandes, messages, reservations } from '../../../shared/db/schema'
import { SUGGESTION_RESUME_DEFAUT } from '../../../shared/notifications'
import { PROCHAINES_ETAPES } from '../../../shared/prochaine-etape'
import { db } from '../../utils/db'
import type { SuggestionResume } from '../emails/notifications-contenus'
import { getNextStepForUser } from '../vitrines'

// S9 (docs/specs/S9-notifications.md #87, §5.3, §5.4) : données du résumé hebdomadaire. Compteurs EXACTS et
// vérifiables seulement (réservations, demandes, messages reçus, rendez-vous de la semaine qui commence) :
// ni visites ni clics avant S11. Aucun contenu saisi par un visiteur n'est lu ici (minimisation, #100).

export type Database = typeof db

/** Intervalle semi-ouvert `[debut, fin)` en instants UTC (bornes calculées en calendrier local par `fenetres.ts`). */
export interface IntervalleActivite {
  debut: Date
  fin: Date
}

export interface CompteursActivite {
  reservations: number
  demandes: number
  messages: number
  /** Rendez-vous CONFIRMÉS dont le début tombe dans la semaine qui commence. */
  rendezVousSemaine: number
}

/**
 * Compte l'activité d'une vitrine. `periode` = les 7 jours locaux écoulés (création des réservations, demandes
 * et messages) ; `semaineSuivante` = la semaine qui commence (début des rendez-vous confirmés).
 */
export async function compterActivite(
  vitrineId: string,
  periode: IntervalleActivite,
  semaineSuivante: IntervalleActivite,
  database: Database = db,
): Promise<CompteursActivite> {
  const [nbReservations, nbDemandes, nbMessages, nbRendezVous] = await Promise.all([
    database.$count(reservations, and(
      eq(reservations.vitrineId, vitrineId),
      gte(reservations.createdAt, periode.debut),
      lt(reservations.createdAt, periode.fin),
    )),
    database.$count(demandes, and(
      eq(demandes.vitrineId, vitrineId),
      gte(demandes.createdAt, periode.debut),
      lt(demandes.createdAt, periode.fin),
    )),
    database.$count(messages, and(
      eq(messages.vitrineId, vitrineId),
      gte(messages.createdAt, periode.debut),
      lt(messages.createdAt, periode.fin),
    )),
    database.$count(reservations, and(
      eq(reservations.vitrineId, vitrineId),
      eq(reservations.statut, 'confirmee'),
      gte(reservations.debut, semaineSuivante.debut),
      lt(reservations.debut, semaineSuivante.fin),
    )),
  ])
  return {
    reservations: nbReservations,
    demandes: nbDemandes,
    messages: nbMessages,
    rendezVousSemaine: nbRendezVous,
  }
}

/**
 * Une seule suggestion pour un résumé sans activité : la prochaine étape de la vitrine (les étapes ignorées
 * sont déjà sautées par `getNextStepForUser`), sinon la suggestion par défaut. Tout échec de lecture donne le
 * repli déterministe : un résumé n'est jamais bloqué par sa suggestion.
 */
export async function choisirSuggestion(userId: string): Promise<SuggestionResume> {
  try {
    const etape = await getNextStepForUser(userId)
    if (etape !== null) {
      const { titre, texte, chemin } = PROCHAINES_ETAPES[etape]
      return { titre, texte, chemin }
    }
  } catch {
    // Repli ci-dessous : aucune donnée personnelle n'est journalisée.
  }
  return { ...SUGGESTION_RESUME_DEFAUT }
}
