import { and, asc, count, desc, eq, gt, lte, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { DemandeStatut, ReservationPeriode, ReservationStatut } from '../../shared/agenda'
import { demandes, reservations, services, vitrines } from '../../shared/db/schema'
import { db } from '../utils/db'

// Lectures de l'agenda destinées à l'assistant (serveur MCP) : AUCUN effet de bord. Contrairement à
// `listOwnReservations` (qui passe en `terminee` les réservations confirmées échues), rien n'est écrit ici ; le statut
// `terminee` est dérivé à la lecture (confirmée dont la fin est passée), ce que le studio affiche après son passage.

export interface ProchainRendezVous {
  debut: Date
  fin: Date
  /** Titre du service (texte du professionnel). Aucune donnée du client. */
  service: string
}

/**
 * Prochain rendez-vous confirmé de la vitrine de l'utilisateur : le premier, par début, dont la fin est postérieure à
 * `maintenant` (un rendez-vous en cours compte). Un seul SELECT borné (LIMIT 1) ; ni nom, ni email, ni téléphone.
 */
export async function getProchainRendezVous(userId: string, maintenant: Date = new Date()): Promise<ProchainRendezVous | null> {
  const [ligne] = await db
    .select({ debut: reservations.debut, fin: reservations.fin, service: services.titre })
    .from(reservations)
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .where(and(
      eq(vitrines.userId, userId),
      eq(reservations.statut, 'confirmee'),
      gt(reservations.fin, maintenant),
    ))
    .orderBy(asc(reservations.debut), asc(reservations.id))
    .limit(1)
  return ligne ?? null
}

export interface ReservationPourAssistant {
  id: string
  debut: Date
  fin: Date
  service: string
  /** Statut effectif : une réservation confirmée dont la fin est passée est `terminee`. */
  statut: ReservationStatut
  paiementChoisi: string
  // Texte saisi par le visiteur : l'appelant ne le transmet que si le détail est autorisé.
  nom: string
  email: string
  telephone: string
  note: string | null
}

export interface ReservationsPourAssistantFiltres {
  periode: ReservationPeriode
  statut?: ReservationStatut
  limite: number
  maintenant: Date
}

/**
 * Réservations de SA vitrine, filtrées et plafonnées en SQL. `a_venir` : fin après `maintenant`, la plus proche
 * d'abord ; `passees` : fin avant ou à `maintenant`, la plus récente d'abord ; `toutes` : la plus récente d'abord.
 * `total` est le nombre de réservations correspondant aux filtres (avant le plafond).
 */
export async function listReservationsPourAssistant(
  userId: string,
  filtres: ReservationsPourAssistantFiltres,
): Promise<{ items: ReservationPourAssistant[], total: number }> {
  const { periode, statut, limite, maintenant } = filtres
  const statutEffectif = sql<ReservationStatut>`CASE WHEN ${reservations.statut} = 'confirmee' AND ${reservations.fin} <= ${maintenant} THEN 'terminee' ELSE ${reservations.statut} END`
  const conditions: SQL[] = [eq(vitrines.userId, userId)]
  if (periode === 'a_venir') conditions.push(gt(reservations.fin, maintenant))
  if (periode === 'passees') conditions.push(lte(reservations.fin, maintenant))
  if (statut !== undefined) conditions.push(sql`${statutEffectif} = ${statut}`)
  const where = and(...conditions)

  const [compte] = await db
    .select({ total: count() })
    .from(reservations)
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .where(where)
  const items = await db
    .select({
      id: reservations.id,
      debut: reservations.debut,
      fin: reservations.fin,
      service: services.titre,
      statut: statutEffectif,
      paiementChoisi: reservations.paiementChoisi,
      nom: reservations.nom,
      email: reservations.email,
      telephone: reservations.telephone,
      note: reservations.note,
    })
    .from(reservations)
    .innerJoin(vitrines, eq(vitrines.id, reservations.vitrineId))
    .innerJoin(services, eq(services.id, reservations.serviceId))
    .where(where)
    .orderBy(
      ...(periode === 'a_venir'
        ? [asc(reservations.debut), asc(reservations.id)]
        : [desc(reservations.debut), asc(reservations.id)]),
    )
    .limit(limite)
  return { items, total: Number(compte?.total ?? 0) }
}

export interface DemandePourAssistant {
  id: string
  createdAt: Date
  service: string
  statut: string
  // Texte saisi par le visiteur : l'appelant ne le transmet que si le détail est autorisé.
  nom: string
  email: string
  telephone: string
  message: string | null
}

/**
 * Demandes (ateliers, devis) de SA vitrine, filtrées et plafonnées en SQL, les plus récentes d'abord. `total` est le
 * nombre de demandes correspondant au filtre (avant le plafond). Lecture pure : aucun effet de bord.
 */
export async function listDemandesPourAssistant(
  userId: string,
  filtres: { statut?: DemandeStatut, limite: number },
): Promise<{ items: DemandePourAssistant[], total: number }> {
  const conditions: SQL[] = [eq(vitrines.userId, userId)]
  if (filtres.statut !== undefined) conditions.push(eq(demandes.statut, filtres.statut))
  const where = and(...conditions)

  const [compte] = await db
    .select({ total: count() })
    .from(demandes)
    .innerJoin(vitrines, eq(vitrines.id, demandes.vitrineId))
    .where(where)
  const items = await db
    .select({
      id: demandes.id,
      createdAt: demandes.createdAt,
      service: services.titre,
      statut: demandes.statut,
      nom: demandes.nom,
      email: demandes.email,
      telephone: demandes.telephone,
      message: demandes.message,
    })
    .from(demandes)
    .innerJoin(vitrines, eq(vitrines.id, demandes.vitrineId))
    .innerJoin(services, eq(services.id, demandes.serviceId))
    .where(where)
    .orderBy(desc(demandes.createdAt), asc(demandes.id))
    .limit(filtres.limite)
  return { items, total: Number(compte?.total ?? 0) }
}
