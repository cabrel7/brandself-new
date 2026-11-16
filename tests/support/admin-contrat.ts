// A1 (CA01, CA23) : table EXPLICITE des routes `server/api/admin/**`. Source unique du test de confidentialité
// (tests/unit/admin/contrat-confidentialite.test.ts) et des specs e2e (e2e/admin-acces.spec.ts).
//
// RÈGLE : ajouter une route sous `server/api/admin/` SANS la déclarer ici fait échouer le test de confidentialité
// (« une route nouvelle ne peut pas passer sous le radar »). La déclarer oblige à nommer son schéma de réponse (liste
// blanche stricte, `shared/schemas/admin.ts`) et à justifier toute clé sensible qu'il contient.
//
// Aucun import de zod ni de code serveur : ce fichier est lu aussi par Playwright.

export type MethodeAdmin = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface EntreeContrat {
  methode: MethodeAdmin
  /** Chemin HTTP complet. Le test unitaire vérifie qu'il découle du nom de fichier (pas de dérive). */
  chemin: string
  /**
   * Nom de l'export Zod de `shared/schemas/admin.ts` qui décrit la RÉPONSE, ou `null` quand la route ne renvoie
   * aucun corps (204).
   */
  schema: string | null
  /** Statut de succès d'un superadmin connecté sur l'hôte d'administration. */
  statutSucces: 200 | 202 | 204
  /** Corps JSON valide d'une requête d'écriture (les lectures n'en ont pas). */
  corps?: Readonly<Record<string, unknown>>
  /** La route met fin à la session (le test e2e lui réserve une session dédiée). */
  terminaLaSession?: boolean
  /**
   * Entrée réservée au test UNITAIRE de confidentialité (A2, A3) : chemin à segment dynamique `:id` ou schéma hors de
   * `shared/schemas/admin.ts`. e2e/admin-acces.spec.ts doit l'ignorer (`filter(([, e]) => !e.reserveeAuTestUnitaire)`).
   */
  reserveeAuTestUnitaire?: true
  /** Le corps de succès n'est pas du JSON (export CSV) : `schema` vaut `null` avec un statut 200. */
  corpsNonJson?: true
}

/** Identifiant fictif de cible (aucune personne réelle). */
export const CIBLE_ID_EXEMPLE = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

/** A1. Clé = chemin du fichier relatif à `server/api/admin/`, séparateurs `/`. */
export const CONTRAT_A1: Readonly<Record<string, EntreeContrat>> = {
  'session.get.ts': {
    methode: 'GET',
    chemin: '/api/admin/session',
    schema: 'schemaAdminSessionDto',
    statutSucces: 200,
  },
  'vue-ensemble.get.ts': {
    methode: 'GET',
    chemin: '/api/admin/vue-ensemble',
    schema: 'schemaVueEnsembleEnrichieDto',
    statutSucces: 200,
  },
  'reauth/code.post.ts': {
    methode: 'POST',
    chemin: '/api/admin/reauth/code',
    schema: 'schemaReauthReponse',
    statutSucces: 202,
    corps: { action: 'compte.supprimer', cibleType: 'user', cibleId: CIBLE_ID_EXEMPLE },
  },
  'deconnexion.post.ts': {
    methode: 'POST',
    chemin: '/api/admin/deconnexion',
    schema: null,
    statutSucces: 204,
    terminaLaSession: true,
  },
}

const MOTIF_CONTRAT = 'Motif de test valide'
const ecriture = (chemin: string, schema: string, corps: Readonly<Record<string, unknown>> = { motif: MOTIF_CONTRAT }): EntreeContrat => ({
  methode: 'POST',
  chemin,
  schema,
  statutSucces: 200,
  corps,
  reserveeAuTestUnitaire: true,
})
const lecture = (chemin: string, schema: string, statutSucces: 200 | 202 = 200): EntreeContrat => ({ methode: 'GET', chemin, schema, statutSucces, reserveeAuTestUnitaire: true })

/**
 * A2 (spec §5 et CA11) : les 16 routes utilisateurs, vitrines, assistants. Les chemins gardent le segment dynamique
 * `:id` (déduit du nom de fichier) : ces entrées servent au test UNITAIRE de confidentialité, PAS à
 * e2e/admin-acces.spec.ts (qui n'itère que sur `CONTRAT`, routes sans paramètre). Schémas : shared/schemas/admin-a2.ts.
 */
