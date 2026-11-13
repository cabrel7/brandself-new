// S16 : handler de l'outil obtenir_agenda (lecture seule).
// Réglages, semaine type et prochaines fermetures, tels que le professionnel les a saisis (getOwnAgenda). L'assistant
// ne modifie jamais l'agenda : il renvoie l'utilisateur vers le studio.

import { JOURS_SEMAINE_LIBELLES } from '../../../shared/agenda'
import { MCP_INDISPONIBILITES_MAX } from '../../../shared/mcp'
import { getOwnAgenda } from '../../services/agenda'
import { dateEstPassee } from '../../services/agenda-regles'
import { lienAbsolu } from '../format'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

const JOURS = [1, 2, 3, 4, 5, 6, 7] as const
/** `HH:MM:SS` (type `time` de PostgreSQL) -> `HH:MM`. */
const HEURE_MINUTE = 5

export interface JourAgenda {
  jourSemaine: number
  jour: string
  ouvert: boolean
  plages: Array<{ debut: string, fin: string }>
}

export interface AgendaVue {
  fuseau: string
  reglages: { pasCreneauMin: number, preavisHeures: number, horizonJours: number }
  agendaOuvert: boolean
  semaine: JourAgenda[]
  indisponibilitesAVenir: Array<{ date: string, raison: string | null }>
  indisponibilitesTronquees: boolean
  lienStudio: string
}

export async function executer(
  _args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<AgendaVue> {
  const maintenant = options.maintenant ?? new Date()
  const agenda = await getOwnAgenda(contexte.userId)

  const semaine = JOURS.map((jourSemaine): JourAgenda => {
    const plages = agenda.disponibilites
      .filter((plage) => plage.jourSemaine === jourSemaine)
      .map((plage) => ({ debut: plage.debut.slice(0, HEURE_MINUTE), fin: plage.fin.slice(0, HEURE_MINUTE) }))
    return { jourSemaine, jour: JOURS_SEMAINE_LIBELLES[jourSemaine], ouvert: plages.length > 0, plages }
  })

  // Aujourd'hui (jour local de la vitrine) est inclus ; la liste est déjà triée par date.
  const aVenir = agenda.indisponibilites.filter((fermeture) => !dateEstPassee(fermeture.date, maintenant, contexte.fuseau))

  return {
    fuseau: contexte.fuseau,
    reglages: {
      pasCreneauMin: agenda.reglages.pasCreneauMin,
      preavisHeures: agenda.reglages.preavisHeures,
      horizonJours: agenda.reglages.horizonJours,
    },
    agendaOuvert: agenda.disponibilites.length > 0,
    semaine,
    indisponibilitesAVenir: aVenir.slice(0, MCP_INDISPONIBILITES_MAX).map(({ date, raison }) => ({ date, raison })),
    indisponibilitesTronquees: aVenir.length > MCP_INDISPONIBILITES_MAX,
    lienStudio: lienAbsolu('/studio/agenda/disponibilites'),
  }
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
