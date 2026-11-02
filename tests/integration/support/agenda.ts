import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/utils/db'
import { createUser, insertService, insertVitrineRow } from './fabriques'

export const REFERENCE_AGENDA = new Date('2026-11-02T06:00:00.000Z')
export const DEBUT_CRENEAU = new Date('2026-11-02T09:00:00.000Z')
export const FIN_CRENEAU = new Date('2026-11-02T09:30:00.000Z')

export interface ContexteAgendaOptions {
  username?: string
  typeService?: 'rdv' | 'accompagnement' | 'atelier' | 'devis'
  slugService?: string
  dureeMin?: number | null
  fuseau?: string
  pasCreneauMin?: number
  preavisHeures?: number
  horizonJours?: number
}

export interface ContexteAgenda {
  user: Awaited<ReturnType<typeof createUser>>
  vitrine: { id: string, username: string }
  service: Awaited<ReturnType<typeof insertService>>
}

export interface DisponibiliteDb {
  id: string
  vitrineId: string
  jourSemaine: number
  debut: string
  fin: string
}

export interface IndisponibiliteDb {
  id: string
  vitrineId: string
  date: string
  raison: string | null
}

export interface ReservationDb {
  id: string
  vitrineId: string
  serviceId: string
  nom: string
  email: string
  telephone: string
  note: string | null
  debut: Date
  fin: Date
  statut: string
  paiementChoisi: string
  paiementStatut: string
  confirmationTokenHash: string
  confirmationExpireLe: Date
}

type ReservationSqlRow = Omit<ReservationDb, 'debut' | 'fin' | 'confirmationExpireLe'> & {
  debut: Date | string
  fin: Date | string
  confirmationExpireLe: Date | string
}

function normaliserReservation(row: ReservationSqlRow): ReservationDb {
  return {
    ...row,
    debut: row.debut instanceof Date ? row.debut : new Date(row.debut),
    fin: row.fin instanceof Date ? row.fin : new Date(row.fin),
    confirmationExpireLe: row.confirmationExpireLe instanceof Date
      ? row.confirmationExpireLe
      : new Date(row.confirmationExpireLe),
  }
}

export interface DemandeDb {
  id: string
  vitrineId: string
  serviceId: string
  nom: string
  email: string
  telephone: string
  message: string | null
  statut: string
}

export interface ReservationDirecteOptions {
  id?: string
  nom?: string
  email?: string
  telephone?: string
  note?: string | null
  debut?: Date
  fin?: Date
  statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee'
  paiementChoisi?: 'sur_place' | 'en_ligne'
  paiementStatut?: 'non_requis' | 'en_attente' | 'paye'
  confirmationExpireLe?: Date
}

export async function creerContexteAgenda(options: ContexteAgendaOptions = {}): Promise<ContexteAgenda> {
  const user = await createUser()
  const username = options.username ?? `agenda-${randomUUID().slice(0, 8)}`
  const vitrineRow = await insertVitrineRow(user.id, { username, publiee: true })
  await db.execute(sql`
    UPDATE vitrines
    SET fuseau = ${options.fuseau ?? 'Africa/Douala'},
        pas_creneau_min = ${options.pasCreneauMin ?? 30},
        preavis_heures = ${options.preavisHeures ?? 2},
        horizon_jours = ${options.horizonJours ?? 60}
    WHERE id = ${vitrineRow.id}
  `)

  const type = options.typeService ?? 'rdv'
  const service = await insertService(vitrineRow.id, {
    slug: options.slugService ?? `service-${randomUUID().slice(0, 8)}`,
    type,
    dureeMin: options.dureeMin === undefined ? (type === 'devis' ? null : 30) : options.dureeMin,
    tarif: type === 'devis' ? 'devis' : 'gratuit',
    nbSeances: type === 'accompagnement' ? 6 : null,
    reservable: true,
    actif: true,
  })

  return { user, vitrine: { id: vitrineRow.id, username: vitrineRow.username }, service }
}

export async function insererDisponibilite(
  vitrineId: string,
  valeurs: { jourSemaine?: number, debut?: string, fin?: string } = {},
): Promise<DisponibiliteDb> {
  const id = randomUUID()
  const resultat = await db.execute<DisponibiliteDb>(sql`
    INSERT INTO disponibilites (id, vitrine_id, jour_semaine, debut, fin)
    VALUES (
      ${id},
      ${vitrineId},
      ${valeurs.jourSemaine ?? 1},
      ${valeurs.debut ?? '09:00'}::time,
      ${valeurs.fin ?? '12:00'}::time
    )
    RETURNING id, vitrine_id AS "vitrineId", jour_semaine AS "jourSemaine",
      debut::text, fin::text
  `)
  const ligne = resultat.rows[0]
  if (!ligne) throw new Error('Insertion de disponibilité sans résultat.')
  return ligne
}

