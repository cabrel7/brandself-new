// S16 : handler de l'outil lister_creneaux_libres (lecture seule).
// Réutilise `listCreneaux` (mêmes règles que la page publique : publication, visibilité, plan, préavis, horizon,
// fermetures, réservations). L'adresse de la vitrine vient du CONTEXTE, jamais des arguments : un assistant ne peut pas
// lire les créneaux d'une autre vitrine, même avec un service de même slug.

import { MCP_CRENEAUX_MAX } from '../../../shared/mcp'
import { DomainError } from '../../exceptions/http'
import { listCreneaux } from '../../services/creneaux'
import { isoDansFuseau, lireArguments } from '../format'
import { schemaListerCreneaux } from '../tools'
import type { ContexteMcp, OptionsHandlerMcp, Scope } from '../types'

const MESSAGE_SERVICE_INTROUVABLE = 'Aucun créneau : la vitrine doit être publiée et le service visible et réservable (rendez-vous ou accompagnement).'

export interface CreneauxVue {
  fuseau: string
  service: { slug: string, titre: string, dureeMin: number | null }
  du: string
  au: string
  creneaux: Array<{ debut: string, fin: string }>
  total: number
  tronque: boolean
  /** Quota mensuel de réservations atteint : aucun créneau n'est proposé pour l'instant. */
  suspendues: boolean
}

export async function executer(
  args: unknown,
  contexte: ContexteMcp,
  options: OptionsHandlerMcp = {},
): Promise<CreneauxVue> {
  const { service, du, au } = lireArguments(schemaListerCreneaux, args)
  let resultat: Awaited<ReturnType<typeof listCreneaux>>
  try {
    resultat = await listCreneaux({ username: contexte.username, serviceSlug: service, du, au, maintenant: options.maintenant ?? new Date() })
  } catch (erreur) {
    // Vitrine non publiée, service masqué, non réservable ou de type devis : un seul message, sans rien révéler de plus.
    if (erreur instanceof DomainError && erreur.code === 'SERVICE_INTROUVABLE') {
      throw new DomainError('SERVICE_INTROUVABLE', MESSAGE_SERVICE_INTROUVABLE, 404)
    }
    throw erreur
  }

  return {
    fuseau: contexte.fuseau,
    service: { slug: resultat.service.slug, titre: resultat.service.titre, dureeMin: resultat.service.dureeMin },
    du,
    au,
    creneaux: resultat.creneaux
      .slice(0, MCP_CRENEAUX_MAX)
      .map(({ debut, fin }) => ({ debut: isoDansFuseau(debut, contexte.fuseau), fin: isoDansFuseau(fin, contexte.fuseau) })),
    total: resultat.creneaux.length,
    tronque: resultat.creneaux.length > MCP_CRENEAUX_MAX,
    suspendues: resultat.suspendues,
  }
}

export const scopes: readonly Scope[] = ['vitrine:lecture']
export const annotation = 'lecture seule'
