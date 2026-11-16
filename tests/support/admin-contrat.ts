// A1 (CA01, CA23) : table EXPLICITE des routes `server/api/admin/**`. Source unique du test de confidentialité
// (tests/unit/admin/contrat-confidentialite.test.ts) et des specs e2e (e2e/admin-acces.spec.ts).
//
// RÈGLE : ajouter une route sous `server/api/admin/` SANS la déclarer ici fait échouer le test de confidentialité
// (« une route nouvelle ne peut pas passer sous le radar »). La déclarer oblige à nommer son schéma de réponse (liste
// blanche stricte, `shared/schemas/admin.ts`) et à justifier toute clé sensible qu'il contient.
//
// Aucun import de zod ni de code serveur : ce fichier est lu aussi par Playwright.

import { CONTRAT_A5 } from './admin-contrat-a5'

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

const MOTIF_A4 = { motif: MOTIF_CONTRAT, cleIdempotence: 'cle-idempotence-contrat-0001' }
const entree = (methode: MethodeAdmin, chemin: string, schema: string | null, corps?: Readonly<Record<string, unknown>>): EntreeContrat => ({
  methode,
  chemin,
  schema,
  statutSucces: 200,
  ...(corps === undefined ? {} : { corps }),
  reserveeAuTestUnitaire: true,
  ...(schema === null ? { corpsNonJson: true as const } : {}),
})

/**
 * A4 (spec A4 §4, §6) : réglages, supervision des files, agrégats, santé, capacités, journal. Schémas : shared/schemas/admin-a4.ts
 * (la relance répond `schemaActionAdminReponse`, d'A2). Les noms de fichiers suivent la convention d'A2/A3 (`index.get.ts` pour une
 * liste, `[x].put.ts`, `<verbe>.post.ts`) : si le backend en choisit d'autres, corriger ICI et dans tests/integration/support/admin-a4.ts.
 * `GET /api/public/etat` n'est pas sous `server/api/admin/` : hors de ce contrat.
 */
export const CONTRAT_A4: Readonly<Record<string, EntreeContrat>> = {
  'reglages/index.get.ts': lecture('/api/admin/reglages', 'schemaListeReglagesDto'),
  'reglages/[cle].put.ts': entree('PUT', '/api/admin/reglages/:cle', 'schemaModifierReglageReponse', { valeur: 20, ...MOTIF_A4 }),
  'systemes/jobs/index.get.ts': lecture('/api/admin/systemes/jobs', 'schemaEtatFilesDto'),
  'systemes/jobs/relancer.post.ts': entree('POST', '/api/admin/systemes/jobs/relancer', 'schemaActionAdminReponse', { file: 'ia-fond', id: '1', ...MOTIF_A4 }),
  'systemes/jobs/purger.post.ts': entree('POST', '/api/admin/systemes/jobs/purger', 'schemaPurgeFilesReponse', { file: 'ia-fond', motif: MOTIF_CONTRAT, limite: 10 }),
  'systemes/envois.get.ts': lecture('/api/admin/systemes/envois', 'schemaEnvoisDto'),
  'systemes/ia.get.ts': lecture('/api/admin/systemes/ia', 'schemaAgregatsIaDto'),
  'systemes/pwa.get.ts': lecture('/api/admin/systemes/pwa', 'schemaAgregatsPwaDto'),
  'systemes/sante.get.ts': lecture('/api/admin/systemes/sante', 'schemaSanteDto'),
  'systemes/assistants.get.ts': lecture('/api/admin/systemes/assistants', 'schemaAgregatsAssistantsDto'),
  'utilisateurs/[id]/capacites/index.post.ts': entree('POST', '/api/admin/utilisateurs/:id/capacites', 'schemaCapaciteReponse', { capacite: 'mcp', motif: MOTIF_CONTRAT }),
  'utilisateurs/[id]/capacites/[capacite].delete.ts': entree('DELETE', '/api/admin/utilisateurs/:id/capacites/:capacite', 'schemaActionAdminReponse', { motif: MOTIF_CONTRAT }),
  'journal/index.get.ts': lecture('/api/admin/journal', 'schemaListeJournalDto'),
  'journal/verifier.get.ts': lecture('/api/admin/journal/verifier', 'schemaJournalVerificationDto'),
  'journal/export.post.ts': entree('POST', '/api/admin/journal/export', null, { motif: MOTIF_CONTRAT, filtres: {} }),
}

