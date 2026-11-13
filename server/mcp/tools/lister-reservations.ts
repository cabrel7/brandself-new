// S16 : handler de l'outil lister_reservations (lecture seule, confidentialité par défaut).
// Par défaut : date, heure locale, service, statut, prénom + initiale, mode de règlement. Email, téléphone et note du
// visiteur seulement si le détail est autorisé, et alors confinés dans `contenu_visiteur` (données non fiables).
// Lecture SANS effet de bord (listReservationsPourAssistant) : aucune réservation n'est modifiée.

import { listReservationsPourAssistant } from '../../services/agenda-resume'
import { avecDetailVisiteur, prenomInitiale } from '../confidentialite'
import type { ContenuVisiteur } from '../confidentialite'
import { isoDansFuseau, lireArguments } from '../format'
import { schemaListerReservations } from '../tools'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

export type ReservationResume = {
  id: string
  debut: string
  fin: string
  service: string
  statut: string
  client: string
  paiementMode: string
} & Partial<ContenuVisiteur>

export interface ReservationsVue {
  fuseau: string
  items: ReservationResume[]
  total: number
  tronque: boolean
}

export async function executer(
  args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<ReservationsVue> {
  const { periode, statut, limite } = lireArguments(schemaListerReservations, args)
  const detail = options.detailAutorise === true
  const { items, total } = await listReservationsPourAssistant(contexte.userId, {
    periode,
    statut,
    limite,
    maintenant: options.maintenant ?? new Date(),
  })

  return {
    fuseau: contexte.fuseau,
    items: items.map((ligne) => ({
      id: ligne.id,
      debut: isoDansFuseau(ligne.debut, contexte.fuseau),
      fin: isoDansFuseau(ligne.fin, contexte.fuseau),
      service: ligne.service,
      statut: ligne.statut,
      client: prenomInitiale(ligne.nom),
      paiementMode: ligne.paiementChoisi,
      ...avecDetailVisiteur(detail, { email: ligne.email, telephone: ligne.telephone, note: ligne.note }),
    })),
    total,
    tronque: total > items.length,
  }
}

export const scopes: readonly Scope[] = ['reservations:lecture']
export const annotation = 'lecture seule'