export async function lireDisponibilites(vitrineId: string): Promise<DisponibiliteDb[]> {
  const resultat = await db.execute<DisponibiliteDb>(sql`
    SELECT id, vitrine_id AS "vitrineId", jour_semaine AS "jourSemaine",
      debut::text, fin::text
    FROM disponibilites
    WHERE vitrine_id = ${vitrineId}
    ORDER BY jour_semaine, debut, fin, id
  `)
  return resultat.rows
}

export async function lireIndisponibilites(vitrineId: string): Promise<IndisponibiliteDb[]> {
  const resultat = await db.execute<IndisponibiliteDb>(sql`
    SELECT id, vitrine_id AS "vitrineId", date::text, raison
    FROM indisponibilites
    WHERE vitrine_id = ${vitrineId}
    ORDER BY date, id
  `)
  return resultat.rows
}

export async function insererReservation(
  vitrineId: string,
  serviceId: string,
  options: ReservationDirecteOptions = {},
): Promise<ReservationDb> {
  const id = options.id ?? randomUUID()
  const tokenHash = createHash('sha256').update(`confirmation-${id}`).digest('hex')
  const resultat = await db.execute<ReservationSqlRow>(sql`
    INSERT INTO reservations (
      id, vitrine_id, service_id, nom, email, telephone, note, debut, fin, statut,
      paiement_choisi, paiement_statut, confirmation_token_hash, confirmation_expire_le
    ) VALUES (
      ${id},
      ${vitrineId},
      ${serviceId},
      ${options.nom ?? 'Visiteur Test'},
      ${options.email ?? 'visiteur@exemple.test'},
      ${options.telephone ?? '+237699000001'},
      ${options.note ?? null},
      ${options.debut ?? DEBUT_CRENEAU},
      ${options.fin ?? FIN_CRENEAU},
      ${options.statut ?? 'en_attente'},
      ${options.paiementChoisi ?? 'sur_place'},
      ${options.paiementStatut ?? 'non_requis'},
      ${tokenHash},
      ${options.confirmationExpireLe ?? new Date(REFERENCE_AGENDA.getTime() + 86_400_000)}
    )
    RETURNING id, vitrine_id AS "vitrineId", service_id AS "serviceId", nom, email,
      telephone, note, debut, fin, statut, paiement_choisi AS "paiementChoisi",
      paiement_statut AS "paiementStatut", confirmation_token_hash AS "confirmationTokenHash",
      confirmation_expire_le AS "confirmationExpireLe"
  `)
  const ligne = resultat.rows[0]
  if (!ligne) throw new Error('Insertion de réservation sans résultat.')
  return normaliserReservation(ligne)
}

export async function lireReservations(vitrineId: string): Promise<ReservationDb[]> {
  const resultat = await db.execute<ReservationSqlRow>(sql`
    SELECT id, vitrine_id AS "vitrineId", service_id AS "serviceId", nom, email,
      telephone, note, debut, fin, statut, paiement_choisi AS "paiementChoisi",
      paiement_statut AS "paiementStatut", confirmation_token_hash AS "confirmationTokenHash",
      confirmation_expire_le AS "confirmationExpireLe"
    FROM reservations
    WHERE vitrine_id = ${vitrineId}
    ORDER BY debut, id
  `)
  return resultat.rows.map(normaliserReservation)
}

export async function lireReservation(id: string): Promise<ReservationDb | undefined> {
  const resultat = await db.execute<ReservationSqlRow>(sql`
    SELECT id, vitrine_id AS "vitrineId", service_id AS "serviceId", nom, email,
      telephone, note, debut, fin, statut, paiement_choisi AS "paiementChoisi",
      paiement_statut AS "paiementStatut", confirmation_token_hash AS "confirmationTokenHash",
      confirmation_expire_le AS "confirmationExpireLe"
    FROM reservations
    WHERE id = ${id}
  `)
  const ligne = resultat.rows[0]
  return ligne === undefined ? undefined : normaliserReservation(ligne)
}

export async function expirerConfirmation(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE reservations
    SET confirmation_expire_le = ${new Date(REFERENCE_AGENDA.getTime() - 1)}
    WHERE id = ${id}
  `)
}

export async function lireDemandes(vitrineId: string): Promise<DemandeDb[]> {
  const resultat = await db.execute<DemandeDb>(sql`
    SELECT id, vitrine_id AS "vitrineId", service_id AS "serviceId", nom, email,
      telephone, message, statut
    FROM demandes
    WHERE vitrine_id = ${vitrineId}
    ORDER BY created_at, id
  `)
  return resultat.rows
}

export function iso(date: Date): string {
  return date.toISOString()
}