export const CONTRAT_A2: Readonly<Record<string, EntreeContrat>> = {
  'recherche.get.ts': lecture('/api/admin/recherche', 'schemaRechercheDto'),
  'utilisateurs/index.get.ts': lecture('/api/admin/utilisateurs', 'schemaListeUtilisateursDto'),
  'utilisateurs/[id].get.ts': lecture('/api/admin/utilisateurs/:id', 'schemaUtilisateurFicheDto'),
  'utilisateurs/[id]/suspendre.post.ts': ecriture('/api/admin/utilisateurs/:id/suspendre', 'schemaActionAdminReponse'),
  'utilisateurs/[id]/reactiver.post.ts': ecriture('/api/admin/utilisateurs/:id/reactiver', 'schemaActionAdminReponse'),
  'utilisateurs/[id]/offrir-jours.post.ts': ecriture('/api/admin/utilisateurs/:id/offrir-jours', 'schemaOffrirJoursReponse', { motif: MOTIF_CONTRAT, jours: 5 }),
  'utilisateurs/[id]/changer-plan.post.ts': ecriture('/api/admin/utilisateurs/:id/changer-plan', 'schemaChangerPlanReponse', { motif: MOTIF_CONTRAT, plan: 'payant', jours: 5 }),
  'utilisateurs/[id]/revoquer-sessions.post.ts': ecriture('/api/admin/utilisateurs/:id/revoquer-sessions', 'schemaRevocationReponse'),
  'utilisateurs/[id]/retirer-assistants.post.ts': ecriture('/api/admin/utilisateurs/:id/retirer-assistants', 'schemaRevocationReponse'),
  'utilisateurs/[id]/supprimer.post.ts': ecriture('/api/admin/utilisateurs/:id/supprimer', 'schemaActionAdminReponse', { motif: MOTIF_CONTRAT, emailConfirmation: 'compte@exemple.test' }),
  'vitrines/index.get.ts': lecture('/api/admin/vitrines', 'schemaListeVitrinesDto'),
  'vitrines/[id].get.ts': lecture('/api/admin/vitrines/:id', 'schemaVitrineFicheDto'),
  'vitrines/[id]/depublier.post.ts': ecriture('/api/admin/vitrines/:id/depublier', 'schemaActionAdminReponse'),
  'vitrines/[id]/republier.post.ts': ecriture('/api/admin/vitrines/:id/republier', 'schemaActionAdminReponse'),
  'assistants/index.get.ts': lecture('/api/admin/assistants', 'schemaListeAssistantsDto'),
  'assistants/[id]/retirer.post.ts': ecriture('/api/admin/assistants/:id/retirer', 'schemaActionAdminReponse'),
}

const MOTIF_A3 = { motif: MOTIF_CONTRAT, cleIdempotence: 'cle-idempotence-contrat-0001' }

/**
 * A3 (spec A3, CA13) : abonnements, paiements, revenus, alertes, export. Schémas : shared/schemas/admin-paiements.ts.
 * `vue-ensemble.get.ts` (A1) pointe désormais sur `schemaVueEnsembleEnrichieDto` (même fichier).
 */
export const CONTRAT_A3: Readonly<Record<string, EntreeContrat>> = {
  'abonnements/index.get.ts': lecture('/api/admin/abonnements', 'schemaListeAbonnementsDto'),
  'abonnements/[id]/rappel.post.ts': { ...ecriture('/api/admin/abonnements/:id/rappel', 'schemaRappelAbonnementReponse'), statutSucces: 202 },
  'paiements/index.get.ts': lecture('/api/admin/paiements', 'schemaListePaiementsDto'),
  'paiements/[id].get.ts': lecture('/api/admin/paiements/:id', 'schemaPaiementDetailDto'),
  'paiements/[id]/reverifier.post.ts': ecriture('/api/admin/paiements/:id/reverifier', 'schemaReverificationReponse', MOTIF_A3),
  'paiements/[id]/marquer-paye.post.ts': ecriture('/api/admin/paiements/:id/marquer-paye', 'schemaMarquagePaiementReponse', MOTIF_A3),
  'revenus.get.ts': lecture('/api/admin/revenus', 'schemaRevenusDto'),
  'alertes.get.ts': lecture('/api/admin/alertes', 'schemaAlertesDto'),
  'export/paiements.post.ts': {
    methode: 'POST',
    chemin: '/api/admin/export/paiements',
    schema: null,
    statutSucces: 200,
    corps: { motif: MOTIF_CONTRAT, filtres: {} },
    reserveeAuTestUnitaire: true,
    corpsNonJson: true,
  },
}

