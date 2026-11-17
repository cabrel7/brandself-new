// S16 : handler de l'outil lister_demandes (lecture seule, confidentialité par défaut).
// Demandes d'ateliers et de devis, les plus récentes d'abord. Message, email et téléphone du visiteur seulement si le
// détail est autorisé, confinés dans `contenu_visiteur` (données non fiables).

import { listDemandesPourAssistant } from '../../services/agenda-resume'
import { avecDetailVisiteur, prenomInitiale } from '../confidentialite'
import type { ContenuVisiteur } from '../confidentialite'
import { isoDansFuseau, lireArguments } from '../format'
import { schemaListerDemandes } from '../tools'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

export type DemandeResume = {
  id: string
  date: string
  service: string
  statut: string
  client: string
} & Partial<ContenuVisiteur>

export interface DemandesVue {
  fuseau: string
  items: DemandeResume[]
  total: number
  tronque: boolean
}

export async function executer(
  args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<DemandesVue> {
  const { statut, limite } = lireArguments(schemaListerDemandes, args)
  const detail = options.detailAutorise === true
  const { items, total } = await listDemandesPourAssistant(contexte.userId, { statut, limite })

  return {
    fuseau: contexte.fuseau,
    items: items.map((demande) => ({
      id: demande.id,
      date: isoDansFuseau(demande.createdAt, contexte.fuseau),
      service: demande.service,
      statut: demande.statut,
      client: prenomInitiale(demande.nom),
      ...avecDetailVisiteur(detail, { message: demande.message, email: demande.email, telephone: demande.telephone }),
    })),
    total,
    tronque: total > items.length,
  }
}

export const scopes: readonly Scope[] = ['reservations:lecture']
export const annotation = 'lecture seule'
