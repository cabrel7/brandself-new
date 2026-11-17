// A5 (spec A5 §5 et CA17) : table EXPLICITE des routes `server/api/admin/catalogues/**` et `server/api/admin/versions/**`,
// même forme que `CONTRAT` (tests/support/admin-contrat.ts). Le lot qui fusionne les contrats (A4/A5) ajoute
// `...CONTRAT_A5` à `CONTRAT` ; une route A5 sans entrée ici fait alors échouer le test de confidentialité.
// Schémas de RÉPONSE : shared/schemas/admin-catalogues.ts et shared/schemas/admin-versions.ts (listes blanches strictes).
// Aucun import de zod ni de code serveur : ce fichier est lu aussi par Playwright.
//
// DÉCISIONS DE CONTRAT À CONFIRMER (aucun schéma figé ne les tranche) :
//  - `catalogues/[nom]/[id].get.ts` : la réponse dépend de `[nom]` (pays, devise, nom bloqué). On déclare `schemaPaysDto`
//    (le seul catalogue riche) ; si la route renvoie les trois formes, il faudra une union nommée dans admin-catalogues.ts.
//    Recommandation : ne pas créer cette route (la liste suffit au studio d'administration, YAGNI).
//  - `catalogues/[nom]/[id].patch.ts` : `schemaPaysReponse` ; pour une devise, `schemaDeviseReponse` (même route).
//  - `[id].delete.ts` : `schemaActionAdminReponse` (A2) : `{ effectue: true, rejoue }`.
import type { EntreeContrat } from './admin-contrat'

const MOTIF = 'Motif de test valide'

const lecture = (chemin: string, schema: string): EntreeContrat => ({
  methode: 'GET',
  chemin,
  schema,
  statutSucces: 200,
  reserveeAuTestUnitaire: true,
})

const ecriture = (
  methode: 'POST' | 'PATCH' | 'DELETE',
  chemin: string,
  schema: string,
  corps: Readonly<Record<string, unknown>> = { motif: MOTIF },
): EntreeContrat => ({ methode, chemin, schema, statutSucces: 200, corps, reserveeAuTestUnitaire: true })

const VALEURS_PLAN_GRATUIT = {
  services: 3,
  realisations: 3,
  temoignages: 3,
  reservationsParMois: 10,
  generationsIaParMois: 3,
  badge: true,
  statistiquesJours: 7,
  statistiquesDetails: false,
  capacites: { mcp: false },
}

const VALEURS_PROMPT = {
  systeme: 'Tu rédiges des textes courts pour une vitrine.',
  gabarit: 'Voici les données de la vitrine : {{donnees}}',
  parametres: { temperature: 0.2, maxTokens: 800 },
}

/** Clé = chemin du fichier relatif à `server/api/admin/`. */
export const CONTRAT_A5: Readonly<Record<string, EntreeContrat>> = {
  'catalogues/[nom]/index.get.ts': lecture('/api/admin/catalogues/:nom', 'schemaListeCatalogueDto'),
  'catalogues/[nom]/index.post.ts': ecriture('POST', '/api/admin/catalogues/:nom', 'schemaNomBloqueReponse', { valeur: 'marque-contrat', motif: MOTIF }),
  'catalogues/[nom]/[id].patch.ts': ecriture('PATCH', '/api/admin/catalogues/:nom/:id', 'schemaPaysReponse', { motif: MOTIF, actif: true }),
  'catalogues/[nom]/[id].delete.ts': ecriture('DELETE', '/api/admin/catalogues/:nom/:id', 'schemaActionAdminReponse'),
  'versions/[type]/index.get.ts': lecture('/api/admin/versions/:type', 'schemaListeVersionsDto'),
  'versions/[type]/index.post.ts': ecriture('POST', '/api/admin/versions/:type', 'schemaVersionReponse', { cle: 'gratuit', valeurs: VALEURS_PLAN_GRATUIT, motif: MOTIF }),
  'versions/[type]/[id]/activer.post.ts': ecriture('POST', '/api/admin/versions/:type/:id/activer', 'schemaVersionReponse', { programmeePour: null, motif: MOTIF }),
  'versions/[type]/[id]/retour.post.ts': ecriture('POST', '/api/admin/versions/:type/:id/retour', 'schemaVersionReponse'),
  'versions/[type]/[id]/valider.post.ts': ecriture('POST', '/api/admin/versions/:type/:id/valider', 'schemaVersionReponse'),
  'versions/[type]/impact.post.ts': ecriture('POST', '/api/admin/versions/:type/impact', 'schemaImpactPlanDto', { cle: 'gratuit', valeurs: VALEURS_PLAN_GRATUIT }),
  'versions/[type]/essai.post.ts': ecriture('POST', '/api/admin/versions/:type/essai', 'schemaEssaiPromptDto', { cle: 'ameliorer_texte', valeurs: VALEURS_PROMPT }),
}

/** Les routes d'écriture d'A5 : toutes exigent le motif, la clé d'idempotence et (selon l'action) la réauthentification. */
export const ROUTES_A5_ECRITURE: readonly string[] = Object.entries(CONTRAT_A5)
  .filter(([, entree]) => entree.methode !== 'GET')
  .map(([fichier]) => fichier)