/**
 * CONTRAT COMPLET (A1 + A2 + A3), lu par les tests unitaires de confidentialité (A1, A2, A3). Les entrées d'A2 et d'A3
 * portent `reserveeAuTestUnitaire` : e2e/admin-acces.spec.ts doit les ignorer (chemins à `:id`, schémas d'un autre fichier).
 * Une route sans entrée fait échouer le test.
 */
export const CONTRAT: Readonly<Record<string, EntreeContrat>> = { ...CONTRAT_A1, ...CONTRAT_A2, ...CONTRAT_A3 }
export const CONTRAT_COMPLET: Readonly<Record<string, EntreeContrat>> = CONTRAT

/**
 * Clés de `CLES_AUDIT_INTERDITES` TOLÉRÉES dans un schéma de réponse, par nom de schéma, avec la raison. A1 : la
 * session et la vue d'ensemble décrivent l'administrateur LUI-MÊME (son nom, son e-mail) : ce n'est pas une donnée
 * de visiteur. Toute autre exception exige une décision écrite. Une exception inutilisée fait échouer le test
 * (elle masquerait une régression future).
 */
export const EXCEPTIONS_CLES_REPONSE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  schemaAdminSessionDto: {
    nom: 'nom de l\'administrateur connecté (lui-même), pas celui d\'un visiteur ni d\'un client',
    email: 'adresse de l\'administrateur connecté (lui-même), déjà connue de lui',
  },
  schemaVueEnsembleDto: {
    nom: 'nom de l\'administrateur connecté (lui-même) pour l\'accueil de la vue d\'ensemble',
  },
  // A2 : `nom`, `email` et `telephone` sont ceux du PROFESSIONNEL titulaire du compte (la personne que l'administrateur
  // retrouve, suspend ou supprime), jamais d'un visiteur ni d'un client final. Un visiteur n'apparaît dans aucun schéma.
  schemaUtilisateurLigneDto: {
    nom: 'nom du professionnel titulaire du compte, jamais celui d\'un visiteur',
    email: 'adresse du professionnel titulaire du compte, nécessaire pour le retrouver, jamais celle d\'un visiteur',
  },
  schemaUtilisateurFicheDto: {
    nom: 'nom du professionnel titulaire du compte, jamais celui d\'un visiteur',
    email: 'adresse du professionnel titulaire du compte, nécessaire pour le retrouver, jamais celle d\'un visiteur',
    telephone: 'téléphone du professionnel titulaire du compte, jamais celui d\'un visiteur',
  },
  schemaVitrineLigneDto: {
    nom: 'nom affiché de la vitrine, celui du professionnel titulaire, jamais celui d\'un visiteur',
  },
  // Schémas qui EMBARQUENT les précédents (extend ou tableau) : mêmes clés, mêmes raisons.
  schemaVitrineFicheDto: {
    nom: 'nom affiché de la vitrine, celui du professionnel titulaire, jamais celui d\'un visiteur',
  },
  schemaListeUtilisateursDto: {
    nom: 'nom du professionnel titulaire de chaque compte listé, jamais celui d\'un visiteur',
    email: 'adresse du professionnel titulaire de chaque compte listé, jamais celle d\'un visiteur',
  },
  schemaListeVitrinesDto: {
    nom: 'nom affiché de chaque vitrine listée, celui du professionnel titulaire, jamais celui d\'un visiteur',
  },
  // A3 : `email` = titulaire du compte qui a payé / de l'abonnement (jamais un visiteur) ; `nom` = l'administrateur lui-même.
  schemaPaiementDto: { email: 'adresse du titulaire du compte qui a payé (utilisateur.email, null si le compte est supprimé), jamais celle d\'un visiteur' },
  schemaPaiementDetailDto: { email: 'adresse du titulaire du compte (paiement.utilisateur.email), la même que dans la liste des paiements' },
  schemaListePaiementsDto: { email: 'liste de schemaPaiementDto : adresse du titulaire du compte (elements[].utilisateur.email)' },
  schemaAbonnementAdminDto: { email: 'adresse du titulaire de l\'abonnement (utilisateur.email), compte de l\'application, pas un visiteur' },
  schemaListeAbonnementsDto: { email: 'liste de schemaAbonnementAdminDto : adresse du titulaire de l\'abonnement (elements[].utilisateur.email)' },
  schemaVueEnsembleEnrichieDto: { nom: 'nom de l\'administrateur connecté (lui-même) pour l\'accueil de la vue d\'ensemble' },
  schemaRechercheDto: {
    nom: 'nom du professionnel (compte ou vitrine) trouvé par la recherche, jamais celui d\'un visiteur',
    email: 'adresse du professionnel trouvé par la recherche, jamais celle d\'un visiteur',
  },
}
