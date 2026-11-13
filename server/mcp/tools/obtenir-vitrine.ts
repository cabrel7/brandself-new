// S16 : handler de l'outil obtenir_vitrine (lecture seule).
// État de la vitrine, plan, fuseau, compteurs, prochaine étape ; en plus, l'agenda (portée reservations:lecture) et les
// messages non lus (portée messages:lecture) SEULEMENT si ces portées sont accordées. Compteurs par COUNT purs :
// jamais `listOwnReservations` (qui écrit), jamais de donnée de visiteur.

import { MCP_PORTEES } from '../../../shared/mcp'
import { getProchainRendezVous } from '../../services/agenda-resume'
import { countAgendaATraiterParType } from '../../services/agenda-a-traiter'
import { countOwnMessagesNonLus } from '../../services/messages'
import { getPlanEffectif } from '../../services/plans'
import { getStudioView } from '../../services/vitrines'
import { isoDansFuseau, lienAbsolu } from '../format'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

export interface AgendaResume {
  reservationsEnAttente: number
  demandesNouvelles: number
  aTraiter: number
  prochainRendezVous: { debut: string, fin: string, service: string } | null
}

export interface VitrineEtat {
  fuseau: string
  publiee: boolean
  plan: string
  etatAbonnement: string
  nbServices: number
  nbRealisations: number
  prochaineEtape: string | null
  lienStudio: string
  autorisationsManquantes: Scope[]
  agenda?: AgendaResume
  messages?: { nonLus: number }
}

async function resumerAgenda(contexte: ContexteMcp, maintenant: Date): Promise<AgendaResume> {
  const [parType, prochain] = await Promise.all([
    countAgendaATraiterParType(contexte.userId),
    getProchainRendezVous(contexte.userId, maintenant),
  ])
  return {
    ...parType,
    aTraiter: parType.reservationsEnAttente + parType.demandesNouvelles,
    prochainRendezVous: prochain
      ? { debut: isoDansFuseau(prochain.debut, contexte.fuseau), fin: isoDansFuseau(prochain.fin, contexte.fuseau), service: prochain.service }
      : null,
  }
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<VitrineEtat> {
  const maintenant = options.maintenant ?? new Date()
  const accorde = (portee: Scope) => contexte.scopes.includes(portee)
  const [vue, plan, agenda, nonLus] = await Promise.all([
    getStudioView(contexte.userId),
    getPlanEffectif(contexte.userId),
    accorde('reservations:lecture') ? resumerAgenda(contexte, maintenant) : Promise.resolve(undefined),
    accorde('messages:lecture') ? countOwnMessagesNonLus(contexte.userId) : Promise.resolve(undefined),
  ])

  return {
    fuseau: contexte.fuseau,
    publiee: vue.vitrine.vitrine.publieeLe !== null,
    plan: plan.plan,
    etatAbonnement: plan.etat,
    nbServices: vue.resume.compteurs.services,
    nbRealisations: vue.resume.compteurs.realisations,
    prochaineEtape: vue.resume.prochaineEtape ?? null,
    lienStudio: lienAbsolu('/studio'),
    autorisationsManquantes: MCP_PORTEES.filter((portee) => !accorde(portee)),
    ...(agenda ? { agenda } : {}),
    ...(nonLus === undefined ? {} : { messages: { nonLus } }),
  }
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
