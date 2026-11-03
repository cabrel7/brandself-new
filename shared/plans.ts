// S10 (docs/specs/S10-abonnements.md §3.1) : identifiants, états et textes des plans.
// Pur : aucune dépendance serveur. AUCUN prix et AUCUNE limite chiffrée ici : ils vivent dans
// server/config/plans.ts (CLAUDE.md §4 règle 11). Les listes `PLAN_IDS` sont recopiées dans les CHECK
// de la migration 0021 (shared/db/schema.ts) : les garder synchronisées.

export const PLAN_IDS = ['gratuit', 'payant'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** Libellés affichables (vouvoiement, vocabulaire CLAUDE.md §2). */
export const PLAN_LIBELLES: Record<PlanId, string> = {
  gratuit: 'Plan gratuit',
  payant: 'Plan payant',
}

/** État d'abonnement : CALCULÉ depuis `expire_le` et l'horloge, jamais stocké (#119). */
export const ETATS_ABONNEMENT = ['gratuit', 'actif', 'grace'] as const
export type EtatAbonnement = (typeof ETATS_ABONNEMENT)[number]

export const RESSOURCES_QUOTA = [
  'services',
  'realisations',
  'temoignages',
  'reservations_mois',
  'generations_ia_mois',
] as const
export type RessourceQuota = (typeof RESSOURCES_QUOTA)[number]

/** Ressources dont l'excédent est masqué sur la vitrine publique (#127). */
export const RESSOURCES_MASQUABLES = ['services', 'realisations', 'temoignages'] as const
export type RessourceMasquable = (typeof RESSOURCES_MASQUABLES)[number]

/** Durées d'abonnement proposées, en mois civils. */
export const PERIODES_MOIS = [1, 3, 12] as const
export type PeriodeMois = (typeof PERIODES_MOIS)[number]
export const PERIODE_MISE_EN_AVANT: PeriodeMois = 12

/** Jours : les droits du plan payant sont conservés après l'échéance (#121). */
export const ABONNEMENT_GRACE_JOURS = 7
/** Jours avant la dernière journée payée : un rappel par valeur (J-7, J-3, J0). */
export const ABONNEMENT_RAPPELS_JOURS = [7, 3, 0] as const
export type AbonnementRappelJours = (typeof ABONNEMENT_RAPPELS_JOURS)[number]
/** Heure locale (0 à 23, fuseau de l'utilisateur) à partir de laquelle un rappel est planifié. */
export const ABONNEMENT_RAPPEL_HEURE_LOCALE = 9
/** Heures : fenêtre de rattrapage après l'heure locale (9 h + 6 h = 15 h). */
export const ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES = 6
/** Repli quand `users.fuseau` n'est pas un fuseau IANA valide. */
export const ABONNEMENT_FUSEAU_REPLI = 'Africa/Douala'
/** Chemin (avec ancre) de la carte Abonnement dans le Compte. */
export const ABONNEMENT_CHEMIN = '/studio/compte#abonnement'

/** Marqueurs interpolés dans les textes de déblocage. */
export const LIMITE_MARQUEUR = '{limite}'
export const LIMITE_MARQUEUR_DATE = '{date}'

/** Textes de déblocage ; `{limite}` (et `{date}` pour les réservations) sont interpolés par `interpolerLimite`. */
export const LIMITE_MESSAGES: Record<RessourceQuota, { titre: string, texte: string }> = {
  services: {
    titre: 'Limite de services atteinte',
    texte: 'Vous avez atteint {limite} services, la limite du plan gratuit. Avec le plan payant, ajoutez autant de services que vous le souhaitez, et le badge Brandself disparaît de votre vitrine.',
  },
  realisations: {
    titre: 'Limite de réalisations atteinte',
    texte: 'Vous avez atteint {limite} réalisations, la limite du plan gratuit. Avec le plan payant, ajoutez autant de réalisations que vous le souhaitez, et le badge Brandself disparaît de votre vitrine.',
  },
  temoignages: {
    titre: 'Limite de témoignages atteinte',
    texte: 'Vous avez atteint {limite} témoignages, la limite du plan gratuit. Avec le plan payant, ajoutez autant de témoignages que vous le souhaitez, et le badge Brandself disparaît de votre vitrine.',
  },
  reservations_mois: {
    titre: 'Limite de réservations atteinte',
    texte: 'Vous avez reçu {limite} réservations ce mois-ci, la limite du plan gratuit : les visiteurs ne peuvent plus réserver avant le {date}. Avec le plan payant, recevez autant de réservations que vous le souhaitez.',
  },
  generations_ia_mois: {
    titre: 'Limite de propositions atteinte',
    texte: 'Vous avez utilisé vos {limite} propositions de l’IA ce mois-ci, la limite du plan gratuit. Avec le plan payant, elles sont illimitées.',
  },
}

export const LIMITE_ACTION = { libelle: 'Voir l’abonnement', chemin: ABONNEMENT_CHEMIN } as const

/** Remplace `{limite}` (et `{date}` si fournie) ; sans effet sur un texte qui n'en contient pas. */
export function interpolerLimite(texte: string, valeurs: { limite: number, date?: string }): string {
  const avecLimite = texte.replaceAll(LIMITE_MARQUEUR, String(valeurs.limite))
  return valeurs.date === undefined ? avecLimite : avecLimite.replaceAll(LIMITE_MARQUEUR_DATE, valeurs.date)
}