/**
 * CONTRAT COMPLET (A1 à A5), lu par les tests unitaires de confidentialité. Les entrées d'A2, A3 et A4 portent
 * `reserveeAuTestUnitaire` : e2e/admin-acces.spec.ts doit les ignorer (chemins à `:id`, schémas d'un autre fichier).
 * Une route sans entrée fait échouer le test. A5 : `CONTRAT_A5` (tests/support/admin-contrat-a5.ts).
 */
export const CONTRAT: Readonly<Record<string, EntreeContrat>> = { ...CONTRAT_A1, ...CONTRAT_A2, ...CONTRAT_A3, ...CONTRAT_A4, ...CONTRAT_A5 }
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
  // A4 : `cle` = clé du REGISTRE des réglages (ex. `ia.active`), jamais un secret (garde anti-secret du registre, CA06) ;
  // `nom` = nom TECHNIQUE d'un job de file (ex. `send-transactional-email`), jamais le nom d'une personne.
  schemaReglageDto: { cle: 'clé du registre des réglages d\'exploitation (ex. ia.active), jamais un secret ni une variable d\'environnement' },
  schemaListeReglagesDto: { cle: 'liste de schemaReglageDto : clé du registre des réglages d\'exploitation, jamais un secret' },
  schemaModifierReglageReponse: { cle: 'schemaReglageDto embarqué : clé du registre des réglages d\'exploitation, jamais un secret' },
  schemaJobEchecDto: { nom: 'nom technique du job de la file (ex. send-transactional-email), jamais le nom d\'une personne' },
  schemaEtatFileDto: { nom: 'liste de schemaJobEchecDto : nom technique du job de la file, jamais le nom d\'une personne' },
  schemaEtatFilesDto: { nom: 'liste de schemaEtatFileDto : nom technique du job de la file, jamais le nom d\'une personne' },  // A5 : `code` = code ISO du pays ou de la devise (catalogue), jamais un code à usage unique ; `cle` = clé d'un plan ou d'un
  // prompt versionné ; `nom` = nom du catalogue (pays, devises, noms bloqués) ; `sortie` = sortie JSON d'un essai de prompt
  // sur des fixtures synthétiques FIXÉES dans le code (jamais une donnée utilisateur).
  schemaPaysDto: { code: 'code ISO du pays du catalogue (ex. CM), jamais un code à usage unique' },
  schemaDeviseDto: { code: 'code ISO de la devise du catalogue (ex. XAF), jamais un code à usage unique' },
  schemaListeCatalogueDto: {
    nom: 'nom du catalogue demandé (pays, devises ou noms bloqués), jamais le nom d\'une personne',
    code: 'liste de schemaPaysDto / schemaDeviseDto : code ISO du pays ou de la devise, jamais un code à usage unique',
  },
  schemaPaysReponse: { code: 'schemaPaysDto embarqué : code ISO du pays du catalogue, jamais un code à usage unique' },
  schemaDeviseReponse: { code: 'schemaDeviseDto embarqué : code ISO de la devise du catalogue, jamais un code à usage unique' },
  schemaVersionPromptDto: { cle: 'clé du prompt versionné (type d\'appel IA), jamais un secret' },
  schemaVersionDto: { cle: 'clé de la version de configuration (plan, type de prompt ou période de prix), jamais un secret' },
  schemaListeVersionsDto: { cle: 'liste de schemaVersionDto : clé de la version de configuration, jamais un secret' },
  schemaVersionReponse: { cle: 'schemaVersionDto embarqué : clé de la version de configuration, jamais un secret' },
  schemaEssaiPromptDto: { sortie: 'OPAQUE: sortie JSON d\'un essai de prompt sur des fixtures synthétiques fixées dans le code, jamais une donnée utilisateur' },
}
