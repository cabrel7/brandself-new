import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { DEMANDE_STATUTS } from '../../shared/agenda'
import type { DemandeStatut } from '../../shared/agenda'
import { demandes, services, vitrines } from '../../shared/db/schema'
import { NotFoundError, UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { requirePublicAgendaService } from './creneaux'
import type { ServiceLookup } from './creneaux'
import { insertTransactionalEmailEvents } from './email-outbox'
import { getServiceFlow, isServiceType } from './reservations-regles'
import { requireVitrineId } from './vitrine-acces'

export type DemandeRow = typeof demandes.$inferSelect

export interface DemandeContactInput {
  nom: string
  email: string
  telephone: string
  message?: string
}

export type DemandeServiceInput = DemandeContactInput & ServiceLookup

function isDemandeStatut(value: string): value is DemandeStatut {
  return (DEMANDE_STATUTS as readonly string[]).includes(value)
}

function canTransitionDemande(from: DemandeStatut, to: DemandeStatut): boolean {
  if (from === 'nouvelle') return to === 'en_cours' || to === 'traitee' || to === 'refusee'
  return from === 'en_cours' && (to === 'traitee' || to === 'refusee')
}

export async function createDemande(username: string, input: DemandeServiceInput): Promise<{ item: DemandeRow }> {
  const lookup: ServiceLookup = 'serviceSlug' in input
    ? { serviceSlug: input.serviceSlug }
    : { serviceId: input.serviceId }
  return db.transaction(async (tx) => {
    const context = await requirePublicAgendaService(tx, username, lookup)
    if (!isServiceType(context.service.type) || getServiceFlow(context.service.type) !== 'demande') {
      throw new UnprocessableError('DEMANDE_NON_AUTORISEE')
    }

    const [item] = await tx
      .insert(demandes)
      .values({
        id: randomUUID(),
        vitrineId: context.vitrine.id,
        serviceId: context.service.id,
        nom: input.nom,
        email: input.email,
        telephone: input.telephone,
        message: input.message,
        statut: 'nouvelle',
      })
      .returning()
    if (!item) throw new Error('Insertion de la demande sans résultat.')
    await insertTransactionalEmailEvents(tx, 'demande', item.id, [
      'demande_professionnel_nouvelle',
      'demande_visiteur_recue',
    ])
    return { item }
  })
}

export async function listOwnDemandes(userId: string): Promise<{
  items: Array<{ demande: DemandeRow, service: typeof services.$inferSelect }>
}> {
  const vitrineId = await requireVitrineId(userId)
  const items = await db
    .select({ demande: demandes, service: services })
    .from(demandes)
    .innerJoin(services, eq(services.id, demandes.serviceId))
    .where(eq(demandes.vitrineId, vitrineId))
    .orderBy(asc(demandes.createdAt), asc(demandes.id))
  return { items }
}

export async function updateDemande(
  userId: string,
  id: string,
  input: { statut: DemandeStatut },
): Promise<{ item: DemandeRow }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ demande: demandes })
      .from(demandes)
      .innerJoin(vitrines, eq(vitrines.id, demandes.vitrineId))
      .where(and(eq(demandes.id, id), eq(vitrines.userId, userId)))
      .for('update')
    if (!current) throw new NotFoundError('DEMANDE_INTROUVABLE')
    if (!isDemandeStatut(current.demande.statut) || !canTransitionDemande(current.demande.statut, input.statut)) {
      throw new UnprocessableError('TRANSITION_DEMANDE_INVALIDE')
    }
    const [item] = await tx
      .update(demandes)
      .set({ statut: input.statut, updatedAt: new Date() })
      .where(eq(demandes.id, id))
      .returning()
    if (!item) throw new NotFoundError('DEMANDE_INTROUVABLE')
    return { item }
  })
}
