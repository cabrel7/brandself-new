import type { ReservationStatut } from '../../shared/agenda'
import type { ServiceType } from '../../shared/services'
import { SERVICE_TYPES } from '../../shared/services'

export type ServiceFlow = 'reservation' | 'demande'

export interface TransitionReservationContext {
  automatique: boolean
  fin: Date
  maintenant: Date
}

export function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(value)
}

export function getServiceFlow(type: ServiceType): ServiceFlow {
  return type === 'rdv' || type === 'accompagnement' ? 'reservation' : 'demande'
}

// S7-bis : `refusee` est un statut terminal, atteint uniquement depuis `en_attente`.
// Il ne remplace jamais `annulee` (emails distincts) et ne redémarre rien.
export function canTransitionReservation(
  from: ReservationStatut,
  to: ReservationStatut,
  context?: TransitionReservationContext,
): boolean {
  if (from === 'en_attente') return to === 'confirmee' || to === 'annulee' || to === 'refusee'
  if (from !== 'confirmee') return false
  if (to === 'annulee') return true
  return to === 'terminee'
    && context?.automatique === true
    && context.maintenant.getTime() >= context.fin.getTime()
}
