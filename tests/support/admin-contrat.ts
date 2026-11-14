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
}

/** Identifiant fictif de cible (aucune personne réelle). */
export const CIBLE_ID_EXEMPLE = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

/** Clé = chemin du fichier relatif à `server/api/admin/`, séparateurs `/`. */
export const CONTRAT: Readonly<Record<string, EntreeContrat>> = {
  'session.get.ts': {
    methode: 'GET',
    chemin: '/api/admin/session',
    schema: 'schemaAdminSessionDto',
    statutSucces: 200,
  },
  'vue-ensemble.get.ts': {
    methode: 'GET',
    chemin: '/api/admin/vue-ensemble',
    schema: 'schemaVueEnsembleDto',
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
}
