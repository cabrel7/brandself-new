// A2 (docs/specs/A2-utilisateurs-vitrines.md) : constantes partagées utilisateurs, vitrines, assistants.
// Constantes et types seulement : aucune logique, aucune dépendance serveur.

/** D-A2-14 : e-mails d'administration envoyés au titulaire. `entite_type='utilisateur'`, `occurrence` = id de l'entrée de journal. */
export const ADMIN_A2_EMAIL_TYPES = [
  'utilisateur_suspendu',
  'utilisateur_reactive',
  'utilisateur_jours_offerts',
  'utilisateur_depubliee',
] as const
export type AdminA2EmailType = (typeof ADMIN_A2_EMAIL_TYPES)[number]
export const ADMIN_A2_EMAIL_ENTITE_TYPE = 'utilisateur'

/** D-A2-11 : recherche globale. */
export const ADMIN_RECHERCHE_MIN = 3
export const ADMIN_RECHERCHE_MAX = 100
export const ADMIN_RECHERCHE_PAR_GROUPE = 10

/** D-A2-04, D-A2-05 : jours offerts ou durée d'un passage au plan payant par l'administrateur. */
export const ADMIN_JOURS_MIN = 1
export const ADMIN_JOURS_MAX = 365

/** D-A2-08 : longueur maximale de l'e-mail saisi pour confirmer une suppression (RFC 5321). */
export const ADMIN_EMAIL_CONFIRMATION_MAX = 254

/** D-A2-04 / spec §3 : origine d'un abonnement (`abonnements.origine`, CHECK `abonnements_origine_check`). */
export const ABONNEMENT_ORIGINES = ['paiement', 'offert', 'admin'] as const
export type AbonnementOrigine = (typeof ABONNEMENT_ORIGINES)[number]
export const ORIGINE_PAR_DEFAUT: AbonnementOrigine = 'paiement'

/** D-A2-12 : tris en liste blanche. */
export const ADMIN_UTILISATEURS_TRIS = ['cree_le', 'email', 'derniere_connexion', 'plan'] as const
export type AdminUtilisateurTri = (typeof ADMIN_UTILISATEURS_TRIS)[number]
export const ADMIN_UTILISATEURS_TRI_DEFAUT: AdminUtilisateurTri = 'cree_le'
export const ADMIN_VITRINES_TRIS = ['cree_le', 'username', 'nom'] as const
export type AdminVitrineTri = (typeof ADMIN_VITRINES_TRIS)[number]
export const ADMIN_VITRINES_TRI_DEFAUT: AdminVitrineTri = 'cree_le'

/** Filtre « vitrine » de la liste des utilisateurs et « statut » de la liste des vitrines. */
export const ADMIN_FILTRES_VITRINE_UTILISATEUR = ['publiee', 'bloquee', 'aucune'] as const
export type AdminFiltreVitrineUtilisateur = (typeof ADMIN_FILTRES_VITRINE_UTILISATEUR)[number]
export const ADMIN_STATUTS_VITRINE = ['publiee', 'bloquee', 'non_publiee'] as const
export type AdminStatutVitrine = (typeof ADMIN_STATUTS_VITRINE)[number]

/** Changement de plan par l'administrateur (D-A2-05). */
export const ADMIN_PLANS_CHANGEMENT = ['payant', 'gratuit'] as const
export type AdminPlanChangement = (typeof ADMIN_PLANS_CHANGEMENT)[number]

/** Fiche : nombre maximal de lignes de sessions et d'assistants renvoyées. */
export const ADMIN_FICHE_LIGNES_MAX = 50
/** Fenêtre de l'activité résumée dans la fiche (`activite30j`). */
export const ADMIN_ACTIVITE_JOURS = 30
