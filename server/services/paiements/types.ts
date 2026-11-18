import type { FournisseurPaiement, PaiementEnvironnement } from '../../../shared/paiements'

// S10 (docs/specs/S10-abonnements.md §5.2) : contrat d'un fournisseur de paiement. Un adaptateur par
// fournisseur (K-PAY aujourd'hui, carte plus tard) ; le reste de l'application ne connaît que cette interface.
// Aucune de ces structures ne porte le numéro du payeur en dehors de `InitiationRequete` (envoi unique).

export interface InitiationRequete {
  /** Identifiant du paiement chez nous (UUID) : l'`externalId` du fournisseur, clé d'idempotence. */
  externalId: string
  /** Unité mineure de la devise (entier). */
  montant: number
  devise: string
  /** Code de l'opérateur chez le fournisseur (ex. `MTN_MOMO_CMR`). */
  operateur: string
  /** Numéro au format international, sans `+` (ex. `237653456789`). Jamais stocké ni journalisé. */
  telephoneInternational: string
  description: string
}

export type InitiationResultat =
  | { issue: 'accepte', idFournisseur: string, referenceFournisseur: string | null, statutFournisseur: string }
  /** Le fournisseur a refusé la requête (400) : rien n'a été créé chez lui. */
  | { issue: 'refuse', code: string }
  /** On ne sait pas si le paiement existe chez le fournisseur : seul le webhook pourra le rapprocher. */
  | { issue: 'incertain', code: 'DELAI' | 'DOUBLON' | 'RESEAU' }
  | { issue: 'indisponible', code: 'AUTH' | 'LIMITE' | 'SERVEUR', retryAfterS?: number }

export type StatutFournisseur = 'en_attente' | 'reussi' | 'echoue' | 'annule' | 'rembourse'

export interface EtatFournisseur {
  idFournisseur: string
  statut: StatutFournisseur
  montant: number
  devise: string | null
  fraisReels: number | null
  netReel: number | null
  codeEchec: string | null
  referenceFournisseur: string | null
  /** Identifiant que nous avons envoyé à l'initiation, s'il est renvoyé (contrôle de cohérence). */
  externalId?: string | null
  /** Statut tel que le fournisseur l'a écrit (audit, colonne `statut_fournisseur`). */
  statutBrut?: string | null
}

export interface EvenementNormalise {
  /** Nom brut de l'événement (`payment.completed`…), journalisé tel quel s'il respecte le format. */
  evenement: string
  idTransaction: string
  externalId: string | null
  statut: StatutFournisseur | 'autre'
  montant: number
  devise: string | null
  referenceFournisseur: string | null
  horodatage: Date | null
  codeEchec: string | null
  /** Statut brut du fournisseur (audit), en majuscules. */
  statutBrut?: string | null
  /** P1 : environnement de l'événement (`livemode`), s'il est porté ; comparé à celui de la clé configurée. */
  environnement?: PaiementEnvironnement
  /** Renseignés par une interrogation, ou par un webhook qui porte les frais (Mercy Pay). */
  fraisReels?: number | null
  netReel?: number | null
}

export interface PaiementProvider {
  readonly nom: FournisseurPaiement
  readonly environnement: PaiementEnvironnement
  /** Faux si le secret de signature des webhooks est absent (le webhook répond alors 503). Défaut : vrai. */
  readonly webhookConfigure?: boolean
  /**
   * Réponse de la route webhook quand le secret est absent. `non_configure` (défaut, K-PAY) : 503 `WEBHOOK_NON_CONFIGURE`.
   * `signature_invalide` (Mercy Pay, P1) : 401 `SIGNATURE_INVALIDE`, jamais 200 ni 5xx (la route se comporte comme face
   * à une signature fausse : un secret non encore déclaré ne doit pas faire désactiver l'endpoint par le fournisseur).
   */
  readonly webhookSansSecret?: 'non_configure' | 'signature_invalide'
  initier(req: InitiationRequete, signal: AbortSignal): Promise<InitiationResultat>
  /** `null` = transaction inconnue (404). Lève `FournisseurIndisponibleError` sur toute autre panne. */
  consulter(idFournisseur: string, signal: AbortSignal): Promise<EtatFournisseur | null>
  /**
   * Optionnel. Retrouve chez le fournisseur un paiement dont l'initiation est restée INCERTAINE (délai dépassé : le paiement
   * existe peut-être mais son identifiant n'a pas été reçu) à partir de NOTRE identifiant (`externalId`, transmis dans les
   * métadonnées) parmi les paiements créés à partir de `depuis`. `null` = introuvable. Même contrat d'erreur que `consulter`.
   */
  retrouver?(externalId: string, depuis: Date, signal: AbortSignal): Promise<EtatFournisseur | null>
  /**
   * `now` est injecté (horloge testable) : un fournisseur dont la signature porte un horodatage (Mercy Pay, tolérance
   * 300 s) l'utilise ; K-PAY l'ignore. Jamais d'exception : toute entrée invalide donne `false`.
   */
  verifierSignature(corpsBrut: Buffer, entetes: Readonly<Record<string, string | undefined>>, now: Date): boolean
  /**
   * `null` = schéma invalide, et SEULEMENT ce cas : un type d'événement non géré donne `statut: 'autre'` (journalisé
   * `ignore`, réponse 200). Les champs inconnus sont ignorés.
   */
  interpreterWebhook(corps: unknown): EvenementNormalise | null
}

export type CodeFournisseurIndisponible = 'AUTH' | 'LIMITE' | 'SERVEUR' | 'RESEAU' | 'DELAI'

/** Panne du fournisseur pendant une consultation. Le message ne contient ni clé, ni URL, ni corps de réponse. */
export class FournisseurIndisponibleError extends Error {
  readonly code: CodeFournisseurIndisponible
  readonly retryAfterS: number | null

  constructor(code: CodeFournisseurIndisponible, retryAfterS: number | null = null) {
    super(`FOURNISSEUR_INDISPONIBLE_${code}`)
    this.name = 'FournisseurIndisponibleError'
    this.code = code
    this.retryAfterS = retryAfterS
  }
}
