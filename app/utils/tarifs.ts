import type { PlanTarifDTO } from '#shared/dto'
import type { RessourceQuota } from '#shared/plans'
import { accorder } from './pluriel'

// S10 : lignes de la page publique /tarifs, lues dans les limites renvoyées par l'API (jamais écrites en dur).

type Limites = Record<RessourceQuota, number | null>

function nombre(valeur: number, singulier: string, pluriel: string): string {
  return `${valeur} ${accorder(valeur, singulier, pluriel)}`
}

function lignesContenus(limites: Limites): string[] {
  const { services, realisations, temoignages } = limites
  if (services === realisations && realisations === temoignages) {
    if (services === null) return ['Services, réalisations et témoignages illimités']
    return [`${nombre(services, 'service', 'services')}, ${nombre(services, 'réalisation', 'réalisations')}, ${nombre(services, 'témoignage', 'témoignages')}`]
  }
  return [
    services === null ? 'Services illimités' : nombre(services, 'service', 'services'),
    realisations === null ? 'Réalisations illimitées' : nombre(realisations, 'réalisation', 'réalisations'),
    temoignages === null ? 'Témoignages illimités' : nombre(temoignages, 'témoignage', 'témoignages'),
  ]
}

/** Points de comparaison d'un plan, dans l'ordre de la maquette. */
export function lignesPlan(plan: PlanTarifDTO): string[] {
  const { reservations_mois: reservations, generations_ia_mois: ia } = plan.limites
  return [
    ...lignesContenus(plan.limites),
    reservations === null ? 'Réservations illimitées' : `${nombre(reservations, 'réservation', 'réservations')} par mois`,
    ia === null ? 'Propositions de l’IA illimitées' : `${nombre(ia, 'proposition', 'propositions')} de l’IA par mois`,
    'Page de liens incluse',
    `Statistiques des ${plan.statistiquesJours} derniers jours`,
    plan.badge ? 'Badge « Créé avec Brandself » sur votre vitrine' : 'Sans badge Brandself',
  ]
}
