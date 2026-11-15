// A3 (docs/specs/A3-abonnements-paiements.md) : constantes partagées de l'administration des paiements et des
// abonnements. Constantes et types seulement : aucune logique, aucune dépendance serveur.
// Les limites chiffrées (10 revérifications par minute, rétention 90 j, seuils d'alerte, fenêtres) sont dans `limites.ts`.

/** D-A3-03 : `paiements.source` (CHECK `paiements_source_check`). Un paiement manuel a pour fournisseur `manuel`. */
export const PAIEMENT_SOURCES = ['kpay', 'manuel'] as const
export type PaiementSource = (typeof PAIEMENT_SOURCES)[number]
export const PAIEMENT_SOURCE_KPAY: PaiementSource = 'kpay'
export const PAIEMENT_SOURCE_MANUEL: PaiementSource = 'manuel'
export const PAIEMENT_FOURNISSEUR_MANUEL = 'manuel'
export const PAIEMENT_METHODE_MANUEL = 'manuel'
/** Référence d'un paiement manuel : `manuel-<id>` (CHECK `paiements_source_coherence_check`). */
export const PAIEMENT_REFERENCE_MANUEL_PREFIXE = 'manuel-'
/** Code posé sur l'original d'un marquage manuel (passé à `anomalie`, état final) ; respecte `CODE_ECHEC_FORMAT`. */
export const CODE_ANOMALIE_REMPLACE_PAR_MANUEL = 'REMPLACE_PAR_MANUEL'

/** D-A3-03 : seuls statuts d'un paiement qu'un marquage manuel peut remplacer (jamais `reussi`). */
export const PAIEMENT_STATUTS_REMPLACABLES = ['echoue', 'expire', 'annule', 'anomalie'] as const
export type PaiementStatutRemplacable = (typeof PAIEMENT_STATUTS_REMPLACABLES)[number]

/** Résultat de `confirmerPaiement` (spec §4). */
export const CONFIRMATION_RESULTATS = ['applique', 'deja_applique', 'refuse_anomalie'] as const
export type ConfirmationResultat = (typeof CONFIRMATION_RESULTATS)[number]
/** Résultat d'une revérification admin : confirmation, ou le fournisseur ne signale aucun encaissement. */
export const REVERIFICATION_RESULTATS = [...CONFIRMATION_RESULTATS, 'non_reussi', 'en_attente'] as const
export type ReverificationResultat = (typeof REVERIFICATION_RESULTATS)[number]

/** D-A3-05 : motifs comptés dans `webhooks_refuses` (`FOURNISSEUR_INCONNU` n'est jamais compté). */
export const WEBHOOK_REFUS_MOTIFS = ['SIGNATURE_INVALIDE', 'CORPS_TROP_GROS'] as const
export type WebhookRefusMotif = (typeof WEBHOOK_REFUS_MOTIFS)[number]

/** D-A3-14 : onglets de la liste des abonnements (partition sans recouvrement, `now` passé en argument). */
export const ABONNEMENT_ONGLETS = ['renouvellement', 'grace', 'expires'] as const
export type AbonnementOnglet = (typeof ABONNEMENT_ONGLETS)[number]

/** D-A3-02 : mention affichée avec tout revenu tant que le format du webhook K-PAY (brut ou net) n'est pas confirmé. */
export const REVENUS_MENTION_INCERTITUDE = 'Montant brut présumé, non confirmé par K-PAY'

/** D-A3-09 : colonnes de l'export CSV, dans cet ordre. Jamais de téléphone ni de numéro de payeur (D-A3-10). */
export const EXPORT_PAIEMENTS_COLONNES = [
  'id',
  'reference',
  'statut',
  'source',
  'methode',
  'operateur',
  'plan',
  'periodeMois',
  'devise',
  'montant',
  'fraisReels',
  'netReel',
  'codeEchec',
  'creeLe',
  'appliqueLe',
  'emailTitulaire',
] as const
export type ExportPaiementsColonne = (typeof EXPORT_PAIEMENTS_COLONNES)[number]
export const EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE = 'paiements-'
export const EXPORT_PAIEMENTS_CONTENT_TYPE = 'text/csv; charset=utf-8'
/** D-A3-09 : une cellule commençant par l'un de ces caractères reçoit `EXPORT_NEUTRALISATION` en préfixe (injection de formule). */
export const EXPORT_CARACTERES_FORMULE: readonly string[] = ['=', '+', '-', '@', '\t', '\r']
export const EXPORT_NEUTRALISATION = '\''

/** D-A3-07 : occurrence d'un rappel manuel, `manuel:<ISO>` (type `abonnement_rappel`). */
export const RAPPEL_MANUEL_OCCURRENCE_PREFIXE = 'manuel:'
