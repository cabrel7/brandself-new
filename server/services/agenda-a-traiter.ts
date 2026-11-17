import { and, eq } from 'drizzle-orm'
import { demandes, reservations, vitrines } from '../../shared/db/schema'
import { db } from '../utils/db'

export interface AgendaATraiterParType {
  reservationsEnAttente: number
  demandesNouvelles: number
}

/**
 * Éléments de l'agenda qui attendent la réponse du professionnel, par type : réservations `en_attente` + demandes
 * `nouvelle` de SA vitrine. Lecture pure (deux COUNT dans une seule requête SQL, bornés par la vitrine de
 * l'utilisateur) : aucun effet de bord, contrairement à `listOwnReservations`. Sans vitrine : 0 et 0 (la pastille ne
 * doit jamais faire échouer la page).
 */
export async function countAgendaATraiterParType(userId: string): Promise<AgendaATraiterParType> {
  const [ligne] = await db
    .select({
      reservations: db.$count(
        reservations,
        and(eq(reservations.vitrineId, vitrines.id), eq(reservations.statut, 'en_attente')),
      ),
      demandes: db.$count(
        demandes,
        and(eq(demandes.vitrineId, vitrines.id), eq(demandes.statut, 'nouvelle')),
      ),
    })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  return {
    reservationsEnAttente: ligne ? Number(ligne.reservations) : 0,
    demandesNouvelles: ligne ? Number(ligne.demandes) : 0,
  }
}

/** Total à traiter (pastille du studio) : la somme des deux types, une seule définition. */
export async function countAgendaATraiter(userId: string): Promise<number> {
  const { reservationsEnAttente, demandesNouvelles } = await countAgendaATraiterParType(userId)
  return reservationsEnAttente + demandesNouvelles
}
